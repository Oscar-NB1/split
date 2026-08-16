/**
 * Turning a benchmark into pace targets.
 *
 * ⚠️ The multipliers below are judgement, not derivation. They came from the
 * brief marked as needing calibration against real benchmark-to-race outcomes
 * before they go live — the durability coefficient especially. Any plan built
 * with them carries UNCALIBRATED so the athlete is not shown a number that
 * looks measured when it is inferred from a table nobody has checked yet.
 */

export const UNCALIBRATED = {
  code: "paces_uncalibrated",
  message:
    "Pace targets come from a conversion table that has not been checked against real race outcomes yet. Treat them as a starting point and trust your effort over the number.",
};

/** Every multiplier is relative to critical velocity. */
export const RUNG_MULTIPLIER = {
  easy: 1.30,
  long: 1.24,
  threshold: 1.06,     // L3
  cv: 1.00,            // L4
  five_k: 0.96,
  neuromuscular: 0.88, // L5, 200–400 m
} as const;

export type Round = { run_time_s: number; station_time_s?: number; transition_time_s?: number };

/**
 * Critical velocity, from the benchmark's best 400 m.
 *
 * Not treated as a time trial: the split is run inside a fatigued circuit, so
 * it already sits near critical velocity rather than at maximum. Taking it at
 * face value is what makes the anchor usable without a separate test.
 */
export function cvPace(rounds: Round[]): number | null {
  const runs = rounds.map((r) => r.run_time_s).filter((s) => s > 0);
  if (runs.length === 0) return null;
  const best = Math.min(...runs);
  return (best / 400) * 1000; // seconds per kilometre
}

/**
 * How much the athlete faded across the rounds.
 *
 * This is the whole reason the benchmark has four rounds rather than one
 * effort: a single split tells you speed, the fade tells you whether it holds.
 * Two athletes with identical 400s get very different prescriptions, which is
 * the correct outcome.
 */
export function durability(rounds: Round[]): number | null {
  const runs = rounds.map((r) => r.run_time_s).filter((s) => s > 0);
  if (runs.length < 2) return null;
  return runs[runs.length - 1] / runs[0];
}

/** The coefficient the brief singles out as most in need of calibration. */
export const DURABILITY_COEFFICIENT = 1.5;

export function racePaceMultiplier(durabilityRatio: number): number {
  return 1.02 + (durabilityRatio - 1.0) * DURABILITY_COEFFICIENT;
}

export type Anchor = {
  cv_pace_s_per_km: number;
  durability: number;
  race_pace_s_per_km: number;
  /** Always present while the table is uncalibrated. */
  flags: { code: string; message: string }[];
};

export function anchorFrom(rounds: Round[]): Anchor | null {
  const cv = cvPace(rounds);
  const d = durability(rounds);
  if (cv == null || d == null) return null;
  const mult = racePaceMultiplier(d);
  return {
    cv_pace_s_per_km: Math.round(cv),
    durability: Math.round(d * 1000) / 1000,
    race_pace_s_per_km: Math.round(cv * mult),
    flags: [UNCALIBRATED],
  };
}

export type Prescription =
  | { kind: "pace"; seconds_per_km: number; flags: { code: string; message: string }[] }
  | { kind: "hr"; zone: number; label: string }
  | { kind: "rpe"; value: number; label: string };

/**
 * What to prescribe when there is no anchor yet.
 *
 * Heart rate wherever a maximum is known, and effort only as the floor. Week 1
 * exists before its own benchmark has been run, so a pace there would be a
 * number nobody has earned — but RPE is not the default when a strap can do
 * better.
 */
export function withoutAnchor(maxHr: number | null, zone: number, rpe: number): Prescription {
  if (maxHr && maxHr > 100) {
    return { kind: "hr", zone, label: `Zone ${zone}` };
  }
  return { kind: "rpe", value: rpe, label: `RPE ${rpe}` };
}

