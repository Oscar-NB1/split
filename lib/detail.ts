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

type Lap = {
  lap_index: number;
  name?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  start_index?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  total_elevation_gain?: number;
};

/**
 * Persist `laps` from an already-fetched detailed activity. No API call.
 *
 * Laps are where the interval structure lives. A Garmin session of 6×800m
 * arrives as 13 laps — six work, six recoveries, one warmup — each with its own
 * average HR. `splits_metric` is always whole kilometres, so it averages a rep
 * and its recovery together and the interval disappears.
 */
export async function saveLaps(activityId: string, detail: unknown): Promise<number> {
  const laps = (detail as { laps?: Lap[] })?.laps;
  if (!Array.isArray(laps) || laps.length === 0) return 0;

  // Strava numbers laps from 1 but the field is occasionally absent on old
  // activities; fall back to array order rather than dropping the lap.
  let i = 0;
  for (const l of laps) {
    i++;
    await sql`
      insert into activity_laps (
        activity_id, lap_index, name, distance_m, moving_seconds, elapsed_seconds,
        start_index, avg_speed_ms, max_speed_ms, avg_hr, max_hr, avg_cadence,
        elevation_diff_m
      ) values (
        ${activityId}, ${l.lap_index ?? i}, ${l.name ?? null}, ${l.distance ?? null},
        ${l.moving_time ?? null}, ${l.elapsed_time ?? null}, ${l.start_index ?? null},
        ${l.average_speed ?? null}, ${l.max_speed ?? null},
        ${l.average_heartrate ?? null}, ${l.max_heartrate ?? null},
        ${l.average_cadence ?? null}, ${l.total_elevation_gain ?? null}
      )
      on conflict (activity_id, lap_index) do update set
        name             = excluded.name,
        distance_m       = excluded.distance_m,
        moving_seconds   = excluded.moving_seconds,
        elapsed_seconds  = excluded.elapsed_seconds,
        start_index      = excluded.start_index,
        avg_speed_ms     = excluded.avg_speed_ms,
        max_speed_ms     = excluded.max_speed_ms,
        avg_hr           = excluded.avg_hr,
        max_hr           = excluded.max_hr,
        avg_cadence      = excluded.avg_cadence,
        elevation_diff_m = excluded.elevation_diff_m
    `;
  }
  return laps.length;
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
  if (keys.length === 0) {
    // A row is still written, with zero points. Returning without one means the
    // gap query sees "no streams" and asks again every hour for an activity
    // Strava has no series for at all — a treadmill entry typed in by hand.
    await sql`
      insert into activity_streams (activity_id, keys, points, data, fetched_at)
      values (${activityId}, ${[] as string[]}, 0, ${sql.json({})}, now())
      on conflict (activity_id) do update set fetched_at = now()
    `;
    return 0;
  }
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
  needs_detail: boolean;
  needs_streams: boolean;
};

/**
 * Activities still missing their detailed payload or their streams, newest first.
 *
 * Both gaps are judged on a "we asked" marker rather than on whether rows came
 * back — `detail_fetched_at` for splits and laps, a streams row (possibly with
 * zero points) for the series. Judging on the rows themselves means anything
 * that legitimately has none is re-fetched on every sweep, forever: a gym
 * session has no `splits_metric`, and a manually-entered run has no streams.
 *
 * The old version keyed on `distance_m > 0 and no split rows`, which also meant
 * laps were never collected for non-distance sports — exactly the Hyrox station
 * work where the interval structure matters most.
 */
export async function detailGaps(limit: number, since?: string): Promise<DetailGap[]> {
  return sql<DetailGap[]>`
    select a.id, a.user_id, a.provider_activity_id,
           (a.detail_fetched_at is null) as needs_detail,
           (not exists (
              select 1 from activity_streams st where st.activity_id = a.id)) as needs_streams
      from activities a
     where a.provider = 'strava'
       ${since ? sql`and a.start_time >= ${since}` : sql``}
       and (
         a.detail_fetched_at is null
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
export async function fillDetail(
  gap: DetailGap,
): Promise<{ requests: number; splits: number; laps: number; points: number }> {
  let requests = 0;
  let splits = 0;
  let laps = 0;
  let points = 0;

  if (gap.needs_detail) {
    const detail = await stravaGet<unknown>(gap.user_id, `/activities/${gap.provider_activity_id}`);
    requests++;
    // One request pays for both — splits and laps are two fields of the same
    // payload, so there is never a reason to fetch it twice.
    splits = await saveSplits(gap.id, detail);
    laps = await saveLaps(gap.id, detail);
    await sql`update activities set detail_fetched_at = now() where id = ${gap.id}`;
  }
  if (gap.needs_streams) {
    points = await fetchStreams(gap.user_id, gap.id, gap.provider_activity_id);
    requests++;
  }
  return { requests, splits, laps, points };
}
