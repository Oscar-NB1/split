import type { IntentRange } from "./block";
import { addDays, diffDays, dow, mondayOf } from "./dates";
import {
  ALLOC, BASE_KM, BENCH_VARIANTS, type BenchVariant, DAYS, type Day, type Intake,
  RUN_CEIL, RUN_RAMP, allocationFor, classify, isHyrox, lockedCommitments,
  heavyDays, needsStandards, standardsFor, todayish,
} from "./intake";
import type { Rules, TemplateDay } from "./templates";

/**
 * The block, resolved and built from the intake.
 *
 * Deterministic and pure: the same answers always give the same block, which is
 * what makes it reviewable. Every number traces to a stated answer or to a table
 * in lib/intake.ts, and the decisions the generator makes *against* the answers
 * are returned as corrections rather than applied silently.
 */

const DAY_IDX: Record<Day, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export type PhaseName = "base" | "build" | "specific" | "taper";
const PHASE_KEYS: PhaseName[] = ["base", "build", "specific", "taper"];
const PHASE_LABEL: Record<PhaseName, string> = {
  base: "Base", build: "Build", specific: "Race specific", taper: "Taper",
};

/** Weeks each phase takes, at 30 / 30 / 25 / 15. */
export const phaseSplit = (weeks: number) =>
  [0.3, 0.3, 0.25, 0.15].map((p) => Math.max(1, Math.round(weeks * p)));

// ------------------------------------------------------------- the preferences

/**
 * What the volume preference actually does.
 *
 * The screens explain these to the athlete in so many words — "about 5% a week
 * with a down week every third", "about 12% and this is where injuries come
 * from" — so the generator has to honour them or the explanation is a lie.
 *
 * A preference can lower the resolved ramp freely. It can only raise it up to
 * the safety cap, because the cap exists for the connective tissue and a
 * checkbox does not change that.
 */
export const VOLUME_PREF_RAMP: Record<string, number | null> = {
  Conservative: 5,
  Progressive: null, // whatever the answers resolved to
  Aggressive: 12,
};
export const DELOAD_EVERY: Record<string, number> = {
  Conservative: 3, Progressive: 4, Aggressive: 5,
};

/** Quality sessions a week, and whether the long run carries a pace target. */
export const DIFFICULTY_SHAPE: Record<string, { quality: number; longRunPace: boolean }> = {
  Steady: { quality: 1, longRunPace: false },
  Challenging: { quality: 1, longRunPace: true },
  Hard: { quality: 2, longRunPace: true },
};

// ------------------------------------------------------------------ resolving

export type Correction = { title: string; body: string };

export type Resolved = {
  weeks: number;
  weeksToRace: number;
  start: string;
  raceDate: string | null;
  baseKm: number;
  ceil: number;
  rawStart: number;
  startKm: number;
  baseRamp: number;
  runRamp: number;
  ramp: number;
  deloadEvery: number;
  alloc: [number, number, number];
  paceKnown: boolean;
  fiveK: number;
  goalSeconds: number | null;
  /** why the offer was downgraded, or null */
  gate: string | null;
  variant: BenchVariant;
  offerSuppressed: boolean;
  measured: boolean;
  estimated: boolean;
  planState: "estimated" | "awaiting" | "measured";
  corrections: Correction[];
  phaseSplit: number[];
};

const RACE_M: Record<string, number> = {
  "5 km": 5000, "10 km": 10000, "Half marathon": 21097, Marathon: 42195,
};

/** How long a block runs when no race pins the end of it. */
const DEFAULT_WEEKS = 12;

