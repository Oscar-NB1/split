import { addDays, diffDays, mondayOf } from "./dates";

/**
 * The block: Hyrox doubles, Mon 17 Aug → Sat 28 Nov 2026, with Olivier.
 *
 * These constants are the training plan itself, not invented filler. They come
 * from the plan document the block was written from, so the week headline, the
 * volume targets and the "protect these" list on the Week screen say what the
 * plan says. When the plan changes, this file changes — it is the one place
 * that has to.
 */

export const BLOCK_START = "2026-08-17";
export const RACE_DATE = "2026-11-28";
export const RACE_NAME = "Hyrox Doubles · Rotterdam";
export const GOAL = "55:00–56:30";

export type PlanWeek = { n: number; start: string; km: number; note: string };

/** Volume table from the plan. Peak 50 km is the proven Feb/Mar ceiling. */
export const WEEKS: PlanWeek[] = [
  { n: 1, start: "2026-08-17", km: 34, note: "" },
  { n: 2, start: "2026-08-24", km: 38, note: "" },
  { n: 3, start: "2026-08-31", km: 42, note: "" },
  { n: 4, start: "2026-09-07", km: 30, note: "Down week + benchmark: 5 × 1000 m, 90 s walk" },
  { n: 5, start: "2026-09-14", km: 42, note: "" },
  { n: 6, start: "2026-09-21", km: 46, note: "" },
  { n: 7, start: "2026-09-28", km: 50, note: "Peak volume — the proven Feb/Mar ceiling, not above it" },
  { n: 8, start: "2026-10-05", km: 34, note: "Down week + 5K TT, negative split" },
  { n: 9, start: "2026-10-12", km: 46, note: "Race session starts: 8 × 1000 m @ 4:15, 75 s standing" },
  { n: 10, start: "2026-10-19", km: 50, note: "Full simulation with Olivier" },
  { n: 11, start: "2026-10-26", km: 38, note: "B-race Wednesday 28th" },
  { n: 12, start: "2026-11-02", km: 46, note: "" },
  { n: 13, start: "2026-11-09", km: 42, note: "Dress rehearsal · 6 × 1000 @ 4:05" },
  { n: 14, start: "2026-11-16", km: 32, note: "Taper" },
  { n: 15, start: "2026-11-23", km: 18, note: "RACE — Sat 28 Nov, target 55:00–56:30" },
];

export type Intent = {
  phase: string;
  purpose: string;
  protect: string[];
  sacrifice: string;
  watch: string;
};

/**
 * What a week is *for*, and what has to survive a bad one.
 *
 * The plan's whole argument is that the last block failed for two separate
 * reasons — volume collapsed, and quality sessions were run too fast — so every
 * phase names both the thing to protect and the failure mode to watch for.
 */
export function weekIntent(n: number): Intent {
  if (n <= 3) return {
    phase: "Rebuild · weeks 1–3",
    purpose:
      "Get running volume back to a level your body already knows. Nothing here is meant to hurt — the block is bought with consistency in August, not intensity.",
    protect: ["Tue · Runna key session", "Sat · Hyrox continuous"],
    sacrifice: "Friday strength goes first, then Thursday kickboxing. Never the long run.",
    watch: "Easy runs above 152 bpm are the failure mode. They cost Tuesday and Saturday.",
  };
  if (n === 4 || n === 8) return {
    phase: n === 4 ? "Down week + benchmark" : "Down week + time trial",
    purpose:
      "Volume drops by a third so the benchmark is run on fresh legs. The test is the point of the week; everything else is filler around it.",
    protect: [n === 4 ? "Benchmark · 5 × 1000 m" : "Benchmark · 5K time trial"],
    sacrifice: "Drop a strength session and the second kickboxing without hesitation.",
    watch: "Do not train through the benchmark. A tired test tells you nothing.",
  };
  if (n <= 7) return {
    phase: "Build · weeks 5–7",
    purpose:
      "Volume climbs to the 50 km ceiling you proved in February. Pace targets stay honest; the adaptation you want is holding the same pace at a lower heart rate.",
    protect: ["Tue · Runna key session", "Sat · Hyrox continuous", "Sun · Long run"],
    sacrifice: "Wednesday intervals can become an easy run. Strength drops to once.",
    watch: "Two hard days a week. Kickboxing rounds are not a third.",
  };
  if (n <= 10) return {
    phase: "Race specific · weeks 9–10",
    purpose:
      "The key session becomes the race: 8 × 1000 m at race pace off short standing rest. Station work moves from fitness to rehearsal — transitions, splits, roxzone.",
    protect: ["Tue · Race session 8 × 1000 m", "Sat · Full simulation"],
    sacrifice: "Everything else. These two sessions are the block.",
    watch: "Rep 1 fastest means the session failed, whatever the average says.",
  };
  if (n <= 13) return {
    phase: "Sharpen · weeks 11–13",
    purpose:
      "Race pace at lower cost, plus the B-race as a live rehearsal of pacing and transitions. Volume holds; intensity gets more specific.",
    protect: ["Tue · Race session", "Sat · Dress rehearsal"],
    sacrifice: "Second kickboxing session. Strength stays once, light.",
    watch: "Roxzone discipline. Every 5 s per transition is 40 s on the clock.",
  };
  return {
    phase: n === 14 ? "Taper · week 14" : "Race week",
    purpose: n === 14
      ? "Volume drops a third, intensity stays. The work is done; this week only protects it."
      : "Two short sharpeners and rest. Nothing you do now makes you fitter.",
    protect: n === 14 ? ["Tue · Short race-pace touch"] : ["Sat 28 Nov · Race"],
    sacrifice: "Any session you feel unsure about. When in doubt, rest.",
    watch: "Do not chase a session you missed. Missed work in taper is free.",
  };
}

