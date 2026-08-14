import { sql } from "./db";
import { stravaGet } from "./strava";

/**
 * Per-km splits and the HR/pace time series for an activity.
 *
 * Two different costs, worth keeping straight:
 *
 *  - **Splits are free** when you already hold a *detailed* activity. Strava's
 *    `/athlete/activities` list returns summary objects with no `splits_metric`,
 *    but `/activities/{id}` includes it — and the webhook already fetches that,
 *    so a run arriving live needs no extra request to get its splits.
 *  - **Streams always cost one request** (`/activities/{id}/streams`).
 *
 * Strava's read limit is 100 requests / 15 min and 1000 / day, so everything
 * here is idempotent: it checks what is already stored and never re-fetches.
 */

/** What the graphs need. latlng and cadence are omitted on purpose — the route
 *  is already in `map.summary_polyline`, and latlng is ~40% of the payload. */
export const STREAM_KEYS = ["time", "heartrate", "velocity_smooth", "distance", "altitude"] as const;

type Split = {
  split: number;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  average_speed?: number;
  average_heartrate?: number;
  elevation_difference?: number;
  pace_zone?: number;
};

/** Persist `splits_metric` from an already-fetched detailed activity. No API call. */
export async function saveSplits(activityId: string, detail: unknown): Promise<number> {
  const splits = (detail as { splits_metric?: Split[] })?.splits_metric;
  if (!Array.isArray(splits) || splits.length === 0) return 0;

  for (const s of splits) {
    await sql`
      insert into activity_splits (
        activity_id, split, distance_m, moving_seconds, elapsed_seconds,
        avg_speed_ms, avg_hr, elevation_diff_m, pace_zone
      ) values (
        ${activityId}, ${s.split}, ${s.distance ?? null}, ${s.moving_time ?? null},
        ${s.elapsed_time ?? null}, ${s.average_speed ?? null},
        ${s.average_heartrate ?? null}, ${s.elevation_difference ?? null},
        ${s.pace_zone ?? null}
      )
      on conflict (activity_id, split) do update set
        distance_m       = excluded.distance_m,
        moving_seconds   = excluded.moving_seconds,
        elapsed_seconds  = excluded.elapsed_seconds,
        avg_speed_ms     = excluded.avg_speed_ms,
        avg_hr           = excluded.avg_hr,
        elevation_diff_m = excluded.elevation_diff_m,
        pace_zone        = excluded.pace_zone
    `;
  }
  return splits.length;
}

/** Fetch and store the streams for one activity. Costs one Strava request. */
export async function fetchStreams(
  userId: string,
  activityId: string,
  providerActivityId: string,
): Promise<number> {
  const qs = `keys=${STREAM_KEYS.join(",")}&key_by_type=true`;
  const streams = await stravaGet<Record<string, { data?: unknown[] }>>(
    userId,
    `/activities/${providerActivityId}/streams?${qs}`,
  );

  const keys = Object.keys(streams ?? {});
  if (keys.length === 0) return 0;
  // Every series is the same length; `time` is the one Strava always returns.
  const points = streams[keys[0]]?.data?.length ?? 0;

  await sql`
    insert into activity_streams (activity_id, keys, points, data, fetched_at)
    values (${activityId}, ${keys}, ${points}, ${sql.json(streams as never)}, now())
    on conflict (activity_id) do update set
      keys = excluded.keys, points = excluded.points,
      data = excluded.data, fetched_at = now()
  `;
  return points;
}

export type DetailGap = {
  id: string;
  user_id: string;
  provider_activity_id: string;
  needs_splits: boolean;
  needs_streams: boolean;
};

/**
 * Activities still missing splits or streams, newest first.
 *
 * `hasSplits` is judged on the split rows, not on the raw payload: a summary
 * fetched by the backfill has no `splits_metric` at all, so raw would say
 * "nothing to store" forever.
 *
 * Only distance sports get splits — Strava does not return `splits_metric` for
 * a gym session, so asking again every hour would burn the quota on nothing.
 */
export async function detailGaps(limit: number, since?: string): Promise<DetailGap[]> {
  return sql<DetailGap[]>`
    select a.id, a.user_id, a.provider_activity_id,
           (a.distance_m > 0 and not exists (
              select 1 from activity_splits s where s.activity_id = a.id)) as needs_splits,
           (not exists (
              select 1 from activity_streams st where st.activity_id = a.id)) as needs_streams
      from activities a
     where a.provider = 'strava'
       ${since ? sql`and a.start_time >= ${since}` : sql``}
       and (
         (a.distance_m > 0 and not exists (select 1 from activity_splits s where s.activity_id = a.id))
         or not exists (select 1 from activity_streams st where st.activity_id = a.id)
       )
     order by a.start_time desc
     limit ${limit}
  `;
}

/**
 * Fill both gaps for one activity. Returns how many Strava requests it used, so
 * a caller can stay inside the rate limit.
 *
 * A detailed fetch is only made when splits are actually missing — for a run
 * arriving through the webhook the caller already has the detailed payload and
 * should call saveSplits() directly instead.
 */
export async function fillDetail(gap: DetailGap): Promise<{ requests: number; splits: number; points: number }> {
  let requests = 0;
  let splits = 0;
  let points = 0;

  if (gap.needs_splits) {
    const detail = await stravaGet<unknown>(gap.user_id, `/activities/${gap.provider_activity_id}`);
    requests++;
    splits = await saveSplits(gap.id, detail);
  }
  if (gap.needs_streams) {
    points = await fetchStreams(gap.user_id, gap.id, gap.provider_activity_id);
    requests++;
  }
  return { requests, splits, points };
}
