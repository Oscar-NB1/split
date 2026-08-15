/**
 * Capturing a benchmark.
 *
 * Watch-first: nobody wants to tap a phone between sled pushes. The benchmark
 * is built as a structured workout, pushed to the watch, and the athlete
 * presses lap at each boundary — which gives segmentation and full-fidelity
 * heart rate from one device with no phone in the gym.
 *
 * Segments, not rounds, because a transition is a segment too and there is no
 * other way to record one.
 */

export type SegmentType = "run" | "station" | "transition";
export type CaptureSource = "app_timer" | "manual" | "derived_from_laps";

export type Segment = {
  index: number;
  type: SegmentType;
  station_id?: string;
  offset_s: number;
  duration_s: number;
  distance_m?: number;
  scaled_load?: number;
  source: CaptureSource;
  /** set where a segment was inferred rather than pressed for */
  low_confidence?: boolean;
};

export type HrCapture = {
  source: "strava" | "garmin" | "whoop" | "none";
  external_activity_id?: string;
  series?: { t_offset_s: number; bpm: number }[];
  alignment_offset_s?: number;
  avg?: number; max?: number; recovery_60s?: number;
};

export type Capture = {
  athlete_id: string;
  protocol_version: number;
  variant: string;
  submaximal: boolean;
  started_at: string;
  segments: Segment[];
  hr: HrCapture;
  completion: { aborted: boolean; abort_segment_index?: number; notes?: string };
};

// -------------------------------------------------------------- the protocol

/** Four runs and four stations: eight laps, one press per boundary. */
export const EXPECTED_LAPS = 8;
export const RUN_DISTANCE_M = 400;
export const RUN_TOLERANCE = 0.15;
export const DURATION_TOLERANCE = 0.25;

/** Odd laps are runs, even laps are stations, in protocol order. */
export const isRunLap = (index: number) => index % 2 === 1;

export type Lap = { elapsed_time: number; distance: number; average_heartrate?: number };

export type Mapping = {
  ok: boolean;
  segments: Segment[];
  problems: string[];
  /** true when the athlete has to confirm the mapping before anything is derived */
  needsConfirmation: boolean;
};

/**
 * Turn laps into segments, and refuse to guess.
 *
 * A full race simulation on this project recorded run 2 and the sled push as
 * one lap, which shifted every later segment by one and had to be rebuilt from
 * lap distances afterwards. A structured workout makes a missed press
 * *detectable*: the expected count is known, so the check either passes or the
 * athlete is asked. One tap resolves it; a silent one-position shift corrupts
 * every finding downstream.
 */
export function mapLaps(laps: Lap[], protocolDurationS: number): Mapping {
  const problems: string[] = [];

  if (laps.length !== EXPECTED_LAPS) {
    problems.push(
      `${laps.length} laps recorded against ${EXPECTED_LAPS} expected — a press was probably missed or doubled.`,
    );
  }

  laps.forEach((lap, i) => {
    if (!isRunLap(i + 1)) return;
    const off = Math.abs(lap.distance - RUN_DISTANCE_M) / RUN_DISTANCE_M;
    if (off > RUN_TOLERANCE) {
      problems.push(
        `Lap ${i + 1} should be a ${RUN_DISTANCE_M} m run and measured ${Math.round(lap.distance)} m.`,
      );
    }
  });

  const total = laps.reduce((n, l) => n + l.elapsed_time, 0);
  if (protocolDurationS > 0) {
    const off = Math.abs(total - protocolDurationS) / protocolDurationS;
    if (off > DURATION_TOLERANCE) {
      problems.push(
        `The session took ${Math.round(total / 60)} min against about ${Math.round(protocolDurationS / 60)} expected.`,
      );
    }
  }

  let offset = 0;
  const segments: Segment[] = laps.map((lap, i) => {
    const seg: Segment = {
      index: i + 1,
      type: isRunLap(i + 1) ? "run" : "station",
      offset_s: offset,
      duration_s: lap.elapsed_time,
      distance_m: lap.distance || undefined,
      source: "derived_from_laps",
    };
    offset += lap.elapsed_time;
    return seg;
  });

  return {
    ok: problems.length === 0,
    segments,
    problems,
    needsConfirmation: problems.length > 0,
  };
}