/**
 * An anchor from a 5 km time the athlete has actually run.
 *
 * Paces only ever came from a benchmark, so an athlete who had given a real 5 km
 * time was prescribed heart-rate zones andeffort numbers — "8 min", with no pace
 * anywhere on the session. That is the same mistake as treating a declined test as
 * a property of the plan: the number exists, they ran it, and the plan should use
 * it.
 *
 * Critical velocity sits a little slower than 5 km race pace; the multiplier table
 * hangs off that. Flagged as self-reported rather than measured, because it is.
 */
export function anchorFromFiveK(seconds: number | null): Anchor | null {
  if (!seconds || seconds < 600 || seconds > 3600) return null;
  const fiveKPace = seconds / 5;
  return {
    cv_pace_s_per_km: Math.round(fiveKPace / RUNG_MULTIPLIER.five_k),
    durability: 1,
    race_pace_s_per_km: Math.round(fiveKPace * 1.12),
    flags: [{
      code: "paces_from_five_k",
      message: "Paces come from the 5 km time you gave, not from a test. If that time is old, they will be optimistic.",
    }],
  };
}

/**
 * An anchor from a race the athlete has already run.
 *
 * The best evidence there is short of a benchmark: a real average run split from a
 * real event. It is compromised running — eight runs with a station between each —
 * so fresh critical velocity sits faster than it, which is what the multiplier is.
 */
export function anchorFromRaceSplit(runAvgSeconds: number | null): Anchor | null {
  if (!runAvgSeconds || runAvgSeconds < 150 || runAvgSeconds > 900) return null;
  return {
    cv_pace_s_per_km: Math.round(runAvgSeconds * COMPROMISED_TO_FRESH),
    durability: 1,
    race_pace_s_per_km: runAvgSeconds,
    flags: [{
      code: "paces_from_race",
      message: "Paces come from your own race splits. Fresh running is quicker than compromised running, and the targets account for that.",
    }],
  };
}

/**
 * How much quicker fresh running is than running off a station.
 *
 * Eight per cent, which is the middle of what the field shows between an athlete's
 * standalone 5 km pace and their average Hyrox run split.
 */
export const COMPROMISED_TO_FRESH = 0.92;

/**
 * An anchor from the time the athlete is training for.
 *
 * The weakest of the sources and the only one that is not a measurement: a goal is
 * what they want, not what they have done. Used only when there is nothing else,
 * and flagged as an aspiration so nothing downstream mistakes it for evidence.
 */
export function anchorFromGoal(goalSeconds: number | null): Anchor | null {
  if (!goalSeconds || goalSeconds < 1800 || goalSeconds > 10800) return null;
  // A Hyrox is 8 km of running inside the total; roughly 55% of the clock is spent
  // running for a mid-pack athlete.
  const runSeconds = goalSeconds * 0.55;
  const perKm = runSeconds / 8;
  return {
    cv_pace_s_per_km: Math.round(perKm * COMPROMISED_TO_FRESH),
    durability: 1,
    race_pace_s_per_km: Math.round(perKm),
    flags: [{
      code: "paces_from_goal",
      message: "Paces come from the time you are aiming at, not from anything you have run yet. Run a 5 km or a benchmark and they will be rebuilt from real numbers.",
    }],
  };
}

export function prescribe(
  anchor: Anchor | null, rung: keyof typeof RUNG_MULTIPLIER | "hyrox_race",
  maxHr: number | null, fallbackZone: number, fallbackRpe: number,
): Prescription {
  if (!anchor) return withoutAnchor(maxHr, fallbackZone, fallbackRpe);
  const seconds = rung === "hyrox_race"
    ? anchor.race_pace_s_per_km
    : Math.round(anchor.cv_pace_s_per_km * RUNG_MULTIPLIER[rung]);
  return { kind: "pace", seconds_per_km: seconds, flags: anchor.flags };
}
