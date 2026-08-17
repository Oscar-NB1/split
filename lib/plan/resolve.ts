/**
 * Stage 1 of the generator: turning answers into numbers.
 *
 * Pure. No I/O, no model calls, no clock. The whole point of a deterministic
 * generator is that "why does week 6 look like that" has an answer, and every
 * number below traces to a table you can read.
 */

export const TRAINING_AGE = ["novice", "intermediate", "advanced", "elite"] as const;
export type TrainingAge = (typeof TRAINING_AGE)[number];

export const RUNNING_BASE = [
  "doesnt_run", "walk_breaks", "5k_nonstop", "runs_regularly",
  "half_marathon_fit", "marathon_competitive",
] as const;
export type RunningBase = (typeof RUNNING_BASE)[number];

/**
 * Weekly kilometres by training age and how many sessions a week they can do.
 *
 * The flattening at 6–7 sessions on a low training age is deliberate: someone
 * new with seven days free should be given fewer sessions than they offered,
 * and told why, rather than handed volume their tissue has not earned.
 */
export const BASE_MATRIX: Record<TrainingAge, Record<number, number>> = {
  novice:       { 2: 6,  3: 8,  4: 10, 5: 12, 6: 12, 7: 12 },
  intermediate: { 2: 9,  3: 12, 4: 15, 5: 18, 6: 20, 7: 20 },
  advanced:     { 2: 12, 3: 16, 4: 20, 5: 24, 6: 28, 7: 30 },
  elite:        { 2: 15, 3: 20, 4: 26, 5: 30, 6: 34, 7: 38 },
};

/**
 * The guard that matters most.
 *
 * Without it, someone with years of gym training who cannot run 5 km gets
 * prescribed 30 km in week 1. Training age says what their engine can take;
 * this says what their legs can.
 */
/**
 * The most weekly running each base supports — and it is a destination, not a lid.
 *
 * These were written to protect somebody from doing too much, and for general fitness they
 * do that well. For somebody who has entered a race they were preventing the opposite
 * thing: a Hyrox contains eight kilometres of running, and a 15 km ceiling means race day
 * is more than half of the biggest week the plan will ever allow. That is not caution, it
 * is a plan that cannot get its athlete to the start line.
 *
 * So there are two tables. The base ceiling is where a block *ends* when there is no race
 * to prepare for. `RACE_CEILING` is where it ends when there is — roughly double, which is
 * what it takes for an 8 km race to be a third of a peak week rather than most of one, and
 * still well inside what the ramp rate can reach in a ten-week block.
 *
 * The ramp still governs how fast anybody gets there, and the down weeks still land. This
 * raises the roof; it does not push anyone towards it.
 */
export const RUNNING_CEILING: Record<RunningBase, number | null> = {
  doesnt_run: 8,
  walk_breaks: 15,
  "5k_nonstop": 22,
  runs_regularly: 32,
  half_marathon_fit: 45,
  marathon_competitive: null,
};

export const RACE_CEILING: Record<RunningBase, number | null> = {
  // Still low, deliberately: somebody who does not run and has entered a race in ten
  // weeks needs the ceiling to be honest with them rather than ambitious.
  doesnt_run: 16,
  walk_breaks: 30,
  "5k_nonstop": 38,
  runs_regularly: 50,
  half_marathon_fit: 60,
  marathon_competitive: null,
};

export const BASE_RAMP: Record<TrainingAge, number> = {
  novice: 0.06, intermediate: 0.08, advanced: 0.10, elite: 0.12,
};
export const RUNNING_RAMP: Record<RunningBase, number> = {
  doesnt_run: 0.05, walk_breaks: 0.06, "5k_nonstop": 0.08,
  runs_regularly: 0.10, half_marathon_fit: 0.10, marathon_competitive: 0.12,
};

/** Longest run of loading weeks before something has to come down. */
export const MAX_BLOCK: Record<TrainingAge, number> = {
  novice: 3, intermediate: 4, advanced: 5, elite: 6,
};

/** How many hard days a week the athlete can absorb. */
export const MAX_HARD: Record<TrainingAge, number> = {
  novice: 2, intermediate: 3, advanced: 4, elite: 5,
};

export type HyroxExperience = { months: number; sessions_per_week: number; races_done: number };

/**
 * Hyrox history as a training age in its own right.
 *
 * Someone two years into Hyrox with races behind them is not a novice, whatever
 * they say about general training — and the reverse is also true, which is why
 * the two are combined by taking the higher rather than by averaging.
 */
export function hyroxToAge(h: HyroxExperience | null): TrainingAge {
  if (!h) return "novice";
  if (h.races_done >= 3 && h.months >= 18) return "elite";
  if (h.races_done >= 1 && h.months >= 9) return "advanced";
  if (h.months >= 3 || h.races_done >= 1) return "intermediate";
  return "novice";
}