/**
 * Transitions, where a velocity stream can show them.
 *
 * Deliberately not pressed for. A benchmark transition is walking five metres
 * in a gym, which says almost nothing about race roxzone — crossing a venue and
 * queueing for equipment. Roxzone belongs to rank-1 race data and to full
 * simulations, so anything found here is marked low-confidence and never
 * promoted to a capability.
 */
export function inferTransitions(
  segments: Segment[], velocity: { t: number; v: number }[] | null,
): Segment[] {
  if (!velocity || velocity.length === 0) return segments;
  const STILL = 0.5; // m/s
  const out: Segment[] = [];

  for (const seg of segments) {
    out.push(seg);
    const end = seg.offset_s + seg.duration_s;
    let gap = 0;
    for (const p of velocity) {
      if (p.t < end || p.t > end + 90) continue;
      if (p.v <= STILL) gap++; else break;
    }
    if (gap >= 3) {
      out.push({
        index: seg.index + 0.5,
        type: "transition",
        offset_s: end,
        duration_s: gap,
        source: "derived_from_laps",
        low_confidence: true,
      });
    }
  }
  return out;
}

// -------------------------------------------------------- progressive results

export type Finding = {
  key: string;
  value: number;
  /** HR findings arrive later, so they are absent rather than blank until then */
  needs: "time" | "hr";
};

/**
 * What can be said the moment the athlete finishes.
 *
 * Strava lags Garmin by minutes to hours, so the results screen must not wait
 * for it. Everything time-based comes from the capture alone; anything that
 * needs a heart-rate series stays absent until the stream arrives rather than
 * rendering as a blank that looks like a failure.
 */
export function timeFindings(segments: Segment[]): Finding[] {
  const runs = segments.filter((s) => s.type === "run" && s.duration_s > 0);
  if (runs.length === 0) return [];
  const out: Finding[] = [];

  const best = Math.min(...runs.map((r) => r.duration_s));
  out.push({ key: "best_run_s", value: best, needs: "time" });

  if (runs.length >= 2) {
    out.push({
      key: "durability",
      value: Math.round((runs[runs.length - 1].duration_s / runs[0].duration_s) * 1000) / 1000,
      needs: "time",
    });
    const mean = runs.reduce((n, r) => n + r.duration_s, 0) / runs.length;
    const spread = Math.max(...runs.map((r) => Math.abs(r.duration_s - mean))) / mean;
    out.push({ key: "pacing_spread", value: Math.round(spread * 1000) / 1000, needs: "time" });
  }

  const stations = segments.filter((s) => s.type === "station");
  if (stations.length > 0) {
    out.push({
      key: "station_total_s",
      value: stations.reduce((n, s) => n + s.duration_s, 0),
      needs: "time",
    });
  }
  return out;
}

/** What only arrives once the heart-rate stream does. */
export function hrFindings(hr: HrCapture): Finding[] {
  if (hr.source === "none" || !hr.series?.length) return [];
  const out: Finding[] = [];
  if (hr.max) out.push({ key: "hr_max_session", value: hr.max, needs: "hr" });
  if (hr.recovery_60s) out.push({ key: "hr_recovery_60s", value: hr.recovery_60s, needs: "hr" });
  return out;
}

/**
 * How the session was captured, worst case first.
 *
 * Manual entry of four run splits still yields speed, durability and pacing —
 * three of the seven dimensions. A degraded capture is worth far more than a
 * refused one.
 */
export const FALLBACKS = [
  { when: "watch with a structured workout", capture: "eight laps, one press per segment" },
  { when: "watch, no structured workout", capture: "free-form activity, validated, then confirmed" },
  { when: "no watch", capture: "phone timer in-app, one tap per segment" },
  { when: "nothing synced", capture: "manual entry of four run splits" },
] as const;

/**
 * Two things a watch cannot record, so a confirmation screen exists regardless
 * — after the session, never during it. That is the whole difference from a
 * phone-driven capture.
 */
export const CONFIRM_AFTER = ["scaled_load", "aborted"] as const;
