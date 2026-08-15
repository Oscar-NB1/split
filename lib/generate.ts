import type { IntentRange } from "./block";
import { addDays, diffDays, dow, mondayOf } from "./dates";
import {
  type Commitment, COMMITMENT, GOAL_LABEL, type Intake, type RunningSelf,
  RACE_SHAPE, allocationFor, heavyDays, isHyrox, needsStandards, rampRate,
  standardsFor, startVolume, todayish,
} from "./intake";
import type { Rules, TemplateDay } from "./templates";

/**
 * The block, built from the intake.
 *
 * Deterministic and pure: the same answers always give the same block, which is
 * what makes it reviewable. Nothing here reaches for a number that is not either
 * stated by the athlete or defined in a table in lib/intake.ts.
 */

const DAY_NAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------- the phases

export type PhaseName = "base" | "build" | "specific" | "taper";

/** Share of the block each phase takes. */
const PHASE_SPLIT: [PhaseName, number][] = [
  ["base", 0.30], ["build", 0.30], ["specific", 0.25], ["taper", 0.15],
];

/**
 * Which phase each week belongs to.
 *
 * Taper is at least one week and race week is always taper, however short the
 * block is — a two-week block is one week of work and one of not undoing it.
 */
export function phases(weeks: number): PhaseName[] {
  const out: PhaseName[] = [];
  let assigned = 0;
  PHASE_SPLIT.forEach(([name, share], i) => {
    const last = i === PHASE_SPLIT.length - 1;
    const n = last ? weeks - assigned : Math.max(name === "taper" ? 1 : 0, Math.round(weeks * share));
    for (let k = 0; k < n; k++) out.push(name);
    assigned += n;
  });
  // rounding can overshoot on short blocks; the taper is what survives
  while (out.length > weeks) out.splice(out.findIndex((p) => p === "base"), 1);
  while (out.length < weeks) out.splice(0, 0, "base");
  if (out[out.length - 1] !== "taper") out[out.length - 1] = "taper";
  return out;
}

/** Deload every fourth week, but never the last week of the block. */
export const isDeload = (n: number, weeks: number) => n % 4 === 0 && n < weeks;

/**
 * Baseline test weeks: the first week, then the week after each deload.
 *
 * Testing after a down week is the point — a benchmark run on tired legs tells you
 * nothing, and re-testing on the same protocol is the only way the comparison
 * means anything.
 */
export const isBaseline = (n: number, weeks: number) =>
  n === 1 || (isDeload(n - 1, weeks) && n < weeks);

/**
 * The baseline protocol. Identical every time it is run, deliberately.
 *
 * It produces the four things an intake cannot: a pace anchor, station capability,
 * whether the limiter is aerobic or strength, and how they pace themselves.
 */
export const BASELINE_TEST =
  "4 x 500m run, alternating with:\n" +
  "- Ski 250m\n- Sled push 12.5m\n- Burpee broad jump 20m\n- Wall balls 15";

export const BASELINE_NOTE =
  "Record every split, heart rate throughout, where you stopped, and how fast HR " +
  "recovers between efforts. Everything after this is re-prescribed from it.";

// ---------------------------------------------------------------- the volume

export type Week = { n: number; km: number; note: string; phase: PhaseName };

/**
 * The weekly volume table.
 *
 * Climbs by the ramp rate from the previous *working* week, so a deload does not
 * reset the progression — a week-9 peak lower than week 7 is what happens when it
 * does. Deloads take 70%, taper 60%, race week 35%.
 */
export function volumeFor(x: Intake, weeks: number, raceDays: number | null): Week[] {
  const start = startVolume(x);
  const ramp = rampRate(x);
  const ph = phases(weeks);
  const out: Week[] = [];
  let working = start;

  for (let n = 1; n <= weeks; n++) {
    const phase = ph[n - 1];
    const raceWeek = n === weeks && raceDays != null;
    let km: number;
    let note = "";

    if (raceWeek) {
      km = Math.round(start * 0.4);
      note = "Race week — nothing you do now makes you fitter.";
    } else if (phase === "taper") {
      km = Math.round(working * 0.75);
      note = "Taper. The volume drop is the training now.";
    } else if (isDeload(n, weeks)) {
      km = Math.round(working * 0.7);
      note = "Deload — the drop is the point of the week.";
    } else {
      if (n > 1) working = working * (1 + ramp);
      km = Math.round(working);
    }
    if (isBaseline(n, weeks)) {
      note = n === 1 ? "Baseline test — everything downstream re-prescribes from it."
        : "Baseline retest, same protocol.";
    }
    out.push({ n, km: Math.max(3, km), note, phase });
  }
  return out;
}