export function resolve(x: Intake, from: string = todayish()): Resolved {
  const start = mondayOf(addDays(from, 7));
  // Rounded up, not to nearest: a 72-day block rounds to 10 weeks and leaves the
  // race two days outside its own plan. The last week is race week, so the block
  // has to contain race day.
  const weeksToRace = x.raceDate
    ? Math.max(1, Math.ceil((diffDays(x.raceDate, start) + 1) / 7))
    : DEFAULT_WEEKS;
  const weeks = x.raceDate ? Math.max(4, Math.min(24, weeksToRace)) : DEFAULT_WEEKS;

  // The safety gate runs on the answers, before the benchmark is ever offered.
  const gate = (x.injuries ?? "").trim().length ? "Injury noted in your intake"
    : x.base === "Under 3 months" ? "Training base under three months"
    : x.runningSelf === "I do not run" ? "Not yet running continuously"
    : null;

  // The test is never blocked by a missing sled: there is a variant for every
  // level of equipment, and one for when the gate fires.
  const equipment = x.equipment ?? [];
  const variant: BenchVariant = gate ? "submax"
    : equipment.includes("Full Hyrox gym") ? "full"
    : equipment.includes("Sled") || equipment.includes("Barbell") || equipment.includes("Gym") ? "gym"
    : "field";
  const offerSuppressed = weeksToRace < 3;

  const measured = x.benchmark === "logged";
  const estimated = !measured;

  const baseKm = BASE_KM[x.base] ?? 20;
  const ceil = RUN_CEIL[x.runningSelf] ?? 999;
  const rawStart = Math.min(baseKm, ceil);
  // The conservatism differential: not knowing has a cost, and it is stated.
  const startKm = estimated ? Math.round(rawStart * 0.85) : rawStart;

  // Several years of training is what the 12% cap exists for. Without this the
  // cap was unreachable — the base allowance topped out at 10 for every answer,
  // so "measured plans ramp up to 12%" was true of the ceiling and of nothing else.
  const baseRamp = x.base === "Several years" ? 12 : x.base === "Over a year" ? 10 : 8;
  const runRamp = RUN_RAMP[x.runningSelf] ?? 10;
  const cap = estimated ? 8 : 12;
  const resolvedRamp = Math.min(cap, baseRamp, runRamp);
  // a preference may lower the ramp freely, and raise it only to the cap
  const want = VOLUME_PREF_RAMP[x.volume];
  const ramp = want == null ? resolvedRamp : Math.min(cap, baseRamp, runRamp, want) === want
    ? want
    : Math.min(want, resolvedRamp) || resolvedRamp;
  const deloadEvery = DELOAD_EVERY[x.volume] ?? 4;

  const alloc = allocationFor(x);
  const paceKnown = !x.paceUnknown;
  const fiveK = (x.paceMin ?? 32) * 60 + (x.paceSec ?? 0);

  // A goal only exists where the numbers support one. Hyrox comes from station
  // capability, not a 5 km time — so it has none until the baseline lands.
  const riegel = (m: number) => Math.round(fiveK * Math.pow(m / 5000, 1.06));
  const goalSeconds = !paceKnown ? null
    : isHyrox(x.discipline) ? null
    : riegel(RACE_M[x.raceDistance ?? "Half marathon"] ?? 21097);

  const corrections: Correction[] = [];
  if (estimated) {
    corrections.push({
      title: `Week 1 held 15% below your ceiling`,
      body: `Without a benchmark I am working from what you told me, so the first week starts at ${startKm} km rather than ${rawStart} km and the ramp is capped at 8%. I also assume you are a positive splitter until measured — it costs a disciplined athlete almost nothing and saves an undisciplined one from blowing up. Run the benchmark and this comes back up.`,
    });
  }
  if (baseKm > ceil) {
    corrections.push({
      title: `Week 1 volume capped at ${startKm} km`,
      body: `Your training base points at ${baseKm} km, but "${x.runningSelf.toLowerCase()}" caps the first week at ${ceil} km. Aerobic fitness runs ahead of connective tissue, which is exactly how people get hurt in week 3. The cap wins.`,
    });
  }
  if (runRamp < baseRamp) {
    corrections.push({
      title: `Ramp reduced to ${ramp}% a week`,
      body: `Same reason: the engine is trained, the running tissue is not. ${baseRamp}% would be right for your training history and wrong for your legs.`,
    });
  }
  const locked = lockedCommitments(x);
  if (locked.length) {
    const total = locked.reduce((n, c) => n + (x.freq?.[c] ?? 1), 0);
    const days = (x.days ?? []).length || 5;
    const anyFixed = locked.some((c) => (x.commitDay?.[c] ?? []).length > 0);
    corrections.push({
      title: `${locked.map((c) => `${x.freq?.[c] ?? 1}× ${c.toLowerCase()}`).join(", ")} kept in`,
      body: `${total} of the ${days + total} sessions in your week ${total === 1 ? "is" : "are"} not race-specific. Counted at 0.3× aerobic volume, placed away from key sessions${anyFixed ? " on the days you fixed." : "."} Acceptable for a first race aimed at finishing well — worth naming rather than hiding.`,
    });
  }
  if (want != null && want !== resolvedRamp) {
    corrections.push({
      title: `${x.volume} volume: ${ramp}% a week`,
      body: want > resolvedRamp
        ? `You asked for a faster climb than your answers resolve to. ${ramp}% is as far as it goes — the cap is there for the connective tissue, and a preference does not change what that tolerates.`
        : `You asked for a gentler climb than your answers allow, and that is always available. Down weeks come every ${deloadEvery} rather than every 4.`,
    });
  }

  return {
    weeks, weeksToRace, start, raceDate: x.raceDate,
    baseKm, ceil, rawStart, startKm,
    baseRamp, runRamp, ramp, deloadEvery, alloc,
    paceKnown, fiveK, goalSeconds,
    gate, variant, offerSuppressed, measured, estimated,
    planState: measured ? "measured" : x.benchmark === "scheduled" ? "awaiting" : "estimated",
    corrections, phaseSplit: phaseSplit(weeks),
  };
}

