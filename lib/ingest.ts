import { sql } from "./db";

export type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  type: string;
  start_date: string;       // UTC
  start_date_local: string; // athlete's local wall clock
  moving_time: number;
  elapsed_time: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
};

/**
 * Map a Strava sport_type onto our planned-session kinds.
 *
 * Only used for effort points, so the mapping has to reflect what these two
 * actually record. Garmin's activity types arrive here renamed by Strava:
 *
 *   Garmin Strength  -> WeightTraining               -> strength
 *   Garmin HIIT      -> HighIntensityIntervalTraining \
 *   Garmin Cardio    -> Workout                       > hyrox (station work)
 *   Garmin Crossfit  -> Crossfit                     /
 *
 * The old version sent Workout to `strength` and everything unrecognised to
 * `hyrox`, which is backwards on both counts: a Hyrox session scored 0.75 -
 * less than an easy run - while a yoga class scored 1.7.
 */
export function kindFor(a: StravaActivity): string {
  const s = (a.sport_type || a.type || "").toLowerCase();
  if (s.includes("run")) {
    const km = a.distance / 1000;
    if (km >= 15) return "run_long";
    return "run_easy"; // intervals are detected by matching, not by distance
  }
  if (s.includes("weight")) return "strength";
  if (/crossfit|highintensity|hiit|workout|functional/.test(s)) return "hyrox";
  return "strength"; // unknown: score it conservatively, don't inflate it
}

/**
 * Effort points. Weighted by session type so that station work is not
 * undervalued against running, which raw duration would do.
 */
export function effortPoints(a: StravaActivity): number {
  const minutes = a.moving_time / 60;
  const weight: Record<string, number> = {
    run_long: 0.95,
    run_easy: 0.8,
    run_intervals: 1.6,
    hyrox: 1.7,
    strength: 0.75,
  };
  const w = weight[kindFor(a)] ?? 1;
  const hrBump = a.average_heartrate ? Math.max(0.8, a.average_heartrate / 150) : 1;
  return Math.round(minutes * w * hrBump);
}

/** Upsert one Strava activity. Returns the internal activity id. */
export async function upsertActivity(userId: string, a: StravaActivity) {
  const localDate = a.start_date_local.slice(0, 10);
  const rows = await sql<{ id: string }[]>`
    insert into activities (
      user_id, provider, provider_activity_id, start_time, local_date,
      sport_type, name, moving_seconds, elapsed_seconds, distance_m,
      elevation_m, avg_hr, max_hr, avg_speed_ms, raw
    ) values (
      ${userId}, 'strava', ${String(a.id)}, ${a.start_date}, ${localDate},
      ${a.sport_type ?? a.type}, ${a.name}, ${a.moving_time}, ${a.elapsed_time},
      ${a.distance}, ${a.total_elevation_gain}, ${a.average_heartrate ?? null},
      ${a.max_heartrate ?? null}, ${a.average_speed ?? null}, ${sql.json(a as never)}
    )
    on conflict (provider, provider_activity_id) do update set
      name           = excluded.name,
      moving_seconds = excluded.moving_seconds,
      distance_m     = excluded.distance_m,
      avg_hr         = excluded.avg_hr,
      raw            = excluded.raw
    returning id
  `;
  const activityId = rows[0].id;
  await matchToPlan(userId, activityId, localDate, a);
  return activityId;
}

/**
 * Anything completed under this share of the planned minutes is `adjusted`
 * rather than `done`. The streak survives; the record still tells the truth.
 */
export const ADJUSTED_THRESHOLD = 0.7;

export function statusFor(actualMinutes: number, plannedMinutes: number | null) {
  const planned = plannedMinutes ?? actualMinutes;
  return actualMinutes < planned * ADJUSTED_THRESHOLD ? "adjusted" : "done";
}

/**
 * Of the day's open sessions, the one closest in duration.
 *
 * Sessions with no planned duration rank last rather than scoring a perfect
 * zero: an untimed "Hyrox stations" used to beat the 40-minute easy run for a
 * 41-minute activity, because null was read as "exactly right".
 */
export function pickClosest<T extends { planned_minutes: number | null }>(
  candidates: T[],
  actualMinutes: number,
): T | undefined {
  const distance = (c: T) =>
    c.planned_minutes == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(c.planned_minutes - actualMinutes);
  return [...candidates].sort((x, y) => distance(x) - distance(y))[0];
}

/**
 * Pair an activity with the session that was planned for that day.
 * Deliberately dumb: same athlete, same local date, still open, closest
 * duration wins. A human can re-pair it in the UI; guessing harder than
 * this produces confident wrong answers.
 */
export async function matchToPlan(
  userId: string,
  activityId: string,
  localDate: string,
  a: StravaActivity,
) {
  const candidates = await sql<{ id: string; planned_minutes: number | null }[]>`
    select id, planned_minutes
    from planned_sessions
    where user_id = ${userId}
      and planned_date = ${localDate}
      and status in ('planned')
      and kind <> 'rest'
      and activity_id is null
  `;
  if (candidates.length === 0) return;

  const actual = Math.round(a.moving_time / 60);
  const best = pickClosest(candidates, actual)!;
  const status = statusFor(actual, best.planned_minutes);

  await sql`
    update planned_sessions set
      status         = ${status},
      activity_id    = ${activityId},
      actual_minutes = ${actual},
      effort_points  = ${effortPoints(a)},
      updated_at     = now()
    where id = ${best.id}
  `;
  await sql`
    insert into session_changes (session_id, actor_id, action, reason)
    values (${best.id}, ${userId}, 'completed', ${status === "adjusted" ? "short of plan" : null})
  `;
}

/**
 * Undo a pairing when the activity goes away (deleted in Strava or Garmin).
 *
 * The foreign key is `on delete set null`, so deleting the activity row on its
 * own left the session marked `done` with no activity behind it, a stale
 * actual_minutes and effort points for a run that no longer exists. Put the
 * session back to `planned` and let it be re-paired.
 */
export async function unpairActivity(provider: string, providerActivityId: string) {
  const rows = await sql<{ id: string }[]>`
    update planned_sessions s set
      status         = 'planned',
      activity_id    = null,
      actual_minutes = null,
      effort_points  = null,
      updated_at     = now()
    from activities a
    where a.id = s.activity_id
      and a.provider = ${provider}
      and a.provider_activity_id = ${providerActivityId}
    returning s.id
  `;
  return rows.length;
}
