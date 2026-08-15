import { addDays } from "./dates";

/**
 * The block: Hyrox doubles, Mon 17 Aug → Sat 28 Nov 2026, with Olivier.
 *
 * These constants are the training plan itself, not invented filler. They come
 * from the plan document the block was written from, so the week headline, the
 * volume targets and the "protect these" list on the Week screen say what the
 * plan says. When the plan changes, this file changes — it is the one place
 * that has to.
 */

/**
 * Everything block-specific has moved to the database.
 *
 * BLOCK_START, RACE_DATE, RACE_NAME, GOAL, the fifteen-row WEEKS table,
 * weekIntent() and weekOf() were declared here as module constants — one block,
 * shared by whoever was signed in. The second athlete was shown the first's race
 * and target as hers. They now live on the athlete's own plan row and are loaded
 * by lib/block.ts.
 *
 * What is left in this file is genuinely app-wide: zone arithmetic, which is
 * derived from the athlete's own measured maximum, and the colour and label
 * vocabulary for session kinds, which is the same for everyone.
 */

/**
 * Heart-rate zones.
 *
 * Set from a measured max of 189 bpm. Z2 topping out at 152 is the number the
 * plan turns on: easy runs currently sit at 146–158, and the instruction is to
 * push them 5–8 bpm down. The Week screen's "watch for" line and this table
 * have to agree, so both are defined here.
 */
export type Zone = { tag: string; label: string; min: number; max: number; colour: string };

export const DEFAULT_HR_MAX = 189;

/**
 * Zone ceilings as a fraction of maximum heart rate.
 *
 * Taken from the boundaries the plan states for a measured max of 189 — 140,
 * 152, 168, 181 — which are 74.1%, 80.4%, 88.9% and 95.8%. Expressing them as
 * percentages rather than as fixed numbers is what makes the table correct for a
 * second athlete: her max is not his, and applying his zones to her heart rate
 * would report her easy runs as threshold work.
 */
const ZONE_PCT = [0.741, 0.804, 0.889, 0.958];
const ZONE_COLOUR = ["#9CCFDE", "#0A8FB0", "#E8C051", "#C07A3E", "#12314D"];

/** The zone table for one athlete. */
export function zonesFor(hrMax: number | null | undefined): Zone[] {
  const max = hrMax && hrMax > 100 ? hrMax : DEFAULT_HR_MAX;
  const ceilings = ZONE_PCT.map((p) => Math.round(max * p));
  return ceilings.concat(9999).map((ceil, i) => {
    const min = i === 0 ? 0 : ceilings[i - 1] + 1;
    return {
      tag: `Z${i + 1}`,
      label: i === 0 ? `≤ ${ceil} bpm` : i === 4 ? `${min}+` : `${min}–${ceil}`,
      min, max: ceil, colour: ZONE_COLOUR[i],
    };
  });
}

/** The default table, for anywhere no athlete is in scope. */
export const ZONES: Zone[] = zonesFor(DEFAULT_HR_MAX);

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
  zones: Zone[] = ZONES,
): number[] {
  const out = zones.map(() => 0);
  if (!time?.length || !hr?.length) return out;
  for (let i = 0; i < hr.length; i++) {
    const v = hr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    // the gap this sample stands for; the last sample inherits the previous gap
    const dt = i + 1 < time.length ? time[i + 1] - time[i] : (time[i] - time[i - 1]) || 1;
    const z = zones.findIndex((zz) => v <= zz.max);
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