// ------------------------------------------------------- the running ladder

/**
 * Run/walk to continuous, in four rungs.
 *
 * Where someone starts is what they say they can run, not how long they have
 * trained. Climbing a rung per phase is what turns "runs with walk breaks" into
 * continuous running by the specific phase — which is the actual goal of a first
 * block. Not stopping matters more than being fast.
 */
const RUNGS = [
  { key: 0, quality: "6 x (3 min run / 1 min walk)", easy: "25–30 min run/walk, easy",
    hyrox: "4 x (500 m run/walk + 1 station)" },
  { key: 1, quality: "4 x (6–8 min run / 1 min walk)", easy: "30–35 min, longer run blocks",
    hyrox: "5 x (600 m + 1 station)" },
  { key: 2, quality: "5 x 800 m continuous, walk recovery", easy: "35 min continuous",
    hyrox: "6 x 800 m + stations, race order" },
  { key: 3, quality: "6 x 1000 m continuous", easy: "40–45 min continuous",
    hyrox: "Full station circuit, race order, continuous" },
] as const;

const START_RUNG: Record<RunningSelf, number> = {
  doesnt_run: 0, walk_breaks: 0, "5k_nonstop": 2, runs_regularly: 3,
};

const PHASE_STEP: Record<PhaseName, number> = { base: 0, build: 1, specific: 2, taper: 2 };

export const rungFor = (x: Intake, phase: PhaseName) =>
  RUNGS[Math.min(RUNGS.length - 1, START_RUNG[x.running_self] + PHASE_STEP[phase])];

// ------------------------------------------------------------ sled + strength

/**
 * Sled loading as a share of race weight, by phase.
 *
 * A percentage rather than a number of kilos, because the kilos come from the
 * division's official standards and those are not in this codebase — see
 * STANDARDS in lib/intake.ts. Printing a weight nobody verified is how an athlete
 * arrives at a station heavier than anything they have trained on.
 */
const SLED_PCT: Record<PhaseName, number> = { base: 0.6, build: 0.8, specific: 1.0, taper: 0.5 };

/** Someone who has never pushed a sled starts a rung lower, whatever the phase. */
const sledPct = (x: Intake, phase: PhaseName) =>
  x.sled_experience === "never" ? Math.max(0.5, SLED_PCT[phase] - 0.2) : SLED_PCT[phase];

export function strengthFor(x: Intake, phase: PhaseName): string | null {
  if (x.gym_access === "none") return null;
  const has = (e: string) => x.equipment.includes(e as never);
  const lines: string[] = [];

  if (has("barbell")) lines.push("Back squat 3x5", "Romanian deadlift 3x8", "Overhead press 3x8");
  else if (has("dumbbells") || has("kettlebell")) lines.push("Goblet squat 3x8", "Single-leg RDL 3x8 each", "Push press 3x8");
  else lines.push("Split squat 3x10 each", "Hip hinge 3x12", "Press-up 3x12");
  if (has("pull_up_bar")) lines.push("Pull-up 3x6");

  // Real kilos when the division's standards are loaded, a share of race weight
  // when they are not. Never a number nobody verified: arriving at a station
  // heavier than anything you have trained on is the failure this avoids.
  const std = standardsFor(x);
  const share = sledPct(x, phase);
  const kg = (full: number) => `${Math.round(full * share)} kg`;

  if (has("sled")) {
    if (phase === "specific") {
      lines.push(std
        ? `Sled push ${std.sled_push_total_kg} kg loaded, ${RACE_SHAPE.sled_push_m} m`
        : `Sled push at race weight, race distance`);
      lines.push(std
        ? `Sled pull ${std.sled_pull_total_kg} kg loaded, ${RACE_SHAPE.sled_pull_m} m`
        : `Sled pull at race weight, race distance`);
    } else {
      lines.push(std
        ? `Sled push ${kg(std.sled_push_total_kg)} loaded, 12.5 m x 4`
        : `Sled push ${Math.round(share * 100)}% of race weight, 12.5 m x 4`);
    }
  }
  // Base is technique and base strength only — squat, hinge, press, row, sled.
  // Farmers and wall ball come in from the build phase, and sandbag last of all.
  // Front-loading every station is how week 1 leaves someone too sore to run.
  if (has("wall_ball") && phase !== "base") {
    const w = std ? `${std.wall_ball_kg} kg ` : "";
    lines.push(phase === "build" ? `Wall ball technique ${w}3x10` : `Wall balls ${w}4x15`);
  }
  // last, on purpose: the highest soreness cost of any station
  if (has("sandbag") && phase === "specific") {
    lines.push(std ? `Sandbag lunges ${std.lunge_kg} kg, 3x20 m` : "Sandbag lunges 3x20 m");
  }
  if (has("kettlebell") && phase !== "base") {
    lines.push(std ? `Farmers carry 2 x ${std.farmers_kg} kg, 2x50 m` : "Farmers carry 2x50 m");
  }
  return lines.join("\n");
}

