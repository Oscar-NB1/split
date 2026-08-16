/**
 * The race plan: eight runs, eight stations, and the roxzone between them.
 *
 * Pure. Two directions that must reconcile, a sensitivity table, and a realism
 * check that flags rather than blocks.
 *
 * The differentiator is that nothing here starts blank. Every field carries
 * where it came from, and `source` drives both the confidence badge and whether
 * the client may present a number as the athlete's own.
 */

export const RUN_COUNT = 8;
export const STATION_COUNT = 8;
/** Eight runs of a kilometre each, which is where the sensitivity table comes from. */
export const RUN_KM = 1;
/** Eight transitions, one after each run into its station. */
export const TRANSITION_COUNT = 8;

/**
 * Where a number came from, best first.
 *
 * `race` is their own previous splits — the only thing that measures a roxzone.
 * `estimated` is a field median, and must never be dressed up as theirs.
 */
export const SOURCES = ["race", "benchmark", "key_sessions", "estimated", "manual"] as const;
export type Source = (typeof SOURCES)[number];

const RANK: Record<Source, number> = {
  race: 0, benchmark: 1, key_sessions: 2, manual: 3, estimated: 4,
};

export type RunTarget = { target_pace_s_per_km: number; source: Source };
export type StationTarget = {
  station_id: string; target_time_s: number;
  /** the fraction of the station this athlete does; 1 for singles */
  my_share: number; source: Source;
};
export type Roxzone = { per_transition_s: number; source: Source };

export type RacePlan = {
  mode: "target_down" | "components_up";
  target_total_s: number | null;
  runs: RunTarget[];
  stations: StationTarget[];
  roxzone: Roxzone;
};

/** The badge. One estimated field is enough to stop calling a plan measured. */
export function confidenceOf(p: RacePlan): "measured" | "derived" | "estimated" {
  const all: Source[] = [
    ...p.runs.map((r) => r.source),
    ...p.stations.map((s) => s.source),
    p.roxzone.source,
  ];
  if (all.some((s) => s === "estimated")) return "estimated";
  if (all.every((s) => s === "race")) return "measured";
  return "derived";
}

// ---------------------------------------------------------------- projection

export type Projection = {
  run_total_s: number;
  station_total_s: number;
  roxzone_total_s: number;
  projected_total_s: number;
  /** signed: positive means slower than target, which is the gap to close */
  gap_to_target_s: number | null;
  confidence: "measured" | "derived" | "estimated";
};

/** Components up: what these numbers add to. */
export function project(p: RacePlan): Projection {
  const run_total_s = p.runs.reduce((n, r) => n + r.target_pace_s_per_km * RUN_KM, 0);
  const station_total_s = p.stations.reduce((n, s) => n + s.target_time_s * s.my_share, 0);
  const roxzone_total_s = p.roxzone.per_transition_s * TRANSITION_COUNT;
  const projected_total_s = Math.round(run_total_s + station_total_s + roxzone_total_s);

  return {
    run_total_s: Math.round(run_total_s),
    station_total_s: Math.round(station_total_s),
    roxzone_total_s,
    projected_total_s,
    gap_to_target_s: p.target_total_s === null
      ? null : projected_total_s - p.target_total_s,
    confidence: confidenceOf(p),
  };
}

export type Delta = { component: string; change_s: number; why: string };

/**
 * What would close the gap, rather than a rescaled plan.
 *
 * The components are never silently adjusted to hit the target. An athlete who
 * sets a time and is shown components that add to it exactly has learned
 * nothing — the useful output is which component is furthest from plausible and
 * what it would have to give.
 */