/** Which plan week a date falls in, or null outside the block. */
export function weekOf(date: string): PlanWeek | null {
  const monday = mondayOf(date);
  return WEEKS.find((w) => w.start === monday) ?? null;
}

export const daysToRace = (from: string) => diffDays(from, RACE_DATE);

/**
 * Heart-rate zones.
 *
 * Set from a measured max of 189 bpm. Z2 topping out at 152 is the number the
 * plan turns on: easy runs currently sit at 146–158, and the instruction is to
 * push them 5–8 bpm down. The Week screen's "watch for" line and this table
 * have to agree, so both are defined here.
 */
export type Zone = { tag: string; label: string; min: number; max: number; colour: string };

export const ZONES: Zone[] = [
  { tag: "Z1", label: "≤ 140 bpm", min: 0, max: 140, colour: "#9CCFDE" },
  { tag: "Z2", label: "141–152", min: 141, max: 152, colour: "#0A8FB0" },
  { tag: "Z3", label: "153–168", min: 153, max: 168, colour: "#E8C051" },
  { tag: "Z4", label: "169–181", min: 169, max: 181, colour: "#C07A3E" },
  { tag: "Z5", label: "182+", min: 182, max: 9999, colour: "#12314D" },
];

/**
 * Seconds spent in each zone, from the heart-rate stream.
 *
 * Counted off the raw samples with their own timestamps rather than assuming
 * 1 Hz: a Garmin drops to smart recording on long activities, and multiplying
 * a sample count by one second would then under-report a two-hour run by half.
 */
export function zoneSeconds(
  time: number[] | undefined,
  hr: (number | null)[] | undefined,
): number[] {
  const out = ZONES.map(() => 0);
  if (!time?.length || !hr?.length) return out;
  for (let i = 0; i < hr.length; i++) {
    const v = hr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    // the gap this sample stands for; the last sample inherits the previous gap
    const dt = i + 1 < time.length ? time[i + 1] - time[i] : (time[i] - time[i - 1]) || 1;
    const z = ZONES.findIndex((zz) => v <= zz.max);
    if (z >= 0) out[z] += Math.max(0, dt);
  }
  return out;
}

/** Colour per session kind, matching the design's accent map. */
export const KIND_COLOUR: Record<string, string> = {
  run_easy: "#0A8FB0", run_intervals: "#13A6CC", run_long: "#0A8FB0",
  Run: "#0A8FB0", TrailRun: "#0A8FB0",
  hyrox: "#AAEA42", Workout: "#AAEA42", HighIntensityIntervalTraining: "#AAEA42", Crossfit: "#AAEA42",
  strength: "#13A6CC", WeightTraining: "#13A6CC",
  Kickboxing: "#1B3E5C", Ride: "#1B3E5C", Swim: "#1B3E5C", Walk: "#1B3E5C",
  Yoga: "#1B3E5C", Hike: "#1B3E5C", rest: "#12314D",
};
export const kindColour = (k: string | null | undefined) =>
  (k && KIND_COLOUR[k]) || "#1B3E5C";

/** Human labels for the plan kinds and the Strava sport types we see. */
export const KIND_LABEL: Record<string, string> = {
  run_easy: "Run · easy", run_intervals: "Run · intervals", run_long: "Run · long",
  hyrox: "Hyrox", strength: "Strength", rest: "Rest",
};
export const kindLabel = (k: string) =>
  KIND_LABEL[k] ?? k.replace(/([a-z])([A-Z])/g, "$1 $2");

/** The fixed weekly shape from the plan, used where no session exists yet. */
export const TEMPLATE_WEEK: { dow: number; kind: string; label: string; slot: "AM" | "PM" }[] = [
  { dow: 0, kind: "strength", label: "Strength A", slot: "AM" },
  { dow: 0, kind: "hyrox", label: "Kickboxing", slot: "PM" },
  { dow: 1, kind: "run_intervals", label: "Runna key session", slot: "AM" },
  { dow: 2, kind: "hyrox", label: "Hyrox intervals", slot: "AM" },
  { dow: 3, kind: "run_easy", label: "Easy run", slot: "AM" },
  { dow: 3, kind: "hyrox", label: "Kickboxing", slot: "PM" },
  { dow: 4, kind: "strength", label: "Strength B", slot: "AM" },
  { dow: 5, kind: "hyrox", label: "Hyrox continuous", slot: "AM" },
  { dow: 6, kind: "run_long", label: "Long run", slot: "AM" },
];

export const weekDates = (monday: string) =>
  Array.from({ length: 7 }, (_, i) => addDays(monday, i));
