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
 * The arithmetic and the table rules moved to lib/zones.ts when zones became
 * editable — a nudged ceiling has to stay between its neighbours, and a table
 * with a gap in it is worse than no table at all. Re-exported here so the
 * screens that already import from this file keep working.
 */
export type { Zone } from "./zones";
export { DEFAULT_HR_MAX, ZONE_PCT, fromMax as zonesFor } from "./zones";
import { type Zone, fromMax } from "./zones";
import { DEFAULT_HR_MAX as MAX } from "./zones";

/** The default table, for anywhere no athlete is in scope. */
export const ZONES = fromMax(MAX);

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
export /**
 * A colour per kind of session, chosen so a week reads at a glance.
 *
 * Every kind is distinct, and the distinctions carry meaning rather than being
 * decoration: the hard running is the only red on the screen, Hyrox work is the
 * navy the brand is built from, strength is a lighter blue beside it, and anything
 * that is not the plan's own — a class, a match, a commitment the athlete keeps —
 * is near-black so it reads as somebody else's session.
 *
 * Strava sport types map onto the same palette, so a logged activity and the
 * session it satisfies are the same colour.
 */
const KIND_COLOUR: Record<string, string> = {
  // running
  quality_run: "#C4432F", run_intervals: "#C4432F",   // the hard running: red
  long_run: "#0A8FB0", run_long: "#0A8FB0",           // the long run: teal
  easy_run: "#8FD0E0", run_easy: "#8FD0E0",           // easy running: pale teal
  Run: "#8FD0E0", TrailRun: "#8FD0E0",
  // the rest of the plan
  hyrox: "#12314D",                                    // Hyrox work: navy
  strength: "#6FA8DC", WeightTraining: "#6FA8DC",      // strength: light blue
  benchmark: "#E8C051",                                // the test: gold
  race: "#C6FF5B",                                     // race day: lime
  rest: "#C9D3DB",
  /*
   * Not the plan's: classes, matches, anything the athlete already keeps.
   *
   * A warm grey rather than the near-black it was, which sat close enough to the
   * Hyrox navy that a kickboxing class and a Hyrox session read as the same thing
   * in a list of dots.
   */
  commitment: "#8A94A0",
  Workout: "#8A94A0", HighIntensityIntervalTraining: "#8A94A0", Crossfit: "#8A94A0",
  Kickboxing: "#8A94A0", Ride: "#8A94A0", Swim: "#8A94A0", Walk: "#8A94A0",
  Yoga: "#8A94A0", Hike: "#8A94A0",
};

/**
 * A kind's colour, and near-black for anything unrecognised.
 *
 * An unknown kind is almost always a commitment the athlete named themselves —
 * "jiu-jitsu", "netball" — so the default is the colour those already use rather
 * than a fifth blue nobody can tell apart from the others.
 */
export const kindColour = (k: string | null | undefined) =>
  (k && KIND_COLOUR[k]) || "#8A94A0";

/** Human labels for the plan kinds and the Strava sport types we see. */
export const KIND_LABEL: Record<string, string> = {
  run_easy: "Run · easy", run_intervals: "Run · intervals", run_long: "Run · long",
  hyrox: "Hyrox", strength: "Strength", rest: "Rest",
  /*
   * The kinds the current generator writes.
   *
   * Without them the chip above a session read "QUALITY_RUN" — the internal name,
   * upper-cased by the style, shown to the athlete.
   */
  quality_run: "Run · intervals", easy_run: "Run · easy", long_run: "Run · long",
  benchmark: "Benchmark", race: "Race", commitment: "Yours",
};
export const kindLabel = (k: string) =>
  KIND_LABEL[k] ?? k.replace(/([a-z])([A-Z])/g, "$1 $2");

/*
 * The hardcoded example week that used to live here is gone.
 *
 * It was the fallback for any week whose sessions were not loaded, so the plan
 * screen showed "Strength A", "Key session", "Hyrox intervals" — names no
 * generator has ever produced — for fourteen weeks out of fifteen. The plan
 * carries its own shape for every week now, and the screens read that.
 */

export const weekDates = (monday: string) =>
  Array.from({ length: 7 }, (_, i) => addDays(monday, i));