/** The stations they can actually do, in race order. */
export function stationsFor(x: Intake): string | null {
  if (!isHyrox(x.goal_kind)) return null;
  const has = (e: string) => x.equipment.includes(e as never);
  const can: string[] = [];
  if (has("skierg")) can.push("SkiErg 500 m");
  if (has("sled")) can.push("Sled push 25 m", "Sled pull 25 m");
  can.push("Burpee broad jump 30 m"); // needs nothing
  if (has("rower")) can.push("Row 500 m");
  if (has("kettlebell")) can.push("Farmers carry 100 m");
  if (has("sandbag")) can.push("Sandbag lunge 50 m");
  if (has("wall_ball")) can.push("Wall balls 40");
  return can.join("\n");
}

// ------------------------------------------------------------------ the week

/**
 * Which day carries what.
 *
 * Their stated days win, always: the plan someone actually does beats the plan
 * that is better on paper. A day already spent by a high-leg-cost commitment is
 * never given a key session, and never sits the day before one.
 */
export function daysFor(x: Intake): {
  quality: number | null; easy: number | null; hyrox: number | null;
  strength: number | null; heavy: number[];
} {
  const want = Math.min(7, Math.max(2, x.days_per_week));
  const heavy = heavyDays(x);
  const stated = [...new Set(x.preferred_days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const pool = (stated.length >= want ? stated : [...new Set([...stated, 1, 3, 5, 6, 0, 2, 4])])
    .filter((d) => !heavy.includes(d))
    .slice(0, want);

  // The day AFTER a high-cost commitment is the compromised one — the legs are
  // already spent. The day before is fine, and penalising it too pushed the key
  // run to the end of the week: with a Wednesday spin class, Tuesday is exactly
  // where the quality session belongs, with the easy day absorbing Thursday.
  const cost = (d: number) => (heavy.includes((d + 6) % 7) ? 2 : 0);
  const ranked = [...pool].sort((a, b) => cost(a) - cost(b) || a - b);

  const hyrox = isHyrox(x.goal_kind)
    ? (pool.includes(6) ? 6 : pool.includes(5) ? 5 : ranked[ranked.length - 1] ?? null)
    : null;
  const free = () => ranked.filter((d) => ![hyrox, quality, easy, strength].includes(d));

  // The quality run goes on the cleanest day, and the easy run deliberately takes
  // the dirtiest — the day after a spin class is where an easy run belongs and a
  // key session does not. Assigning strength first took that day instead, and left
  // the easy run on the fresh Friday: the right sessions, the wrong way round.
  let quality: number | null = null, easy: number | null = null, strength: number | null = null;
  quality = free()[0] ?? null;
  easy = [...free()].sort((a, b) => cost(b) - cost(a) || a - b)[0] ?? null;
  strength = x.gym_access === "none" ? null : free()[0] ?? null;

  return { quality, easy, hyrox, strength, heavy };
}

/** One week, as day shapes. */
export function weekShape(
  x: Intake, week: Week, weeks: number, raceDay: number | null,
): TemplateDay[] {
  const { quality, easy, hyrox, strength } = daysFor(x);
  const rung = rungFor(x, week.phase);
  const days: TemplateDay[] = [];
  const raceWeek = week.n === weeks && raceDay != null;
  const anchored = x.recent_5k_seconds != null;

  if (raceWeek) {
    // a short, quiet week: one shakeout, then the race
    if (quality != null && quality < raceDay) {
      days.push({ day: quality, kind: "run_easy", title: "Shakeout", minutes: 25, slot: "AM",
        coach_note: "Legs awake, nothing more." });
    }
    days.push({
      day: raceDay, kind: "hyrox",
      title: x.goal_race_name ?? GOAL_LABEL[x.goal_kind],
      minutes: 75, slot: "AM", significance: "race",
      coach_note: "Race day. Hold back on the first run — everyone goes out hot.",
    });
    return days;
  }

  // --- the quality run, or the baseline test ---------------------------------
  if (quality != null) {
    days.push(isBaseline(week.n, weeks)
      ? {
          day: quality, kind: "hyrox",
          title: week.n === 1 ? "BASELINE TEST" : "BASELINE RETEST",
          minutes: 45, slot: "AM", target: BASELINE_TEST,
          significance: "benchmark", coach_note: BASELINE_NOTE,
        }
      : {
          day: quality, kind: "run_intervals",
          title: rung.quality, minutes: 45, slot: "AM",
          target: rung.quality, significance: "key",
          coach_note: anchored
            ? "Even splits. Rep 1 fastest means the session failed, whatever the average says."
            : "By effort and heart rate — there is no pace target until the baseline gives one.",
        });
  }

  // --- the easy run ----------------------------------------------------------
  if (easy != null) {
    days.push({
      day: easy, kind: "run_easy", title: rung.easy, minutes: 35, slot: "AM",
      coach_note: "Conversational the whole way. If you cannot talk, it is too fast.",
    });
  }

  // --- the Hyrox session -----------------------------------------------------
  if (hyrox != null) {
    const stations = stationsFor(x);
    const sim = week.phase === "specific" && week.n === weeks - 2;
    days.push(stations
      ? {
          day: hyrox, kind: "hyrox",
          title: sim ? "HALF SIMULATION" : rung.hyrox,
          minutes: sim ? 70 : 55, slot: "AM", target: stations,
          significance: sim ? "key" : undefined,
          coach_note: sim
            ? "Half the race distance, full race order. Pacing and transitions, not a time."
            : "Stations straight into runs. This is the thing the race actually asks for.",
        }
      : {
          day: hyrox, kind: "run_long", title: rung.easy, minutes: 50, slot: "AM",
          coach_note: "No stations available, so this is the week's second run instead.",
        });
  }

  // --- strength + sled -------------------------------------------------------
  const work = strengthFor(x, week.phase);
  if (strength != null && work) {
    days.push({
      day: strength, kind: "strength",
      title: x.equipment.includes("sled") ? "Strength + sled" : "Strength",
      minutes: 45, slot: "AM", target: work,
      coach_note: needsStandards(x)
        ? "Sled loads are a share of race weight — your division's standards are not loaded, so confirm them before loading a sled."
        : "Loads are your division's race weights. Two reps in reserve on the lifts: this supports the running, it does not compete with it.",
    });
  }

  // --- the commitments they already have -------------------------------------
  for (const c of x.commitments) {
    if (c.day == null) continue;
    const cls = COMMITMENT[c.kind];
    days.push({
      day: c.day, kind: "other", title: c.name || c.kind, minutes: 45, slot: "PM",
      coach_note: `${cls.why} Counted at ${cls.volume_multiplier}x aerobic volume.`
        + (week.phase === "specific" && cls.leg_cost === "high"
          ? " Alternate weeks from here — the leg-cost budget goes to running."
          : ""),
    });
  }
  return days;
}

// ----------------------------------------------------------------- the block

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
  /** Things the plan cannot answer and somebody has to. */
  flags: string[];
};

const DEFAULT_WEEKS = 12;

export function intentsFor(x: Intake, weeks: number): IntentRange[] {
  const ph = phases(weeks);
  const alloc = allocationFor(x);
  const out: IntentRange[] = [];
  const start = startVolume(x);
  const heavy = x.commitments.filter((c) => COMMITMENT[c.kind].leg_cost === "high");

  const purpose: Record<PhaseName, string> = {
    base: `Make the week itself repeatable at ${start} km. ` +
      (x.running_self === "walk_breaks" || x.running_self === "doesnt_run"
        ? "Run/walk intervals, deliberately — the aim is that the running becomes continuous, not that it becomes fast."
        : "Nothing here is meant to hurt; the block is bought by finishing every week."),
    build: "Volume climbs toward this block's ceiling, and the run blocks get longer. " +
      "The adaptation to want is the same pace at a lower heart rate.",
    specific: isHyrox(x.goal_kind)
      ? "Stations stop being fitness and become rehearsal: transitions, splits, roxzone. Running goes continuous."
      : `Sessions take the shape of the ${GOAL_LABEL[x.goal_kind]}. Volume holds; the intensity gets specific.`,
    taper: "Volume drops, intensity stays. The work is done; this only protects it.",
  };
  const watch: Record<PhaseName, string> = {
    base: "Easy runs run too hard are the failure mode. They cost the one quality session.",
    build: "Two hard days a week, no more. Everything else stays easy.",
    specific: "Rep 1 fastest means the session failed, whatever the average says.",
    taper: "Do not chase a session you missed. Missed work in taper is free.",
  };

  let i = 0;
  while (i < weeks) {
    const phase = ph[i];
    let j = i;
    while (j + 1 < weeks && ph[j + 1] === phase) j++;
    const protect: string[] = [];
    const d = daysFor(x);
    if (d.quality != null) protect.push(`${DAY_NAME[d.quality]} · Quality run`);
    if (d.hyrox != null) protect.push(`${DAY_NAME[d.hyrox]} · Hyrox session`);

    out.push({
      from: i + 1, to: j + 1,
      phase: `${phase[0].toUpperCase()}${phase.slice(1)} · week${j > i ? `s ${i + 1}–${j + 1}` : ` ${i + 1}`}`,
      purpose: purpose[phase],
      protect: phase === "taper" && x.goal_date
        ? [x.goal_race_name ?? GOAL_LABEL[x.goal_kind]] : protect,
      sacrifice: phase === "specific" && heavy.length > 0
        ? `${heavy[0].name || heavy[0].kind} goes to alternate weeks. The leg-cost budget is spent on running.`
        : "Strength goes before running. Never the long run.",
      watch: watch[phase],
    });
    i = j + 1;
  }
  // running is `alloc.run` of the week by design — say so once, where it is set
  if (out[0]) {
    out[0].purpose += ` Roughly ${Math.round(alloc.run * 100)}% running, ` +
      `${Math.round(alloc.station * 100)}% stations, ${Math.round(alloc.strength * 100)}% strength.`;
  }
  return out;
}

/** Everything the plan cannot decide, named rather than hidden. */
export function flagsFor(x: Intake, weeks: number): string[] {
  const out: string[] = [];
  if (!x.recent_5k_seconds) {
    out.push("No pace anchor. The first weeks run on effort and heart rate alone; the baseline test sets real numbers.");
  }
  if (needsStandards(x)) {
    out.push("No division chosen, so sled and wall ball are prescribed as a share of race weight rather than in kilos. Pick your division and the sessions carry real loads.");
  }
  const locked = x.commitments.filter((c) => c.day != null).length;
  if (locked > 0) {
    const share = Math.round((locked / Math.max(1, x.days_per_week)) * 100);
    out.push(`${locked} locked commitment${locked > 1 ? "s" : ""} out of ${x.days_per_week} training days — ${share}% of the week is not specific to the goal.`);
  }
  if (x.partner_role === "protected") {
    out.push("Built around you as the protected partner: your partner takes the sled, the lunges and most of the burpees. Change the split and the plan changes with it.");
  }
  // only meaningful when they actually stated a number for it to be below
  if (x.current_km_week != null && startVolume(x) < 0.9 * x.current_km_week) {
    out.push("Week 1 is below what you said you run, because your stated running limits it. If the baseline says otherwise, the ceiling lifts and the early weeks are rewritten upward.");
  }
  if (weeks < 8) out.push("A short block. It sharpens what is there rather than building anything new.");
  return out;
}

export function generate(x: Intake, from: string = todayish()): GeneratedPlan {
  const start = mondayOf(addDays(from, 7));
  const raceDay = x.goal_date ? dow(x.goal_date) : null;
  const weeks = x.goal_date
    ? Math.max(2, Math.ceil((diffDays(x.goal_date, start) + 1) / 7))
    : DEFAULT_WEEKS;

  const table = volumeFor(x, weeks, raceDay);
  const shapes = table.map((w) => weekShape(x, w, weeks, raceDay));

  return {
    name: `${GOAL_LABEL[x.goal_kind]} · ${weeks} weeks`,
    start,
    weeks,
    race_date: x.goal_date,
    race_name: x.goal_race_name ?? (x.goal_date ? GOAL_LABEL[x.goal_kind] : null),
    goal_label: x.goal_time_seconds ? hms(x.goal_time_seconds) : null,
    goal_seconds: x.goal_time_seconds,
    volume: table.map((w) => ({ km: w.km, note: w.note })),
    intents: intentsFor(x, weeks),
    shapes,
    // the table is written out week by week, so the engine must not progress it too
    rules: { long_run_delta_min: 0, deload_every: 0, fatigue_skips_to_deload: 2, fatigue_cut: 0.85 },
    flags: flagsFor(x, weeks),
  };
}

const hms = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${m}:${String(s % 60).padStart(2, "0")}`;
};

export type { Commitment };