const rank = (a: TrainingAge) => TRAINING_AGE.indexOf(a);
export const olderOf = (a: TrainingAge, b: TrainingAge) => (rank(a) >= rank(b) ? a : b);

export type Confidence = "estimated" | "measured";

/**
 * What the athlete has actually been running lately.
 *
 * `measured` comes from their own activity history, `reported` from the intake.
 * The distinction matters at exactly one point — how far a number is allowed to
 * raise the running ceiling — because a figure typed into a form is a memory
 * and a figure from the file is a record.
 */
export type RecentRunning = {
  /** biggest week in the last four — the number week 1 is built from */
  peak_week_km: number | null;
  /** longest single run in the last eight weeks */
  long_run_km: number | null;
  source: "measured" | "reported";
};

/**
 * The running base a long run demonstrates, whatever the athlete called
 * themselves. One 18 km run is not a claim about identity, it is evidence.
 */
export function baseFromLongRun(km: number | null): RunningBase | null {
  if (!km || km <= 0) return null;
  if (km >= 30) return "marathon_competitive";
  if (km >= 18) return "half_marathon_fit";
  if (km >= 10) return "runs_regularly";
  if (km >= 5) return "5k_nonstop";
  if (km >= 2) return "walk_breaks";
  return "doesnt_run";
}

const runRank = (b: RunningBase) => RUNNING_BASE.indexOf(b);

/**
 * The weekly ceiling a longest run implies.
 *
 * A long run is normally a quarter to a third of a week, so 3.2 times it is the
 * generous end of what that week can be. This caps the ceiling rather than the
 * answer: it is a statement about what the athlete's legs currently support,
 * and it binds whatever they called themselves.
 */
export const LONG_RUN_SHARE = 3.2;

/**
 * How far a recent peak week may outrun the training-base bracket.
 *
 * A peak week is evidence and a bracket is a guess, so evidence wins — but one
 * enormous week inside an otherwise quiet block is a race or a one-off, not a
 * base. Capped either side.
 */
export const PEAK_OVER_BRACKET = 1.6;

export type ResolveInput = {
  general_training_age: TrainingAge;
  hyrox_experience: HyroxExperience | null;
  running_base: RunningBase;
  target_sessions: number;
  available_days: number;
  confidence: Confidence;
  /** The athlete's volume dial, as a multiplier on the ramp. 1.0 is Progressive. */
  volume_dial?: number;
  allow_doubles?: boolean;
  recent?: RecentRunning | null;
  /**
   * Whether there is a race on the calendar.
   *
   * It decides which ceiling applies. Somebody training to be fit and somebody with an
   * entry in eight weeks need different roofs — the first is protected by a low one and the
   * second is trapped under it.
   */
  has_race?: boolean;
  /** how many weeks the block runs, so the ramp can be checked against the peak */
  block_weeks?: number;
};

export type Resolved = {
  training_age: TrainingAge;
  start_volume: number;
  ramp_rate: number;
  peak_ceiling: number;
  max_block: number;
  max_hard: number;
  /** what the base matrix alone would have said, kept for the explanation */
  matrix_volume: number;
  ceiling: number | null;
  /** sessions actually schedulable, which is not always what was asked for */
  sessions: number;
  flags: string[];
};