// ---------------------------------------------------------------- the volume

export type Week = { n: number; km: number; note: string; phase: PhaseName };

export function volumeFor(x: Intake, r: Resolved): Week[] {
  const out: Week[] = [];
  let km = r.startKm;
  let n = 1;
  r.phaseSplit.forEach((len, pi) => {
    for (let i = 0; i < len && n <= r.weeks; i++) {
      const deload = n % r.deloadEvery === 0 && pi < 3;
      const taper = pi === 3;
      // Race week is not just another taper week. Holding it at 70% left the last
      // week of the block carrying the same volume as the one before it, on the
      // week the only session that matters is the race.
      const raceWeek = n === r.weeks && r.raceDate != null;
      const target = raceWeek ? Math.round(r.startKm * 0.4)
        : taper || deload ? Math.round(km * 0.7)
        : Math.round(km);
      out.push({
        n, km: Math.max(3, target), phase: PHASE_KEYS[pi],
        note: n === 1
          ? (x.benchmark === "scheduled"
              ? "Benchmark test — every pace target is written from it"
              : "Conservative start — run the benchmark to lift it")
          : n === 5 || n === 9 ? "Benchmark retest · identical protocol"
          : raceWeek ? "Race week — nothing you do now makes you fitter"
          : deload ? "Down week"
          : taper ? "Taper"
          : "",
      });
      // a deload does not reset the climb: the working volume carries through
      if (!deload && !taper) km = km * (1 + r.ramp / 100);
      n++;
    }
  });
  // rounding in phaseSplit can leave the table a week short of the block
  while (out.length < r.weeks) {
    out.push({ n: out.length + 1, km: Math.max(3, Math.round(r.startKm * 0.7)), phase: "taper", note: "Taper" });
  }
  return out.slice(0, r.weeks);
}

// ------------------------------------------------------------ the week's shape

export type SlotKey =
  | "keySession" | "easyRun" | "easyRun2" | "stations" | "strength" | "longRun" | "benchmark";

export const SLOT_TITLE: Record<SlotKey, string> = {
  keySession: "Run session", easyRun: "Easy run", easyRun2: "Second easy run",
  stations: "Station session", strength: "Strength + sled", longRun: "Long run",
  benchmark: "Benchmark test",
};

const KIND_OF: Record<SlotKey, string> = {
  keySession: "run_intervals", easyRun: "run_easy", easyRun2: "run_easy",
  stations: "hyrox", strength: "strength", longRun: "run_long", benchmark: "hyrox",
};

export type Placed = { day: number; slot: "AM" | "PM"; template: SlotKey | string };

