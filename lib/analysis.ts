/**
 * Turning stored laps, splits and streams into the numbers a training view
 * actually shows. No database access and no I/O — everything here is a pure
 * function of rows already fetched, which is what makes it testable.
 *
 * The one piece of real judgment is deciding which laps were *work* and which
 * were *recovery*. Strava doesn't say. What it gives is a lap list, and on a
 * Garmin interval workout that list alternates: 300m hard, 150s float, 300m
 * hard, and so on. So the structure is recoverable from lap speed alone.
 */

export type LapRow = {
  lap_index: number;
  name: string | null;
  distance_m: number | null;
  moving_seconds: number | null;
  elapsed_seconds: number | null;
  avg_speed_ms: number | null;
  max_speed_ms: number | null;
  avg_hr: number | null;
  max_hr: number | null;
};

export type Role = "work" | "rest" | "warmup" | "cooldown" | "steady" | "stub";

export type Segment = LapRow & {
  role: Role;
  /** Seconds from the start of the activity, by cumulative elapsed time. */
  start_s: number;
  end_s: number;
};

/** A lap this short is a watch artefact — a stray press, or the stop-and-save. */
const STUB_M = 50;
const STUB_S = 20;

/**
 * A speed gap has to be this large, relative to the median lap speed, before we
 * call a session "intervals" rather than a steady run someone auto-lapped every
 * kilometre. 0.20 = the fast group is at least 20% quicker than the slow group.
 *
 * Real numbers this was set against: a 10x300m session gaps 2.99 -> 4.29 m/s,
 * which is 43% of its median. Auto-lapped steady runs sit under 8%.
 */
const INTERVAL_GAP = 0.2;

const num = (v: number | null | undefined) => (v == null ? null : Number(v));

/**
 * Assign a role to every lap.
 *
 * Method: drop stubs, then look at the sorted lap speeds for the largest single
 * jump between neighbours. If that jump is a big fraction of the median speed,
 * the laps split cleanly into two populations and the session is intervals —
 * everything above the jump is work, everything below is recovery. If no jump
 * stands out, every lap is the same kind of running and the session is steady.
 *
 * A first or last lap that came out as recovery is relabelled warmup/cooldown,
 * because folding a 1km jog-out into "average recovery HR" drags it down by
 * 25bpm and makes the recoveries look easier than they were.
 */
export function classifySegments(laps: LapRow[]): { segments: Segment[]; isIntervals: boolean } {
  // Time offsets come from cumulative elapsed time, not from Strava's
  // start_index — that is an index into the stream arrays, which is only equal
  // to seconds when the watch recorded at exactly 1Hz.
  let clock = 0;
  const withClock = [...laps]
    .sort((a, b) => a.lap_index - b.lap_index)
    .map((l) => {
      const start_s = clock;
      clock += num(l.elapsed_seconds) ?? num(l.moving_seconds) ?? 0;
      return { ...l, start_s, end_s: clock };
    });

  const isStub = (l: LapRow) =>
    (num(l.distance_m) ?? 0) < STUB_M && (num(l.moving_seconds) ?? 0) < STUB_S;

  const usable = withClock.filter((l) => !isStub(l) && (num(l.avg_speed_ms) ?? 0) > 0);
  const speeds = usable.map((l) => num(l.avg_speed_ms)!).sort((a, b) => a - b);

  // Fewer than four usable laps is not an interval session in any useful sense.
  let cut: number | null = null;
  if (speeds.length >= 4) {
    const median = speeds[Math.floor(speeds.length / 2)];
    let biggest = 0;
    let at = -1;
    for (let i = 1; i < speeds.length; i++) {
      const gap = speeds[i] - speeds[i - 1];
      if (gap > biggest) { biggest = gap; at = i; }
    }
    if (median > 0 && biggest / median >= INTERVAL_GAP) cut = speeds[at];
  }

  const segments: Segment[] = withClock.map((l) => {
    if (isStub(l)) return { ...l, role: "stub" as Role };
    if (cut == null) return { ...l, role: "steady" as Role };
    const fast = (num(l.avg_speed_ms) ?? 0) >= cut;
    return { ...l, role: (fast ? "work" : "rest") as Role };
  });

  if (cut != null) {
    const live = segments.filter((s) => s.role !== "stub");
    const first = live[0];
    const last = live[live.length - 1];
    if (first?.role === "rest") first.role = "warmup";
    if (last?.role === "rest" && last !== first) last.role = "cooldown";
  }

  return { segments, isIntervals: cut != null };
}

export type RoleStats = {
  count: number;
  distance_m: number;
  moving_seconds: number;
  /** Time-weighted, so a 150s float doesn't count as much as a 6-minute km. */
  avg_hr: number | null;
  /** Highest single-segment average — the "peak segment HR" of a session. */
  peak_segment_hr: number | null;
  /** Lowest single-segment average — how far HR actually came down on recoveries. */
  lowest_segment_hr: number | null;
  /** Highest instantaneous HR seen inside any segment of this role. */
  max_hr: number | null;
  avg_speed_ms: number | null;
  best_speed_ms: number | null;
};

