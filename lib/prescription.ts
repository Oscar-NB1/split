/**
 * Turning a session's `target` text into something a screen can render.
 *
 * Two formats, because two kinds of session are prescribed two different ways:
 *
 *   Runs, in intervals.icu syntax — the same text that gets pushed to the watch,
 *   so there is exactly one prescription and no chance of the app and the watch
 *   disagreeing:
 *       - 15m Z2 warm up
 *       - 5x
 *       - 800m Z4
 *       - 90s Z1 walk
 *       - 10m Z1 cool down
 *
 *   Strength, one lift per line:
 *       Trap bar deadlift 3x5 @ 130
 *
 * Both parsers are total: anything they cannot read comes back as a plain line
 * rather than being dropped. A prescription that silently loses a rep is worse
 * than one that renders as text.
 */

export type Step = {
  /** e.g. "800m" or "15m" — the dose as written */
  dose: string;
  /**
   * The pace target, exactly as prescribed: "4:10/km", or a range for the easy
   * steps. Written into the prescription rather than derived by the screen, so the
   * watch, the session card and the plan cannot disagree about what to run — and so
   * a step that genuinely has no pace (a walking recovery) can say so.
   */
  pace: string | null;
  /** Z1..Z5 if stated */
  zone: string | null;
  /** "warm up", "walk", "cool down", or "" */
  label: string;
  /** true when this is a recovery rather than work */
  rest: boolean;
};

export type StepGroup = {
  /** "Warm-up", "5 ×", "Cool-down" */
  label: string;
  /** how many times the items repeat; 1 for a plain block */
  repeat: number;
  items: Step[];
};

const REST_WORDS = /(walk|jog|rest|recover|easy|float|standing)/i;
/** "@ 4:10/km" or "@ 6:33-7:03/km". */
const PACE = /@\s*(\d{1,2}:[0-5]\d(?:\s*[-–]\s*\d{1,2}:[0-5]\d)?)\s*\/?\s*km/i;
const ZONE = /\b(Z[1-5])\b/i;
const DOSE = /^(\d+(?:\.\d+)?\s*(?:m|km|k|min|s|sec|mi))\b/i;

/** One "- 800m Z4 walk" line. */
function parseStep(raw: string): Step | null {
  const line = raw.replace(/^[-•*]\s*/, "").trim();
  if (!line) return null;

  const zoneMatch = line.match(ZONE);
  const zone = zoneMatch ? zoneMatch[1].toUpperCase() : null;
  const paceMatch = line.match(PACE);
  const pace = paceMatch ? `${paceMatch[1].replace(/\s+/g, "")}/km` : null;
  const doseMatch = line.match(DOSE);
  const dose = doseMatch ? doseMatch[1].replace(/\s+/g, "") : "";

  const label = line
    .replace(DOSE, "")
    .replace(ZONE, "")
    .replace(PACE, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    dose,
    pace,
    zone,
    label,
    // a recovery is named as one, or is Z1 inside a rep block
    rest: REST_WORDS.test(label) || zone === "Z1",
  };
}

/**
 * Group a run prescription into blocks.
 *
 * A bare "5x" line means the lines that follow repeat, until a line that is
 * clearly not part of the set (a cool-down). That is the intervals.icu
 * convention and the reason the repeat count is not simply a property of a step.
 */
export function parseSteps(target: string | null | undefined): StepGroup[] {
  if (!target?.trim()) return [];
  const lines = target.split("\n").map((l) => l.trim()).filter(Boolean);

  const groups: StepGroup[] = [];
  let current: StepGroup | null = null;

  for (const line of lines) {
    const bare = line.replace(/^[-•*]\s*/, "").trim();
    const rep = bare.match(/^(\d+)\s*x$/i);

    if (rep) {
      current = { label: `${rep[1]} ×`, repeat: Number(rep[1]), items: [] };
      groups.push(current);
      continue;
    }

    const step = parseStep(line);
    if (!step) continue;

    const isWarm = /warm/i.test(step.label);
    const isCool = /cool/i.test(step.label);

    // a warm-up or cool-down closes any open repeat block
    if (isWarm || isCool || !current) {
      current = { label: isWarm ? "Warm-up" : isCool ? "Cool-down" : "Main", repeat: 1, items: [] };
      groups.push(current);
      current.items.push(step);
      if (isWarm || isCool) current = null;
      continue;
    }
    current.items.push(step);
  }

  return groups.filter((g) => g.items.length > 0);
}

/**
 * How many work reps a prescription contains, for the session summary line.
 *
 * Warm-up and cool-down are excluded. They are running, so they are not
 * "rest" — but counting them made a 5 × 800 m session report six reps, which is
 * the number nobody would write on a plan.
 */
export function repCount(groups: StepGroup[]): number {
  return groups
    .filter((g) => g.label !== "Warm-up" && g.label !== "Cool-down")
    .reduce((n, g) => n + g.repeat * g.items.filter((i) => !i.rest).length, 0);
}

