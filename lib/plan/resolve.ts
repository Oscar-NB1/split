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
export const RUNNING_CEILING: Record<RunningBase, number | null> = {
  doesnt_run: 8,
  walk_breaks: 15,
  "5k_nonstop": 22,
  runs_regularly: 32,
  half_marathon_fit: 45,
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
  /** the typical week — what the block starts from */
  weekly_km: number | null;
  /** the biggest week they have actually completed — what the peak builds on */
  peak_week_km?: number | null;
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
 * The most a week can plausibly be, given the longest run in it.
 *
 * A long run is normally a quarter to a third of the week, so a claimed 60 km
 * week behind a 5 km longest run is a mistyped answer rather than a training
 * history. Four times the long run is the generous end of that, and it only
 * ever trims a reported number — never a measured one, where the arithmetic is
 * already the athlete's own.
 */
export const LONG_RUN_SHARE = 4;

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

  const ceiling = RUNNING_CEILING[running_base];
  const capped = ceiling == null ? matrix_volume : Math.min(matrix_volume, ceiling);
  if (ceiling != null && ceiling < matrix_volume) {
    flags.push(
      `Week 1 is held at ${capped} km rather than ${matrix_volume} km: your training says one thing and your running says another, and the running wins.`,
    );
  }

  /**
   * What they are already running beats what the matrix guessed.
   *
   * The matrix reads adjectives; a recent weekly figure is the thing itself.
   * Starting below where someone already is spends the first weeks of a block
   * detraining them, which is the more common failure of the two.
   */
  const recent = plausibleRecent(x.recent ?? null, flags);

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
  const start_volume = Math.max(3, Math.round((recent ?? capped) * 10) / 10);
  if (recent != null && Math.abs(recent - capped) >= 1) {
    flags.push(
      recent > capped
        ? `Week 1 starts at ${Math.round(recent * 10) / 10} km, not the ${capped} km the matrix suggested — you are already running that, and a block that starts under you is a block spent catching up.`
        : `Week 1 starts at ${Math.round(recent * 10) / 10} km rather than ${capped} km, because that is where your running actually is right now.`,
    );
  }

  const dial = x.volume_dial ?? 1.0;
  const ramp_rate = Math.min(BASE_RAMP[training_age], RUNNING_RAMP[x.running_base]) * dial;

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
  const proven = x.recent?.peak_week_km ?? recent;
  const proven_cap = proven != null ? proven * PROVEN_HEADROOM : Infinity;
  const peak_ceiling = Math.round(Math.min(raw_peak, proven_cap) * 10) / 10;
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

/**
 * A recent weekly figure, sanity-checked against the long run behind it.
 *
 * Only reported numbers are trimmed. A measured one is the athlete's own
 * arithmetic over their own files, and second-guessing it here would mean
 * disbelieving a record in favour of a rule of thumb.
 */
function plausibleRecent(
  recent: RecentRunning | null, flags: string[],
): number | null {
  const weekly = recent?.weekly_km;
  if (!recent || !weekly || weekly <= 0) return null;
  const long = recent.long_run_km;
  if (recent.source === "measured" || !long || long <= 0) return weekly;

  const most = long * LONG_RUN_SHARE;
  if (weekly <= most) return weekly;
  flags.push(
    `You put ${weekly} km a week behind a ${long} km long run. A long run is usually a quarter to a third of the week, so week 1 is built from ${Math.round(most * 10) / 10} km — correct either number and it moves.`,
  );
  return most;
}
