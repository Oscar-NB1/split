import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { notFound, route } from "@/lib/http";
import { isUuid } from "@/lib/plan";
import {
  classifySegments, decodePolyline, downsample, statsFor,
  type LapRow, type StreamData,
} from "@/lib/analysis";
import { hasBasemap } from "@/lib/map";
import { stationOfSplit } from "@/lib/stations";
import { zoneSeconds, zonesFor } from "@/lib/coach";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Everything the detail view needs for one activity, in a single round trip —
 * the same principle as /api/week.
 *
 * Reads are household-scoped, not user-scoped: this is a two-person coaching
 * tool and each athlete is meant to see the other's sessions (BRIEF.md, "no
 * privacy walls"). The session cookie still has to be valid.
 *
 * The streams are downsampled here rather than in the browser. Sending 3,600
 * raw samples per series to draw a 700px-wide line is ~250kB of payload for
 * about 500 usable pixels.
 */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) throw notFound("No such activity.");

  const [activity] = await sql<{
    id: string; user_id: string; provider_activity_id: string; sport_type: string | null;
    name: string | null; start_time: string; local_date: string;
    moving_seconds: number | null; elapsed_seconds: number | null;
    distance_m: string | null; elevation_m: string | null;
    avg_hr: string | null; max_hr: string | null; avg_speed_ms: string | null;
    polyline: string | null; detail_fetched_at: string | null;
    display_name: string; session_id: string | null; session_title: string | null;
    planned_minutes: number | null; session_status: string | null; effort_points: number | null;
    hr_max: number | null;
  }[]>`
    select a.id, a.user_id, a.provider_activity_id, a.sport_type, a.name,
           a.start_time, a.local_date::text as local_date,
           a.moving_seconds, a.elapsed_seconds, a.distance_m, a.elevation_m,
           a.avg_hr, a.max_hr, a.avg_speed_ms, a.detail_fetched_at,
           a.raw #>> '{map,summary_polyline}' as polyline,
           u.display_name,
           p.id as session_id, p.title as session_title, p.planned_minutes,
           p.status as session_status, p.effort_points, u.hr_max
      from activities a
      join users u on u.id = a.user_id
      left join planned_sessions p on p.activity_id = a.id and p.status <> 'moved'
     where a.id = ${id}
     limit 1
  `;
  if (!activity) throw notFound("No such activity.");

  const [laps, splits, streamRow] = await Promise.all([
    sql<LapRow[]>`
      select lap_index, name, distance_m, moving_seconds, elapsed_seconds,
             avg_speed_ms, max_speed_ms, avg_hr, max_hr
        from activity_laps where activity_id = ${id} order by lap_index
    `,
    sql`
      select split, distance_m, moving_seconds, elapsed_seconds, avg_speed_ms,
             avg_hr, elevation_diff_m
        from activity_splits where activity_id = ${id} order by split
    `,
    sql<{ data: StreamData; points: number; keys: string[] }[]>`
      select data, points, keys from activity_streams where activity_id = ${id}
    `,
  ]);

  // numeric columns arrive as strings from postgres; the charts need numbers
  const n = (v: unknown) => (v == null ? null : Number(v));
  const { segments, isIntervals } = classifySegments(
    laps.map((l) => ({
      ...l,
      distance_m: n(l.distance_m), moving_seconds: n(l.moving_seconds),
      elapsed_seconds: n(l.elapsed_seconds), avg_speed_ms: n(l.avg_speed_ms),
      max_speed_ms: n(l.max_speed_ms), avg_hr: n(l.avg_hr), max_hr: n(l.max_hr),
    })),
  );

  const series = streamRow[0]?.data ? downsample(streamRow[0].data, 500) : null;

  // Station splits, when this activity is a race we have imported a result for.
  //
  // They deliberately do NOT come from the laps. Every lap Garmin records is
  // named "Lap 13" — 2,571 of them here, none carrying a station name — so
  // matching training laps to stations is a dead end until someone names them on
  // the watch. The official result does carry them, so the comparison is
  // race-to-target rather than training-to-race.
  const [race] = await sql<{ id: string; event_name: string | null; overall_seconds: number | null }[]>`
    select id, event_name, overall_seconds from races where activity_id = ${id} limit 1
  `;
  const stationSplits = race
    ? (await sql<{ label: string; seconds: number; kind: string; place: number | null }[]>`
        select label, seconds, kind, place from race_splits
         where race_id = ${race.id} and kind in ('station','run','roxzone') order by ord
      `).map((r) => ({ ...r, station: stationOfSplit(r.label) }))
    : [];

  // Zone time is computed from the RAW stream, not the downsampled one. The
  // chart series is bucket-averaged, and averaging a sample that touched Z5 with
  // its neighbours moves it down a zone — which would quietly under-report every
  // interval session's hard minutes.
  // the ATHLETE'S zones, not the app's: a table built from one person's maximum
  // reports the other person's easy runs as threshold work
  const zones = zonesFor(activity.hr_max);
  const raw = streamRow[0]?.data as Record<string, { data?: (number | null)[] }> | undefined;
  const zoneSecs = zoneSeconds(
    raw?.time?.data as number[] | undefined,
    raw?.heartrate?.data as (number | null)[] | undefined,
    zones,
  );
  const zoneTotal = zoneSecs.reduce((a, b) => a + b, 0);

  return NextResponse.json({
    activity: {
      ...activity,
      distance_m: n(activity.distance_m), elevation_m: n(activity.elevation_m),
      avg_hr: n(activity.avg_hr), max_hr: n(activity.max_hr),
      avg_speed_ms: n(activity.avg_speed_ms),
    },
    segments,
    isIntervals,
    stats: {
      work: statsFor(segments, ["work"]),
      rest: statsFor(segments, ["rest"]),
      steady: statsFor(segments, ["steady"]),
      warmup: statsFor(segments, ["warmup"]),
      cooldown: statsFor(segments, ["cooldown"]),
    },
    splits: splits.map((s) => Object.fromEntries(
      Object.entries(s).map(([k, v]) => [k, typeof v === "string" ? Number(v) : v]),
    )),
    series,
    race: race ?? null,
    stationSplits,
    zones: zones.map((z, i) => ({
      tag: z.tag, label: z.label, colour: z.colour,
      seconds: zoneSecs[i],
      pct: zoneTotal ? Math.round((zoneSecs[i] / zoneTotal) * 100) : 0,
    })),
    zoneTotal,
    route: activity.polyline ? decodePolyline(activity.polyline) : [],
    // whether MAPBOX_TOKEN is configured. The client can't read it (no
    // NEXT_PUBLIC_ prefix, by design), so the server has to say.
    basemap: hasBasemap(),
    // lets the view say "still importing" instead of "no data for this run"
    detail_pending: activity.detail_fetched_at == null,
  });
});