export function resolve(x: ResolveInput): Resolved {
  const training_age = olderOf(x.general_training_age, hyroxToAge(x.hyrox_experience));
  const flags: string[] = [];

  // High availability and a low base must schedule fewer sessions than offered,
  // and say why — the matrix flattening is the mechanism, the flag is the honesty.
  const asked = Math.max(2, Math.min(7, Math.round(x.target_sessions)));
  const days = Math.max(1, Math.round(x.available_days));
  let sessions = asked;
  if (asked > days && !x.allow_doubles) {
    sessions = days;
    flags.push(
      `You asked for ${asked} sessions across ${days} days. Without doubles that is ${days}.`,
    );
  }

  const matrix_volume = BASE_MATRIX[training_age][Math.max(2, Math.min(7, sessions))];

  // A long run is evidence about the base, so it can only raise it.
  const demonstrated = baseFromLongRun(x.recent?.long_run_km ?? null);
  const running_base = demonstrated && runRank(demonstrated) > runRank(x.running_base)
    ? demonstrated : x.running_base;
  if (running_base !== x.running_base) {
    flags.push(
      `Your ${x.recent!.long_run_km} km long run puts your running above what you called it, so the ceiling comes from the run rather than the description.`,
    );
  }

  /**
   * A recent peak week is evidence; the matrix bracket is a guess.
   *
   * Evidence wins, capped either side — one enormous week inside an otherwise
   * quiet block is a race or a one-off rather than a base to build from.
   */
  const peak_week = x.recent?.peak_week_km ?? null;
  const bracket = peak_week
    ? Math.round(Math.min(peak_week, matrix_volume * PEAK_OVER_BRACKET))
    : matrix_volume;
  if (peak_week && bracket !== matrix_volume) {
    flags.push(
      peak_week > bracket
        ? `Your biggest recent week was ${peak_week} km, but week 1 builds from ${bracket} km — that is as far above your training bracket as one week of evidence carries.`
        : `Week 1 builds from your biggest recent week of ${peak_week} km rather than the ${matrix_volume} km the bracket suggested.`,
    );
  }

  /** What the legs support: the stated base, and the long run behind it. */
  /*
   * A race on the calendar raises the roof.
   *
   * The general-fitness ceiling is the right number for somebody training to be fit and the
   * wrong one for somebody with an entry: it made race day more than half of the biggest
   * week their plan would ever permit.
   */
  const stated_ceiling = x.has_race
    ? RACE_CEILING[running_base] : RUNNING_CEILING[running_base];
  const long_run_ceiling = x.recent?.long_run_km
    ? Math.round(x.recent.long_run_km * LONG_RUN_SHARE) : null;
  const ceiling = stated_ceiling == null ? long_run_ceiling
    : long_run_ceiling == null ? stated_ceiling
    : Math.min(stated_ceiling, long_run_ceiling);

  const capped = ceiling == null ? bracket : Math.min(bracket, ceiling);
  if (ceiling != null && ceiling < bracket) {
    flags.push(
      long_run_ceiling === ceiling
        ? `Week 1 is held at ${capped} km: a ${x.recent!.long_run_km} km longest run does not yet support more than that in a week.`
        : `Week 1 is held at ${capped} km rather than ${bracket} km: your training says one thing and your running says another, and the running wins.`,
    );
  }



  /**
   * No benchmark is not a reason to train less.
   *
   * This used to hold week 1 fifteen per cent under the ceiling whenever no
   * test had been logged. The ceiling is already derived from what the athlete
   * told us about their training and their running, and both of those are
   * answers about what they are doing now — discounting them a second time for
   * the absence of a test penalises not having taken one. A benchmark sharpens
   * the paces; it does not license the volume.
   */
  /**
   * No haircut for not having been measured.
   *
   * The design's generator discounts week 1 by 15%, or 7% where Strava supplied
   * the volume, whenever no benchmark has been run. Removed on instruction, and
   * removed a second time after the intake form reinstated it: everything above
   * this line is already an answer about what the athlete is doing now, and
   * discounting it again for the absence of a test penalises not having taken
   * one. A benchmark sharpens the paces; it does not license the volume.
   */
  /*
   * With no numbers at all, week 1 starts well below the ceiling.
   *
   * An athlete who leaves both volume questions blank has told us there is no weekly
   * volume worth reporting — and the bracket for "runs with walk breaks" is 22 km, which
   * was being used as *both* the start and the ceiling. So a ten-week block came out
   * flat: 22.4, 22.4, 23.3, 23.8, 22.4, 20.1, 20.1, 21.7. Ten weeks of the same week, for
   * somebody whose whole problem is that they have never built up.
   *
   * No evidence means the bracket describes where they could get to, not where they are.
   * Week 1 becomes 60% of it and the ceiling stays put, which is what creates the ramp the
   * block is supposed to be.
   *
   * Only when there is genuinely nothing. One number of their own — measured or typed into
   * the intake — is better evidence than this and is used instead.
   */
  /*
   * And only where the self-report is itself low.
   *
   * An athlete who calls themselves marathon-competitive and skips the volume question
   * has still given evidence — the description is the evidence, and their bracket is a
   * fair reading of it. Somebody who runs with walk breaks and gives no numbers has told
   * us twice that there is nothing to build on, and the bracket for that description is
   * where the block should *end*, not where it starts.
   */
  const NEW_TO_RUNNING: RunningBase[] = ["doesnt_run", "walk_breaks", "5k_nonstop"];
  const blank = NEW_TO_RUNNING.includes(running_base)
    && x.recent?.peak_week_km == null && x.recent?.long_run_km == null;
  const opening = blank ? Math.max(8, capped * 0.6) : capped;
  if (blank) {
    flags.push(
      `You have not given a weekly volume or a longest run, so week 1 starts at ${
        Math.round(opening * 10) / 10} km rather than at the ${Math.round(capped * 10) / 10} km your training history implies, and the block builds towards that instead. Give me either number and it will start where you actually are.`,
    );
  }
  const start_volume = Math.max(3, Math.round(opening * 10) / 10);

  const dial = x.volume_dial ?? 1.0;
  // Not tiered by measurement either, for the same reason: the climb is what
  // the athlete's training and running support, and a test does not change it.
  const base_ramp = Math.min(BASE_RAMP[training_age], RUNNING_RAMP[running_base]) * dial;
  /*
   * A ramp that cannot reach the peak makes the peak a lie.
   *
   * Sarah's block: start 12 km, peak 26.4, ramp 6% a week, six loading weeks after the down
   * week and the taper come out. Six per cent compounded six times reaches 17 — so the
   * plan reported a 26 km peak it had no mechanism to arrive at, and she built from 9 to 16
   * over ten weeks, which is almost no running at all.
   *
   * Two honest options: lower the peak to what the ramp reaches, or raise the ramp to what
   * the block needs. For an athlete with a race entered the second is right up to a limit —
   * the classic ten per cent rule is the limit, and it exists for exactly this reason. So
   * the ramp becomes what the block actually requires, capped at 10% a week and never below
   * what their base supports.
   *
   * Where even 10% cannot get there, the peak comes down to what is reachable and the plan
   * says so, because a number nobody can arrive at is worse than a smaller true one.
   */
  const SAFE_MAX_RAMP = 0.10;


  // Training age sets the peak. Whether a test has been run does not: the same
  // athlete does not become capable of less by declining to be measured.
  const peak_mult = rank(training_age) >= rank("intermediate") ? 2.2 : 1.8;

  /**
   * A block builds on proven volume; it does not double it.
   *
   * The multiplier above was calibrated against a conservative matrix start.
   * Anchoring the start to real recent volume makes it over-deliver — 40 km a
   * week becomes an 88 km peak, which is not a plan. Sixty per cent above the
   * highest week the athlete has actually done is the ceiling, and it only
   * binds when there is a real week to measure it against.
   */
  const raw_peak = start_volume * peak_mult;
  // Against the biggest week they have actually done, not the typical one:
  // "proven" means the most they have completed, and an athlete whose weeks
  // swing between 20 and 38 km has proven 38.
  const proven = peak_week;
  const proven_cap = proven != null ? proven * PROVEN_HEADROOM : Infinity;
  let peak_ceiling = Math.round(Math.min(raw_peak, proven_cap) * 10) / 10;

  /*
   * Now reconcile the ramp with the peak, because one of them is wrong.
   *
   * A down week every fourth and a two-week taper leave roughly this many weeks that
   * actually load. If the ramp cannot reach the peak across them, the plan has been
   * promising a number it has no mechanism to arrive at.
   */
  const weeks = x.block_weeks ?? 12;
  const loading = Math.max(1, weeks - 2 - Math.floor(weeks / 4));
  const needed = Math.pow(peak_ceiling / Math.max(1, start_volume), 1 / loading) - 1;
  let ramp_rate = base_ramp;
  if (needed > base_ramp) {
    // Up to the ten per cent rule, which exists for precisely this situation.
    ramp_rate = Math.min(SAFE_MAX_RAMP, needed);
    if (needed > SAFE_MAX_RAMP) {
      /*
       * Even at 10% the peak is out of reach, so the peak comes down rather than the ramp
       * going up. A number nobody can arrive at is worse than a smaller true one.
       */
      const reachable = Math.round(start_volume * Math.pow(1 + SAFE_MAX_RAMP, loading) * 10) / 10;
      flags.push(
        `The block peaks at ${reachable} km rather than ${peak_ceiling} km: from ${
          start_volume} km, ${loading} loading weeks at the safe limit of 10% a week is as far as it reaches. More than that needs a longer block, not a steeper one.`,
      );
      peak_ceiling = reachable;
    } else {
      flags.push(
        `Volume climbs ${Math.round(ramp_rate * 100)}% a week rather than ${
          Math.round(base_ramp * 100)}%: that is what it takes to reach ${peak_ceiling} km from ${
          start_volume} km in ${loading} loading weeks, and it stays inside the 10% rule.`,
      );
    }
  }
  if (proven_cap < raw_peak) {
    flags.push(
      `The block peaks at ${peak_ceiling} km rather than ${Math.round(raw_peak * 10) / 10} km: that is ${Math.round((PROVEN_HEADROOM - 1) * 100)}% above your biggest recent week of ${Math.round(proven! * 10) / 10} km, and building further than that inside one block is where people get hurt.`,
    );
  }

  return {
    training_age,
    start_volume,
    ramp_rate,
    peak_ceiling,
    max_block: MAX_BLOCK[training_age],
    max_hard: MAX_HARD[training_age],
    matrix_volume, ceiling, sessions, flags,
  };
}

/** How far above a proven week a single block is allowed to build. */
export const PROVEN_HEADROOM = 1.6;