// ------------------------------------------------------------------ strength

export type Lift = {
  name: string;
  sets: number;
  reps: number;
  /** kilograms, or null for bodyweight */
  load: number | null;
  /**
   * Seconds between sets, where the plan stated them.
   *
   * The rest timer was inferring it from the rep count, so it counted down a number
   * nobody had chosen — three minutes after an accessory, the same three minutes
   * after the heaviest set of the block. Where the prescription says, the prescription wins.
   */
  rest: number | null;
  /**
   * The effort to take the set to, 1–10, where the plan stated one.
   *
   * The load is the athlete's to choose and this is what makes that choice safe: a
   * number without an effort target is a guess about a stranger, and the same number
   * is right on a rested Monday and wrong after a bad night.
   */
  rpe?: number | null;
};

/**
 * "Trap bar deadlift 3x5 @ 130" → one lift.
 *
 * Bodyweight lines ("Press-up 3x12") parse with a null load rather than zero:
 * zero kilograms and no prescribed load are different things, and the set logger
 * shows a dash for one and a number for the other.
 */
export function parseStrength(target: string | null | undefined): Lift[] {
  if (!target?.trim()) return [];
  const out: Lift[] = [];

  for (const raw of target.split("\n")) {
    const line = raw.replace(/^[-•*]\s*/, "").trim();
    if (!line) continue;

    const rest = /\brest\s+(\d+)\s*s\b/i.exec(line);
    /*
     * The effort target, which is what makes a prescribed weight honest.
     *
     * A load is a guess about a stranger; a load with an RPE beside it is a complete
     * instruction that survives a good day and a bad one — and it is what lets next
     * week's number be decided by what happened this week.
     */
    const rpe = /\brpe\s+([\d.]+)\b/i.exec(line);
    const body = line
      .replace(/\s*\brest\s+\d+\s*s\b/i, "")
      .replace(/\s*\brpe\s+[\d.]+\b/i, "")
      .trim();
    const m = body.match(/^(.+?)\s+(\d+)\s*[x×]\s*(\d+)\s*(?:@\s*([\d.]+)\s*(?:kg)?)?$/i);
    if (!m) {
      // unreadable, but not thrown away — a lift with no set scheme is still a lift
      out.push({
        name: body || line, sets: 0, reps: 0, load: null,
        rest: rest ? Number(rest[1]) : null, rpe: rpe ? Number(rpe[1]) : null,
      });
      continue;
    }
    out.push({
      name: m[1].trim(),
      sets: Number(m[2]),
      reps: Number(m[3]),
      load: m[4] === undefined ? null : Number(m[4]),
      rest: rest ? Number(rest[1]) : null,
      rpe: rpe ? Number(rpe[1]) : null,
    });
  }
  return out;
}

/** Total kilograms lifted, the one number that summarises a strength session. */
export function tonnage(sets: { load_kg: number | null; reps: number | null; done: boolean }[]): number {
  return sets.reduce(
    (n, s) => n + (s.done && s.load_kg && s.reps ? Number(s.load_kg) * s.reps : 0),
    0,
  );
}

// ------------------------------------------------------- human descriptions

/** What a zone means in words, so a step reads as an instruction. */
export const ZONE_WORD: Record<string, string> = {
  Z1: "recovery — walk or very easy",
  Z2: "conversational",
  Z3: "steady",
  Z4: "hard — race pace",
  Z5: "maximum",
};