/**
 * Which day carries what.
 *
 * The sessions the block cannot do without come first when days are scarce, the
 * long run lands on the last available day, and locked commitments go on the day
 * they are fixed to — or, if they float, the least loaded day that is not a key
 * day. Their stated days always win: the plan someone actually does beats the
 * plan that is better on paper.
 */
export function placeWeek(x: Intake, r: Resolved): Placed[] {
  // A day a high-leg-cost commitment already owns is not a free training day.
  // Leaving it in the pool put a station session on top of her spin class.
  const spent = new Set(heavyDays(x));
  const days = [...new Set(x.days ?? [])]
    .filter((d) => DAYS.includes(d) && !spent.has(DAY_IDX[d]))
    .sort((a, b) => DAY_IDX[a] - DAY_IDX[b]);
  const stations = isHyrox(x.discipline);
  const hard = DIFFICULTY_SHAPE[x.difficulty]?.quality ?? 1;

  const priority: SlotKey[] = [
    "keySession", "longRun", stations ? "stations" : "easyRun", "strength", "easyRun", "easyRun2",
  ];
  const picked = priority.slice(0, Math.max(1, days.length));
  // a second quality session, where the difficulty asks for one and there is room
  if (hard > 1 && picked.length > 3 && !picked.includes("easyRun2")) {
    const swap = picked.lastIndexOf("easyRun");
    if (swap > -1) picked[swap] = "keySession";
  }

  const slots = days.slice(0, picked.length).map((d) => DAY_IDX[d]);
  // the long run goes last, whatever order the priority list produced
  const arranged = picked.slice();
  const li = arranged.indexOf("longRun");
  if (li > -1) { arranged.splice(li, 1); arranged.push("longRun"); }

  const out: Placed[] = slots.map((day, i) => ({ day, slot: "AM", template: arranged[i] }));

  // An accepted benchmark replaces the first session of week 1 rather than being
  // a separate flow. It is written into the template so it lands as a real session.
  if (x.benchmark === "scheduled" && out.length) out[0] = { ...out[0], template: "benchmark" };

  const keyDays = out
    .filter((w) => w.template === "keySession" || w.template === "longRun" || w.template === "stations")
    .map((w) => w.day);

  for (const c of lockedCommitments(x)) {
    const key = `commit:${c}`;
    const fixed = x.commitDay?.[c] ?? [];
    const n = x.freq?.[c] ?? 1;
    for (let i = 0; i < n; i++) {
      let day: number;
      if (fixed[i] != null) {
        day = DAY_IDX[fixed[i]];
      } else {
        const taken = out.map((w) => w.day);
        const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !keyDays.includes(d) && !taken.includes(d));
        day = free.length ? free[0] : [0, 1, 2, 3, 4, 5, 6].filter((d) => !keyDays.includes(d))[i % 4] ?? 6;
      }
      out.push({ day, slot: out.some((w) => w.day === day) ? "PM" : "AM", template: key });
    }
  }
  return out;
}

// ------------------------------------------------------------ what to prescribe

/** Easy and key pace per kilometre, from the 5 km time or by effort. */
export const paces = (r: Resolved) => ({
  easy: r.paceKnown ? Math.round(r.fiveK / 5) + 75 : null,
  key: r.paceKnown ? Math.round(r.fiveK / 5) + 10 : null,
});

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Sled loading as a share of race weight, by phase. */
const SLED_PCT: Record<PhaseName, number> = { base: 0.6, build: 0.8, specific: 1.0, taper: 0.5 };
const sledPct = (x: Intake, phase: PhaseName) =>
  x.sled === "Never used one" ? Math.max(0.5, SLED_PCT[phase] - 0.2) : SLED_PCT[phase];

/**
 * The strength session, with real kilos where the division is known and a share
 * of race weight where it is not.
 *
 * Never a number nobody verified: arriving at a station heavier than anything you
 * have trained on is the failure this avoids.
 */
