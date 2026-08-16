import { sql } from "./db";
import { RUN_SPORT_SQL, isRunSport } from "./bounds";
import { stravaGet } from "./strava";
import type { RecentRunning } from "./plan/resolve";

/**
 * What an athlete has actually been running, from their own files.
 *
 * Measured rather than remembered, which is the whole point: people round their
 * training up when asked and down when tired, and the activity history has
 * neither habit. Where it exists it is the better answer, and where it does not
 * the intake's reported figures stand in.
 */

/**
 * How far back to look.
 *
 * Four weeks: recent enough to describe now rather than the spring, and short
 * enough that surveying a brand-new athlete's Strava is a single request for a
 * single page. Widening it does not cost more requests — the survey reads the
 * summary list only, never per-activity detail — but it does start describing
 * a training block the athlete has already left.
 */
export const PEAK_WEEKS = 4;
/**
 * The long run gets a wider window than the peak week.
 *
 * A biggest week describes current training and goes stale fast; a longest run
 * is a demonstration of what the legs have done, and four weeks is short enough
 * to miss one entirely. Different questions, different horizons.
 */
export const LONG_RUN_WEEKS = 8;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Two numbers over two windows.
 *
 * The biggest week of the last four is what week 1 is built from — the most the
 * athlete has recently shown they can absorb. The longest run of the last eight
 * is what caps the long run and its growth. Neither is an average: an average
 * describes a block that includes the weeks they were ill.
 */
export async function measuredRecent(
  userId: string, peakWeeks = PEAK_WEEKS, longWeeks = LONG_RUN_WEEKS,
): Promise<RecentRunning | null> {
  const rows = await sql<{ week: string; km: number; current: boolean }[]>`
    select date_trunc('week', start_time)::date::text as week,
           sum(distance_m) / 1000.0 as km,
           bool_or(date_trunc('week', start_time) = date_trunc('week', now())) as current
      from activities
     where user_id = ${userId}
       and sport_type ilike ${RUN_SPORT_SQL}
       and start_time >= now() - (${peakWeeks} * interval '1 week')
     group by 1 order by 1
  `;
  const [longest] = await sql<{ km: number }[]>`
    select max(distance_m) / 1000.0 as km from activities
     where user_id = ${userId}
       and sport_type ilike ${RUN_SPORT_SQL}
       and start_time >= now() - (${longWeeks} * interval '1 week')
  `;
  const long_run_km = longest?.km ? round1(Number(longest.km)) : null;
  if (rows.length === 0) return long_run_km ? { peak_week_km: null, long_run_km, source: "measured" } : null;

  /**
   * Drop the current week, which is partial by definition and would read as a
   * collapse — but only if it is actually there. Dropping the last row blindly
   * throws away a complete week whenever the athlete has not run yet this one,
   * which is precisely when it is most tempting to.
   */
  const complete = rows.filter((r) => !r.current);
  const full = complete.length > 0 ? complete : rows;
  const km = full.map((r) => Number(r.km));
  return { peak_week_km: round1(Math.max(...km)), long_run_km, source: "measured" };
}

/**
 * The measured figure where there is one, the reported figure otherwise.
 *
 * Never a blend. Averaging a record with a memory produces a number that is
 * neither, and nothing downstream could say which half it disbelieved.
 */
export function preferMeasured(
  measured: RecentRunning | null,
  reported: { peak_week_km: number | null; long_run_km: number | null },
): RecentRunning | null {
  if (measured?.peak_week_km || measured?.long_run_km) return measured;
  if (reported.peak_week_km || reported.long_run_km) {
    return { ...reported, source: "reported" };
  }
  return null;
}

// ------------------------------------------------ before anything is imported

/**
 * The same numbers for an athlete whose history is not in the app yet.
 *
 * Plan creation happens before the backfill — often within a minute of
 * connecting Strava — so waiting for the import would mean building the first
 * block from the matrix and quietly rebuilding it later. This reads the summary
 * list for the window and nothing else: one request, one page, no per-activity
 * detail, and nothing written. The real import still happens on its own
 * schedule and this survey is thrown away.
 */
export async function surveyStrava(
  userId: string, peakWeeks = PEAK_WEEKS, longWeeks = LONG_RUN_WEEKS,
): Promise<RecentRunning | null> {
  const after = Math.floor(Date.now() / 1000) - longWeeks * 7 * 86_400;
  const list = await stravaGet<
    { start_date_local: string; distance: number; sport_type?: string; type?: string }[]
  >(userId, `/athlete/activities?after=${after}&per_page=200`);

  const runs = (Array.isArray(list) ? list : [])
    .filter((a) => isRunSport(a.sport_type ?? a.type))
    .filter((a) => Number(a.distance) > 0);
  if (runs.length === 0) return null;

  // One request covers both windows: fetch the wider one and filter for the
  // narrower, rather than spending a second call to ask again.
  const peakCutoff = Date.now() - peakWeeks * 7 * 86_400_000;
  const byWeek = new Map<string, number>();
  let longest = 0;
  for (const a of runs) {
    const km = Number(a.distance) / 1000;
    const when = new Date(a.start_date_local);
    longest = Math.max(longest, km);
    if (when.getTime() < peakCutoff) continue;
    byWeek.set(weekKey(when), (byWeek.get(weekKey(when)) ?? 0) + km);
  }

  // The current week is partial, so it describes a week nobody has finished.
  byWeek.delete(weekKey(new Date()));
  const km = [...byWeek.values()];
  return {
    peak_week_km: km.length ? round1(Math.max(...km)) : null,
    long_run_km: longest ? round1(longest) : null,
    source: "measured",
  };
}

/** Monday-based, matching date_trunc('week', …) so both paths agree. */
export { weekKey as __weekKeyForTest };
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/**
 * Whatever we can find, cheapest first.
 *
 * An athlete who has been using the app already has the window in the database,
 * and asking Strava again for what we hold would be a request spent to learn
 * nothing. Only an empty window falls through to the survey, which is exactly
 * the case where they have just connected.
 */
export async function recentFor(
  userId: string, connected: boolean,
): Promise<{ recent: RecentRunning | null; from: "app" | "strava" | "none" }> {
  const local = await measuredRecent(userId);
  if (local?.peak_week_km) return { recent: local, from: "app" };
  if (!connected) return { recent: null, from: "none" };
  try {
    const survey = await surveyStrava(userId);
    return survey ? { recent: survey, from: "strava" } : { recent: null, from: "none" };
  } catch {
    // A revoked token or a rate limit is not a reason to fail the intake — the
    // athlete types the two numbers instead, and the plan is built either way.
    return { recent: null, from: "none" };
  }
}