export function deltasToClose(p: RacePlan): Delta[] {
  const proj = project(p);
  if (proj.gap_to_target_s === null || proj.gap_to_target_s === 0) return [];
  const gap = proj.gap_to_target_s;
  const s = sensitivity();

  return [
    {
      component: "run_pace",
      change_s: round1(-gap / s.run_pace_1s_per_km),
      why: `${Math.abs(round1(gap / s.run_pace_1s_per_km))} s/km across all eight runs`,
    },
    {
      component: "stations",
      change_s: round1(-gap / STATION_COUNT),
      why: `${Math.abs(round1(gap / STATION_COUNT))} s off every station`,
    },
    {
      component: "roxzone",
      change_s: round1(-gap / TRANSITION_COUNT),
      why: `${Math.abs(round1(gap / TRANSITION_COUNT))} s off every transition`,
    },
  ];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Target down: distribute a total across the components.
 *
 * Proportional to what is already there, so an athlete's own shape is kept
 * rather than replaced by an even split. Roxzone is held fixed — it is the one
 * component training cannot move, and shaving it to make the arithmetic work
 * would be inventing a number.
 *
 * The result lands within a few seconds of the requested total rather than on
 * it, because targets are whole seconds and sixteen of them cannot always sum
 * to an arbitrary number. Bending one run to absorb the remainder would hit the
 * total exactly and hand the athlete one rep that is deliberately different for
 * no reason they could see — a worse trade than four seconds across an hour.
 */
export function distribute(p: RacePlan, total_s: number): RacePlan {
  const fixed = p.roxzone.per_transition_s * TRANSITION_COUNT;
  const movable = total_s - fixed;
  const current = project(p);
  const currentMovable = current.run_total_s + current.station_total_s;
  if (movable <= 0 || currentMovable <= 0) return { ...p, target_total_s: total_s };

  const k = movable / currentMovable;
  return {
    ...p,
    target_total_s: total_s,
    runs: p.runs.map((r) => ({
      ...r,
      target_pace_s_per_km: Math.round(r.target_pace_s_per_km * k),
      source: "manual",
    })),
    stations: p.stations.map((st) => ({
      ...st,
      target_time_s: Math.round(st.target_time_s * k),
      source: "manual",
    })),
  };
}

// --------------------------------------------------------------- sensitivity

export type Sensitivity = {
  run_pace_1s_per_km: number;
  each_station_5s: number;
  roxzone_5s: number;
};

/**
 * Where a second is worth most.
 *
 * The most decision-changing output there is: one second per kilometre is eight
 * seconds of race, because there are eight kilometres of running. Five seconds
 * off every station is forty. Someone deciding where to spend six weeks should
 * see this before anything else.
 */
export const sensitivity = (): Sensitivity => ({
  run_pace_1s_per_km: RUN_COUNT * RUN_KM,
  each_station_5s: STATION_COUNT * 5,
  roxzone_5s: TRANSITION_COUNT * 5,
});

// ------------------------------------------------------------ realism check

export type Capability = {
  /** best measured 5 km pace, in seconds per kilometre */
  best_5k_pace_s_per_km?: number;
  /** best recorded time per station id */
  best_station_s?: Record<string, number>;
  /** what current form projects for the whole thing */
  current_form_total_s?: number;
};

export type RaceFlag = { code: string; component: string; message: string };

/** Under this, a transition is not a transition. */
export const ROXZONE_FLOOR_S = 20;
/** How far past current form counts as a stretch rather than a plan. */
export const STRETCH_MARGIN = 0.08;

/**
 * Flagged, never blocked.
 *
 * An athlete may keep an ambitious plan — it is their race. What they should not
 * have is an ambitious plan they believe is a realistic one, so each flag names
 * the component doing the wishful thinking rather than judging the total.
 */
export function realism(p: RacePlan, c: Capability): RaceFlag[] {
  const out: RaceFlag[] = [];

  if (c.best_5k_pace_s_per_km) {
    const quickest = Math.min(...p.runs.map((r) => r.target_pace_s_per_km));
    if (quickest < c.best_5k_pace_s_per_km) {
      out.push({
        code: "unrealistic_runs", component: "runs",
        message: `The plan asks for ${mmss(quickest)} /km between stations, which is quicker than your best measured 5 km pace of ${mmss(c.best_5k_pace_s_per_km)} /km — on fresh legs, with no sled behind you.`,
      });
    }
  }

  for (const s of p.stations) {
    const best = c.best_station_s?.[s.station_id];
    if (best !== undefined && s.target_time_s < best) {
      out.push({
        code: "unrealistic_stations", component: s.station_id,
        message: `${s.station_id} is planned at ${mmss(s.target_time_s)} against a best of ${mmss(best)}.`,
      });
    }
  }

  if (p.roxzone.per_transition_s < ROXZONE_FLOOR_S) {
    out.push({
      code: "unrealistic_roxzone", component: "roxzone",
      message: `${p.roxzone.per_transition_s} s per transition assumes no queue and no walking. Twenty seconds is about the floor for a clean one.`,
    });
  }

  const proj = project(p);
  if (c.current_form_total_s
      && proj.projected_total_s < c.current_form_total_s * (1 - STRETCH_MARGIN)) {
    out.push({
      code: "stretch_target", component: "total",
      message: `${mmss(proj.projected_total_s)} is more than ${Math.round(STRETCH_MARGIN * 100)}% faster than your current form projects. Keep it if you mean it, but the sensitivity table says where it would have to come from.`,
    });
  }

  return out;
}

export function mmss(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- pre-fill

/**
 * Pick the best available number and say where it came from.
 *
 * Candidates are offered best-source-first and the first present one wins.
 * Nothing is blended: an average of a race split and a field median is neither,
 * and the athlete could not tell which half they were being shown.
 */
export function prefill<T>(
  candidates: { value: T | null | undefined; source: Source }[],
): { value: T; source: Source } | null {
  const found = [...candidates]
    .sort((a, b) => RANK[a.source] - RANK[b.source])
    .find((c) => c.value !== null && c.value !== undefined);
  return found ? { value: found.value as T, source: found.source } : null;
}

/**
 * The roxzone is the exception, and the reason `prefill` is not used for it.
 *
 * Nothing in training measures crossing a venue and queueing for equipment, so
 * there is no derivable fallback. Either they have raced, or they are asked —
 * with the field median as a starting point, marked estimated, never presented
 * as theirs.
 */
export function roxzoneFrom(
  previousRace: number | null, fieldMedian: number,
): { roxzone: Roxzone; needs_confirmation: boolean } {
  if (previousRace !== null) {
    return { roxzone: { per_transition_s: previousRace, source: "race" }, needs_confirmation: false };
  }
  return {
    roxzone: { per_transition_s: fieldMedian, source: "estimated" },
    needs_confirmation: true,
  };
}

// ------------------------------------------------------------- race day

export type Split = { label: string; run_s: number; station_s: number; transition_s: number };

/**
 * Cumulative time at each station, in race order.
 *
 * The one thing that gets glanced at mid-race, so it is precomputed rather than
 * derived on a phone with no signal in a loud venue. Each entry is the clock
 * after that station's run, station and transition.
 */
export function cumulative(p: RacePlan): { label: string; at_s: number }[] {
  const out: { label: string; at_s: number }[] = [];
  let acc = 0;
  p.stations.forEach((s, i) => {
    acc += (p.runs[i]?.target_pace_s_per_km ?? 0) * RUN_KM
      + s.target_time_s * s.my_share
      + (i < TRANSITION_COUNT ? p.roxzone.per_transition_s : 0);
    out.push({ label: s.station_id, at_s: Math.round(acc) });
  });
  return out;
}

/**
 * The three ways to close a gap, phrased as a choice.
 *
 * Any one of them gets there, which is the useful framing: the athlete picks the
 * lever they believe in rather than being handed a rescaled plan and told it is
 * theirs.
 */
export function routes(p: RacePlan): { kind: string; label: string }[] {
  const ds = deltasToClose(p);
  if (ds.length === 0) return [];
  const find = (k: string) => ds.find((d) => d.component === k)!;
  const dir = (n: number) => (n < 0 ? "quicker" : "slower");
  return [
    { kind: "runs", label: `${Math.abs(find("run_pace").change_s)} s/km ${dir(find("run_pace").change_s)} on every run` },
    { kind: "stations", label: `${Math.abs(find("stations").change_s)} s off every station` },
    { kind: "roxzone", label: `${Math.abs(find("roxzone").change_s)} s off every transition` },
  ];
}

/** The sensitivity table as the sentence the screen shows. */
export function sensitivityLine(): { line: string; why: string } {
  const s = sensitivity();
  return {
    line: `One second per kilometre is ${s.run_pace_1s_per_km} seconds of race.`,
    why: `There are eight kilometres of running in a Hyrox, so pace moves the total ${s.run_pace_1s_per_km}× faster than it looks. Five seconds off every station is ${s.each_station_5s} seconds; five off every transition is ${s.roxzone_5s}. Spend your weeks where the arithmetic is.`,
  };
}