export function strengthFor(x: Intake, phase: PhaseName): string | null {
  const has = (e: string) => (x.equipment ?? []).includes(e as never);
  const gym = has("Full Hyrox gym") || has("Barbell") || has("Gym") || has("Sled");
  if (!gym) return null;

  const std = standardsFor(x);
  const share = sledPct(x, phase);
  const lines: string[] = [];

  if (has("Barbell") || has("Full Hyrox gym")) {
    lines.push("Back squat 4×5", "Romanian deadlift 3×8", "Overhead press 3×8");
  } else {
    lines.push("Goblet squat 3×8", "Single-leg RDL 3×8 each", "Press-up 3×12");
  }

  if (has("Sled") || has("Full Hyrox gym")) {
    if (phase === "specific") {
      lines.push(std ? `Sled push ${std.sled_push_total_kg} kg loaded, 50 m` : "Sled push at race weight, race distance");
      lines.push(std ? `Sled pull ${std.sled_pull_total_kg} kg loaded, 50 m` : "Sled pull at race weight, race distance");
    } else {
      lines.push(std
        ? `Sled push ${Math.round(std.sled_push_total_kg * share)} kg loaded, 12.5 m × 4`
        : `Sled push ${Math.round(share * 100)}% of race weight, 12.5 m × 4`);
    }
  }
  // Base is technique and base strength only. Front-loading every station is how
  // week 1 leaves someone too sore to run the week it is meant to build.
  if (has("Wall balls") || has("Full Hyrox gym")) {
    if (phase !== "base") {
      const w = std ? `${std.wall_ball_kg} kg ` : "";
      lines.push(phase === "build" ? `Wall ball technique ${w}3×10` : `Wall balls ${w}4×15`);
    }
  }
  if (phase === "specific" && has("Full Hyrox gym")) {
    lines.push(std ? `Sandbag lunges ${std.lunge_kg} kg, 3×20 m` : "Sandbag lunges 3×20 m");
  }
  if (phase !== "base" && (has("Full Hyrox gym") || has("Barbell"))) {
    lines.push(std ? `Farmers carry 2 × ${std.farmers_kg} kg, 2×50 m` : "Farmers carry 2×50 m");
  }
  return lines.join("\n");
}

/** The benchmark, as blocks. Identical every time it runs, deliberately. */
export function benchmarkTarget(r: Resolved): string {
  const bv = BENCH_VARIANTS[r.variant];
  return bv.stations.map((s, i) => `Round ${i + 1}: 400 m run → ${s}`).join("\n");
}

export const benchmarkNote = (r: Resolved) =>
  `${BENCH_VARIANTS[r.variant].label} variant · ${r.variant === "submax" ? "three" : "four"} rounds. ` +
  (r.variant === "submax" ? "RPE 7, not all out." : "Hard but complete.") +
  (r.gate ? ` ${r.gate}, so this is the submaximal version.` : "") +
  " Record every split, heart rate throughout, and where you stopped — four run splits give a fade curve, and the curve is what separates an aerobic limiter from a strength one.";

// ------------------------------------------------------------------ the block

export type GeneratedPlan = {
  name: string;
  start: string;
  weeks: number;
  race_date: string | null;
  race_name: string | null;
  goal_label: string | null;
  goal_seconds: number | null;
  volume: { km: number; note: string }[];
  intents: IntentRange[];
  shapes: TemplateDay[][];
  rules: Rules;
  plan_state: Resolved["planState"];
  benchmark: { variant: BenchVariant; submaximal: boolean; protocol_version: number; scheduled: boolean; retests: number[] };
  guardrails: string[];
  easy_pace: number | null;
  corrections: Correction[];
  flags: string[];
};