/** Aggregate one role. Averages are weighted by time, never a mean of means. */
export function statsFor(segments: Segment[], roles: Role[]): RoleStats {
  const rows = segments.filter((s) => roles.includes(s.role));
  const secs = rows.reduce((n, r) => n + (num(r.moving_seconds) ?? 0), 0);
  const dist = rows.reduce((n, r) => n + (num(r.distance_m) ?? 0), 0);

  const hrRows = rows.filter((r) => num(r.avg_hr) != null && (num(r.moving_seconds) ?? 0) > 0);
  const hrSecs = hrRows.reduce((n, r) => n + num(r.moving_seconds)!, 0);
  const hrWeighted = hrRows.reduce((n, r) => n + num(r.avg_hr)! * num(r.moving_seconds)!, 0);

  const avgHrs = rows.map((r) => num(r.avg_hr)).filter((v): v is number => v != null);
  const maxHrs = rows.map((r) => num(r.max_hr)).filter((v): v is number => v != null);
  const speeds = rows.map((r) => num(r.avg_speed_ms)).filter((v): v is number => v != null);

  return {
    count: rows.length,
    distance_m: dist,
    moving_seconds: secs,
    avg_hr: hrSecs > 0 ? hrWeighted / hrSecs : null,
    peak_segment_hr: avgHrs.length ? Math.max(...avgHrs) : null,
    lowest_segment_hr: avgHrs.length ? Math.min(...avgHrs) : null,
    max_hr: maxHrs.length ? Math.max(...maxHrs) : null,
    avg_speed_ms: secs > 0 && dist > 0 ? dist / secs : null,
    best_speed_ms: speeds.length ? Math.max(...speeds) : null,
  };
}

// --------------------------------------------------------------------- streams

export type StreamData = Record<string, { data?: (number | null)[] }>;
export type Series = { t: number[]; hr: (number | null)[]; speed: (number | null)[]; dist: number[]; alt: (number | null)[] };

/**
 * Reduce a stream to at most `target` points for the chart.
 *
 * A one-hour run at 1Hz is 3600 samples per series; five series of that is a
 * ~250kB JSON payload to draw a line a few hundred pixels wide. Buckets are
 * averaged rather than sampled, so a single-second HR spike can't be the value
 * that represents six seconds — and can't be dropped either, since `max_hr`
 * comes from the activity row, not from this.
 */
export function downsample(streams: StreamData, target = 500): Series {
  const get = (k: string) => streams?.[k]?.data ?? [];
  const time = get("time") as number[];
  const n = time.length;
  const out: Series = { t: [], hr: [], speed: [], dist: [], alt: [] };
  if (n === 0) return out;

  const hr = get("heartrate");
  const sp = get("velocity_smooth");
  const di = get("distance") as number[];
  const al = get("altitude");

  const step = Math.max(1, Math.ceil(n / target));
  const mean = (arr: (number | null)[], from: number, to: number) => {
    let sum = 0, count = 0;
    for (let i = from; i < to; i++) {
      const v = arr[i];
      if (typeof v === "number" && Number.isFinite(v)) { sum += v; count++; }
    }
    return count ? sum / count : null;
  };

  for (let i = 0; i < n; i += step) {
    const to = Math.min(n, i + step);
    out.t.push(time[i] ?? 0);
    out.hr.push(mean(hr, i, to));
    out.speed.push(mean(sp, i, to));
    // distance is cumulative, so the bucket's own end value is the honest one
    out.dist.push((di[to - 1] as number) ?? 0);
    out.alt.push(mean(al, i, to));
  }
  return out;
}

// -------------------------------------------------------------------- the map

/**
 * Decode Google's encoded-polyline format, which is what Strava puts in
 * `map.summary_polyline`. Written out rather than pulled in as a dependency —
 * it is fifteen lines and the alternative is a package for fifteen lines.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b: number;
      do {
        b = encoded.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      // a negative delta is stored inverted and one-shifted
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// ------------------------------------------------------------------ formatting

/** m/s to mm:ss per km — the only pace unit either athlete thinks in. */
export function pace(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const secPerKm = Math.round(1000 / ms);
  if (secPerKm > 3600) return "—"; // slower than 60min/km is a stopped watch
  // Rounding is done on the total, so 5:59.7 becomes 6:00 rather than 5:60.
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}`;
}

export function hms(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export const ROLE_LABEL: Record<Role, string> = {
  work: "Work",
  rest: "Recovery",
  warmup: "Warm-up",
  cooldown: "Cool-down",
  steady: "Steady",
  stub: "—",
};
