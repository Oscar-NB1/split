import { sql } from "./db";
import { RUN_SPORT_SQL } from "./bounds";
import type { RecentRunning } from "./plan/resolve";

/**
 * What an athlete has actually been running, from their own files.
 *
 * Measured rather than remembered, which is the whole point: people round their
 * training up when asked and down when tired, and the activity history has
 * neither habit. Where it exists it is the better answer, and where it does not
 * the intake's reported figures stand in.
 */

/** How far back to look. Long enough to survive one quiet week, short enough
 *  to still describe now rather than the spring. */
export const RECENT_WEEKS = 8;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Two numbers, because they answer two different questions.
 *
 * The typical week is what the block starts from, and it is the mean of the
 * complete weeks rather than the median: an athlete whose weeks alternate
 * between 20 and 38 km has a median that lands in the trough and describes
 * neither half of what they do. The mean sits where a coach would put it.
 *
 * The biggest week is what the peak is allowed to build on, because "proven"
 * means the most they have actually completed — not the most they average.
 */
export async function measuredRecent(
  userId: string, weeks = RECENT_WEEKS,
): Promise<RecentRunning | null> {
  const rows = await sql<{ week: string; km: number; current: boolean }[]>`
    select date_trunc('week', start_time)::date::text as week,
           sum(distance_m) / 1000.0 as km,
           bool_or(date_trunc('week', start_time) = date_trunc('week', now())) as current
      from activities
     where user_id = ${userId}
       and sport_type ilike ${RUN_SPORT_SQL}
       and start_time >= now() - (${weeks} * interval '1 week')
     group by 1 order by 1
  `;
  const [longest] = await sql<{ km: number }[]>`
    select max(distance_m) / 1000.0 as km from activities
     where user_id = ${userId}
       and sport_type ilike ${RUN_SPORT_SQL}
       and start_time >= now() - (${weeks} * interval '1 week')
  `;
  if (rows.length === 0) return null;

  /**
   * Drop the current week, which is partial by definition and would read as a
   * collapse — but only if it is actually there. Dropping the last row blindly
   * throws away a complete week whenever the athlete has not run yet this one,
   * which is precisely when it is most tempting to.
   */
  const complete = rows.filter((r) => !r.current);
  const full = complete.length > 0 ? complete : rows;
  const km = full.map((r) => Number(r.km));
  const typical = km.reduce((a, b) => a + b, 0) / km.length;

  return {
    weekly_km: round1(typical),
    peak_week_km: round1(Math.max(...km)),
    long_run_km: longest?.km ? round1(Number(longest.km)) : null,
    source: "measured",
  };
}

/**
 * The measured figure where there is one, the reported figure otherwise.
 *
 * Never a blend. Averaging a record with a memory produces a number that is
 * neither, and nothing downstream could say which half it disbelieved.
 */
export function preferMeasured(
  measured: RecentRunning | null,
  reported: { weekly_km: number | null; long_run_km: number | null },
): RecentRunning | null {
  if (measured?.weekly_km) return measured;
  if (reported.weekly_km || reported.long_run_km) {
    return { ...reported, source: "reported" };
  }
  return null;
}