export function intentsFor(x: Intake, r: Resolved): IntentRange[] {
  const stations = isHyrox(x.discipline);
  const purpose = [
    "Get to a volume your body already knows, on effort rather than pace. Week 1 is a baseline test — everything after it re-prescribes from those numbers.",
    `Volume climbs ${r.ramp}% a week toward the ceiling. The adaptation to look for is the same pace at a lower heart rate.`,
    "The key session becomes the race. Station work moves from fitness to rehearsal: transitions, splits, order.",
    "Volume drops, intensity holds. Nothing you do now makes you fitter — this phase only protects the work.",
  ];
  const out: IntentRange[] = [];
  let from = 1;
  r.phaseSplit.forEach((len, i) => {
    if (from > r.weeks) return;
    const to = Math.min(r.weeks, from + len - 1);
    out.push({
      from, to,
      phase: `${PHASE_LABEL[PHASE_KEYS[i]]} · ${from === to ? `week ${from}` : `weeks ${from}–${to}`}`,
      purpose: purpose[i],
      protect: i === 0 ? ["Baseline test", "Long run"]
        : i === 3 ? ["Race day"]
        : ["Key run session", stations ? "Station session" : "Long run"],
      sacrifice: i === 3
        ? "Any session you are unsure about. In doubt, rest."
        : "Strength first, then the second easy run. Never the long run.",
      watch: i === 0
        ? "Easy runs run too quick. That is what costs you the key session."
        : "Two hard days a week. Classes are not a third.",
    });
    from = to + 1;
  });
  if (out.length && out[out.length - 1].to < r.weeks) out[out.length - 1].to = r.weeks;
  return out;
}

/** Everything the plan cannot decide, named rather than hidden. */
export function flagsFor(x: Intake, r: Resolved): string[] {
  const out: string[] = [];
  if (!r.paceKnown) {
    out.push("No pace anchor. Sessions run on effort and heart rate until the baseline gives real numbers.");
  }
  if (needsStandards(x)) {
    out.push("No division picked yet, so sled and wall ball are prescribed as a share of race weight. Pick the division you are entered in and the sessions carry real loads.");
  }
  if (r.offerSuppressed && x.raceDate) {
    out.push(`Your race is ${r.weeksToRace} weeks away. Too close to spend a session testing, so the plan is generated from your answers.`);
  }
  if (r.gate) out.push(`${r.gate}, so the benchmark is the submaximal variant: RPE 7 rather than all out, and one round fewer.`);
  if (x.hasRace === "No") out.push("No race date, so this is a twelve-week goal block rather than a countdown.");
  return out;
}

