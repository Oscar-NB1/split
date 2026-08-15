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
const ZONE = /\b(Z[1-5])\b/i;
const DOSE = /^(\d+(?:\.\d+)?\s*(?:m|km|k|min|s|sec|mi))\b/i;

/** One "- 800m Z4 walk" line. */
function parseStep(raw: string): Step | null {
  const line = raw.replace(/^[-•*]\s*/, "").trim();
  if (!line) return null;

  const zoneMatch = line.match(ZONE);
  const zone = zoneMatch ? zoneMatch[1].toUpperCase() : null;
  const doseMatch = line.match(DOSE);
  const dose = doseMatch ? doseMatch[1].replace(/\s+/g, "") : "";

  const label = line
    .replace(DOSE, "")
    .replace(ZONE, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    dose,
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

    const m = line.match(/^(.+?)\s+(\d+)\s*[x×]\s*(\d+)\s*(?:@\s*([\d.]+)\s*(?:kg)?)?$/i);
    if (!m) {
      // unreadable, but not thrown away — a lift with no set scheme is still a lift
      out.push({ name: line, sets: 0, reps: 0, load: null });
      continue;
    }
    out.push({
      name: m[1].trim(),
      sets: Number(m[2]),
      reps: Number(m[3]),
      load: m[4] === undefined ? null : Number(m[4]),
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
export function humanDose(dose: string): string {
  const m = dose.match(/^(\d+(?:\.\d+)?)\s*(km|k|m|min|s|sec|mi)$/i);
  if (!m) return dose;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  // intervals.icu writes minutes as "15m" and metres as "800m". A bare "m"
  // under 60 with no other clue is minutes; above that it is metres. Ambiguous
  // by design in the source format, so this is where the guess is made once.
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