/** "15m" → "15 min", "800m" → "800 m", "1000m" → "1.0 km". */
export function humanDose(dose: string, unitHint: "auto" | "distance" = "auto"): string {
  const m = dose.match(/^(\d+(?:\.\d+)?)\s*(km|k|m|min|s|sec|mi)$/i);
  if (!m) return dose;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  /*
   * intervals.icu writes minutes as "15m" and metres as "800m". A bare "m" under 60
   * with no other clue is minutes; above that it is metres. Ambiguous by design in
   * the source format, so this is where the guess is made once.
   *
   * And where the caller knows, it should say: a station step has no pace and no zone,
   * so "25m" is twenty-five metres of sled and never twenty-five minutes of it. That
   * guess printed "25 min Sled push at 152 kg total", which is not a thing anybody
   * should be asked to do.
   */
  if (unit === "m" && unitHint === "distance") {
    return n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${n} m`;
  }
  if (unit === "m") return n <= 60 ? `${n} min` : n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${n} m`;
  if (unit === "km" || unit === "k") return `${n} km`;
  if (unit === "min") return `${n} min`;
  if (unit === "s" || unit === "sec") return `${n}s`;
  return dose;
}

/** The pace instruction for a step, given the session's prescribed pace. */
export function paceCue(zone: string | null, prescribed: number | null): string | null {
  if (!prescribed) return null;
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")} /km`;
  if (zone === "Z4" || zone === "Z5") return `At ${fmt(prescribed)}`;
  // the plan's easy-run instruction, relative to the session's own target
  if (zone === "Z2") return `No faster than ${fmt(prescribed + 45)}`;
  if (zone === "Z1") return "Walk it. Standing rest counts.";
  return null;
}

/**
 * How long to rest after a set, from the set scheme.
 *
 * Heavy and low-rep needs longer: a triple at 90% is not recoverable in ninety
 * seconds, and a set of twelve does not need three minutes. Derived from the
 * prescription rather than stored, so changing "3x5" to "3x10" changes the rest
 * without anyone editing a second field.
 */
export function restFor(reps: number | null | undefined, prescribed?: number | null): number {
  // What the plan said, where it said anything. The rep count is only a fallback
  // for prescriptions written before rests were part of them.
  if (prescribed && prescribed > 0) return prescribed;
  const r = reps ?? 8;
  return r <= 5 ? 180 : r <= 8 ? 120 : 90;
}

/** m:ss, or h:mm:ss past an hour. */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Move every pace in a prescription by a number of seconds.
 *
 * The calibration engine decides that an athlete's targets are a few seconds out;
 * this is what makes that true of the sessions they will actually open. It rewrites
 * the pace tokens in place — "@ 4:10/km" and "@ 5:26-5:52/km" alike — and touches
 * nothing else, so the structure, the zones and the rests survive untouched.
 *
 * Positive is slower, matching the engine's sign: a plan the athlete is behind moves
 * its targets away from them, not toward them.
 */
export function shiftPaces(target: string | null | undefined, seconds: number): string {
  if (!target || !seconds) return target ?? "";
  const move = (mmss: string) => {
    const [m, s] = mmss.split(":").map(Number);
    const total = Math.max(120, m * 60 + s + seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  return target.replace(
    /(\d{1,2}:[0-5]\d)(\s*[-–]\s*(\d{1,2}:[0-5]\d))?(\s*\/?\s*km)/g,
    (_all, a: string, _range: string | undefined, b: string | undefined, unit: string) =>
      b ? `${move(a)}-${move(b)}${unit}` : `${move(a)}${unit}`,
  );
}

/**
 * The distance a prescription asks for, read the way the rest of the app reads it.
 *
 * This existed three times over — in the importer's validation, in two export scripts — and
 * nowhere the screens could reach, which is why a planned run showed no distance at all:
 * `metrics` read `distance_m`, and that is the distance a *recorded* activity covered, so it is
 * null until the session has been run. An 18 km Sunday displayed as "95 min" and its card line
 * described the first 8 km block, so the plan looked like it had lost ten kilometres.
 *
 * Repeats are expanded, because a repeat block is the most common way to get this wrong. The
 * `m`-under-60-is-minutes rule is the same one `humanDose` applies: "10m Z2 warm up" is ten
 * minutes and "800m" is metres. A step with a duration and a pace contributes the distance that
 * duration covers at that pace; one with neither contributes nothing, which is correct for a
 * station.
 */
export function prescribedKm(target: string | null | undefined): number {
  let km = 0;
  for (const g of parseSteps(target)) {
    for (const st of g.items) {
      const m = /^(\d+(?:\.\d+)?)\s*(km|k|m|mi|min|s|sec)\b/i.exec(st.dose.trim());
      if (!m) continue;
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      const seconds = paceSecondsOf(st.pace);
      let d = 0;
      if (unit === "km" || unit === "k") d = n;
      else if (unit === "mi") d = n * 1.609;
      else if (unit === "m") d = n < 60 ? (seconds ? (n * 60) / seconds : 0) : n / 1000;
      else if (unit === "min") d = seconds ? (n * 60) / seconds : 0;
      else d = seconds ? n / seconds : 0;
      km += d * g.repeat;
    }
  }
  return Math.round(km * 10) / 10;
}

/** The midpoint of a pace or pace range, in seconds per km. */
function paceSecondsOf(pace: string | null): number {
  const all = [...(pace ?? "").matchAll(/(\d{1,2}):([0-5]\d)/g)]
    .map((m) => Number(m[1]) * 60 + Number(m[2]));
  return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
}

/**
 * How many work reps a prescription genuinely repeats.
 *
 * `repCount` counts every work step, which is right for an interval session and wrong for
 * everything else: an 8 km easy run with six strides on the end came back as "7 reps", and an
 * 18 km long run with three tempo blocks in it as "5". A continuous run has no reps, and saying
 * it has one is worse than saying nothing.
 *
 * Only groups that actually repeat count, so a session with no repeat block returns 0 and the
 * screen can show its distance instead.
 */
export function repeatedReps(target: string | null | undefined): number {
  let n = 0;
  for (const g of parseSteps(target)) {
    if (g.repeat <= 1) continue;
    if (/warm|cool/i.test(g.label)) continue;
    n += g.items.filter((s) => !s.rest).length * g.repeat;
  }
  return n;
}