export function generate(x: Intake, from: string = todayish()): GeneratedPlan {
  const r = resolve(x, from);
  const table = volumeFor(x, r);
  const placed = placeWeek(x, r);
  const { easy, key } = paces(r);
  const stations = isHyrox(x.discipline);
  const raceDay = x.raceDate ? dow(x.raceDate) : null;
  const longPace = DIFFICULTY_SHAPE[x.difficulty]?.longRunPace ?? true;

  const shapes: TemplateDay[][] = table.map((w) => {
    const phase = w.phase;
    const days: TemplateDay[] = [];
    const raceWeek = w.n === r.weeks && raceDay != null;
    const firstSlot = placed.find((p) => !String(p.template).startsWith("commit:"));

    for (const p of placed) {
      // race week keeps a shakeout and the race, nothing else
      // In race week only the first slot survives, as a shakeout — and it survives
      // whether that slot holds the key session or the benchmark, which is what
      // silently removed it when the test was scheduled.
      if (raceWeek && (p.day >= raceDay! || p !== firstSlot)) continue;

      if (typeof p.template === "string" && p.template.startsWith("commit:")) {
        const name = p.template.slice(7);
        const cls = classify(name);
        days.push({
          day: p.day, kind: "other", title: name, minutes: 45, slot: p.slot,
          coach_note: `${cls.why} Counted at ${cls.volume_multiplier}× aerobic volume, placed away from key days.`,
        });
        continue;
      }

      let t = p.template as SlotKey;
      const retestWeek = w.n === 5 || w.n === 9;
      const isBench = t === "benchmark" && (w.n === 1 || retestWeek);
      // outside the test weeks the slot goes back to being the key session,
      // rather than every week of the block carrying a benchmark
      if (t === "benchmark" && !isBench) t = "keySession";
      if (raceWeek) {
        days.push({ day: p.day, kind: "run_easy", title: "Shakeout", minutes: 25, slot: p.slot,
          coach_note: "Legs awake, nothing more." });
        continue;
      }
      if (isBench) {
        days.push({
          day: p.day, kind: "hyrox",
          title: w.n === 1 ? "BENCHMARK TEST" : "BENCHMARK RETEST",
          minutes: 45, slot: p.slot,
          target: benchmarkTarget(r), significance: "benchmark",
          coach_note: w.n === 1
            ? benchmarkNote(r)
            : "Identical protocol. A retest on a different protocol compares nothing.",
        });
        continue;
      }

      const share = w.km * (t === "longRun" ? 0.42 : t === "easyRun" ? 0.33 : t === "easyRun2" ? 0.25 : 0.2);
      const km = Math.max(3, Math.round(share));
      switch (t) {
        case "keySession":
          days.push({
            day: p.day, kind: KIND_OF[t], title: key ? `Run session @ ${mmss(key)}` : "Run session",
            minutes: 45, slot: p.slot, significance: "key",
            target: "5 × 800 m, 90 s jog",
            coach_note: key
              ? "Even splits. Rep 1 fastest means the session failed, whatever the average says."
              : "By effort until the baseline gives numbers.",
          });
          break;
        case "longRun":
          days.push({
            day: p.day, kind: KIND_OF[t], title: `Long run ${km} km`, minutes: km * 6, slot: p.slot,
            coach_note: longPace && easy
              ? `Time on feet, around ${mmss(easy - 10)} /km. Pace is not the point.`
              : "Time on feet. Pace is not the point.",
          });
          break;
        case "stations": {
          const target = strengthFor(x, phase);
          days.push({
            day: p.day, kind: KIND_OF[t], title: "Station session", minutes: 55, slot: p.slot,
            target: target ?? undefined,
            coach_note: "Stations with compromised running between them — the thing the race actually asks for.",
          });
          break;
        }
        case "strength": {
          const target = strengthFor(x, phase);
          if (!target) break;
          days.push({
            day: p.day, kind: KIND_OF[t], title: stations ? "Strength + sled" : "Strength",
            minutes: 45, slot: p.slot, target,
            coach_note: needsStandards(x)
              ? "Sled loads are a share of race weight — your division's standards are not loaded, so confirm them before loading a sled."
              : "Loads are your division's race weights. Two reps in reserve on the lifts.",
          });
          break;
        }
        default:
          days.push({
            day: p.day, kind: KIND_OF[t], title: `${SLOT_TITLE[t]} ${km} km`, minutes: km * 6, slot: p.slot,
            coach_note: "Conversational. Walk breaks are fine.",
          });
      }
    }

    if (raceWeek) {
      days.push({
        day: raceDay!, kind: "hyrox",
        title: x.discipline + (x.hasRace === "Yes" ? "" : " · goal block"),
        minutes: 75, slot: "AM", significance: "race",
        coach_note: "Race day. Hold back on the first run — everyone goes out hot.",
      });
    }
    return days;
  });

  return {
    name: `${x.discipline} · ${r.weeks} weeks`,
    start: r.start,
    weeks: r.weeks,
    race_date: x.raceDate,
    race_name: x.raceDate ? x.discipline : null,
    goal_label: r.goalSeconds ? mmss(r.goalSeconds) : null,
    goal_seconds: r.goalSeconds,
    volume: table.map((w) => ({ km: w.km, note: w.note })),
    intents: intentsFor(x, r),
    shapes,
    // the table is written out week by week, so the engine must not progress it too
    rules: { long_run_delta_min: 0, deload_every: 0, fatigue_skips_to_deload: 2, fatigue_cut: 0.85 },
    plan_state: r.planState,
    benchmark: {
      variant: r.variant, submaximal: r.variant === "submax",
      protocol_version: 1, scheduled: x.benchmark === "scheduled", retests: [5, 9],
    },
    guardrails: [
      x.role ? `${x.role} partner` : x.discipline,
      "Easy runs by HR",
      `${r.ramp}% ramp`,
      `${DIFFICULTY_SHAPE[x.difficulty]?.quality ?? 1} hard ${(DIFFICULTY_SHAPE[x.difficulty]?.quality ?? 1) === 1 ? "day" : "days"} a week`,
    ],
    easy_pace: easy,
    corrections: r.corrections,
    flags: flagsFor(x, r),
  };
}
