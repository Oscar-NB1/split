import { sql } from "./db";
import { MAX_SESSION_SECONDS } from "./bounds";
import { addDays, diffWeeks, iso, mondayOf } from "./dates";

/**
 * Monday of the week containing d, as YYYY-MM-DD.
 *
 * Goes through lib/dates now. The old version kept the time of day and then
 * called toISOString(), so between midnight and 02:00 Berlin time it returned
 * Sunday - the app quietly ran Sunday-to-Saturday weeks overnight, and a
 * session finished late on Sunday scored in the wrong week's challenge.
 */
export function weekStart(d = new Date()) {
  return mondayOf(iso(d));
}

export const METRICS = {
  sessions_done: "Sessions completed",
  effort_points: "Effort points",
  zone2_minutes: "Zone 2 minutes",
  longest_session: "Longest single session",
} as const;
export type Metric = keyof typeof METRICS;

/**
 * Rotates the challenge so the metric suits a different athlete each week.
 *
 * Counted in whole weeks from a fixed Monday. The anchor is chosen to land on
 * the same phase the first implementation produced, so nobody's live week
 * changes metric underneath them on deploy.
 */
const ROTATION_ANCHOR = "2023-12-25";

export function metricForWeek(ws: string): Metric {
  const order: Metric[] = ["sessions_done", "zone2_minutes", "effort_points", "longest_session"];
  const weeks = diffWeeks(mondayOf(ws), ROTATION_ANCHOR);
  return order[((weeks % order.length) + order.length) % order.length];
}

export async function challengeScores(ws: string, metric: Metric) {
  const end = addDays(ws, 7);

  if (metric === "sessions_done") {
    return sql<{ user_id: string; score: number }[]>`
      select user_id, count(*)::int as score from planned_sessions
      where status in ('done','adjusted') and planned_date >= ${ws} and planned_date < ${end}
      group by user_id`;
  }
  if (metric === "effort_points") {
    return sql<{ user_id: string; score: number }[]>`
      select user_id, coalesce(sum(effort_points),0)::int as score from planned_sessions
      where planned_date >= ${ws} and planned_date < ${end} group by user_id`;
  }
  if (metric === "longest_session") {
    return sql<{ user_id: string; score: number }[]>`
      select user_id, coalesce(max(least(moving_seconds, ${MAX_SESSION_SECONDS}))/60,0)::int as score
      from activities
      where local_date >= ${ws} and local_date < ${end} group by user_id`;
  }
  // zone2: time under 160 bpm, approximated from average HR per activity.
  // Clamped, or a watch left running for nineteen hours wins the week: that
  // single activity contributed 1,146 minutes to a Zone-2 score.
  return sql<{ user_id: string; score: number }[]>`
    select user_id, coalesce(sum(least(moving_seconds, ${MAX_SESSION_SECONDS}))/60,0)::int as score
    from activities
    where local_date >= ${ws} and local_date < ${end}
      and avg_hr is not null and avg_hr < 160
    group by user_id`;
}

/**
 * Adherence streak: consecutive non-rest sessions completed or adjusted.
 * A scaled-down session keeps the streak. A skip breaks it - the honesty
 * matters more than the number.
 */
export async function streakFor(userId: string) {
  const rows = await sql<{ status: string }[]>`
    select status from planned_sessions
    where user_id = ${userId} and kind <> 'rest' and planned_date <= current_date
      and status <> 'moved'
    order by planned_date desc, created_at desc limit 60
  `;
  let n = 0;
  for (const r of rows) {
    if (r.status === "done" || r.status === "adjusted") n++;
    else if (r.status === "skipped") break;
    else continue; // still 'planned' and in the past: not yet judged
  }
  return n;
}
