import { diffDays } from "./dates";

/**
 * What an athlete tells us, and what it resolves to.
 *
 * This file holds the answers and the tables that read them. The block itself is
 * built in lib/generate.ts.
 *
 * The governing rule: every number in a plan traces to a stated answer. Asked to
 * give the second athlete a plan, I once wrote one — a starting volume, a
 * progression, a race, session notes — none of which came from her. It read as
 * authoritative and was invented. Where an answer is missing, the plan says so.
 */

// ---------------------------------------------------------------- the answers

/** How long they have been training *anything* consistently. */
export const TRAINING_BASE = ["under_6mo", "6_12mo", "over_1yr", "competitive"] as const;

/**
 * How much they can run, which is a different question and the important one.
 *
 * Asking only about training base is a real bug with a real consequence: someone a
 * year into consistent training who still runs with walk breaks reads as
 * experienced and gets prescribed 30 km in week 1, when they cannot yet run 5 km
 * without stopping. Aerobic capacity running ahead of connective-tissue tolerance
 * is the classic injury pattern, because they will feel able to do more than their
 * legs can absorb.
 */
export const RUNNING_SELF = ["doesnt_run", "walk_breaks", "5k_nonstop", "runs_regularly"] as const;

export const GOAL_KIND = [
  "hyrox", "hyrox_doubles", "race_5k", "race_10k", "half", "general",
] as const;

/** Who carries what in a doubles pair. Changes the plan, not just the race day. */
export const PARTNER_ROLE = ["protected", "even", "lead"] as const;

/**
 * The division they are actually entered in.
 *
 * Asked, never derived. There is no sex field in this intake and no rule that
 * turns one into a set of weights: what an athlete trains toward is the load they
 * will meet on the floor of the field they entered, and a woman racing mixed
 * doubles pushes the mixed doubles sled whatever a sex-by-division table would
 * have inferred for her.
 */
export const DIVISION = [
  "womens_open", "mens_open", "womens_pro", "mens_pro",
  "womens_doubles", "mens_doubles", "mixed_doubles",
  "relay", "unknown",
] as const;

export const SLED_EXPERIENCE = ["never", "lighter", "race_weight"] as const;

export const GYM_ACCESS = ["none", "home", "basic_gym", "full_gym", "hyrox_gym"] as const;

/** The kit that changes what can be programmed, not everything in a gym. */
export const EQUIPMENT = [
  "sled", "skierg", "rower", "wall_ball", "sandbag", "kettlebell",
  "barbell", "pull_up_bar", "dumbbells", "treadmill",
] as const;

/**
 * Standing commitments that are not this plan — a weekly class, a team sport.
 *
 * Stored as what the athlete says they do; classified in COMMITMENT below. Keeping
 * the classification in code rather than in the row means the table can be
 * corrected without making anyone retake the intake.
 */
export const COMMITMENT_KIND = [
  "spin", "cycling", "swimming", "yoga", "pilates", "climbing",
  "team_sport", "martial_arts", "crossfit", "other",
] as const;

export type TrainingBase = (typeof TRAINING_BASE)[number];
export type RunningSelf = (typeof RUNNING_SELF)[number];
export type GoalKind = (typeof GOAL_KIND)[number];
export type PartnerRole = (typeof PARTNER_ROLE)[number];
export type Division = (typeof DIVISION)[number];
export type SledExperience = (typeof SLED_EXPERIENCE)[number];
export type GymAccess = (typeof GYM_ACCESS)[number];
export type Equipment = (typeof EQUIPMENT)[number];
export type CommitmentKind = (typeof COMMITMENT_KIND)[number];

export type Commitment = {
  kind: CommitmentKind;
  /** what they call it — "Rocycle" */
  name: string;
  /** 0 = Monday, or null if it moves around */
  day: number | null;
  per_week: number;
};

export type Intake = {
  training_base: TrainingBase;
  running_self: RunningSelf;
  current_km_week: number | null;
  longest_run_km: number | null;
  recent_5k_seconds: number | null;

  goal_kind: GoalKind;
  goal_race_name: string | null;
  goal_date: string | null;
  goal_time_seconds: number | null;
  division: Division;
  partner_role: PartnerRole | null;

  days_per_week: number;
  /** 0 = Monday. */
  preferred_days: number[];
  long_run_day: number | null;
  commitments: Commitment[];

  gym_access: GymAccess;
  equipment: Equipment[];
  sled_experience: SledExperience;

  injuries: string | null;
  constraints_note: string | null;
};

// --------------------------------------------------------------- the two caps

/**
 * Starting weekly volume from training base alone.
 *
 * This is the number that was wrong on its own. It is now only ever half the
 * answer — see `startVolume`.
 */
export const BASE_VOLUME: Record<TrainingBase, number> = {
  under_6mo: 12,
  "6_12mo": 20,
  over_1yr: 30,
  competitive: 40,
};

/**
 * The ceiling their running actually supports, whatever their training says.
 *
 * A hard cap, not an average: someone who runs with walk breaks does not start at
 * 30 km because they are otherwise fit.
 */
export const RUNNING_CEILING: Record<RunningSelf, number | null> = {
  doesnt_run: 8,
  walk_breaks: 15,
  "5k_nonstop": 22,
  runs_regularly: null, // no cap; their stated weekly volume governs
};

/** Weekly increase from training base. */
export const BASE_RAMP: Record<TrainingBase, number> = {
  under_6mo: 0.06,
  "6_12mo": 0.08,
  over_1yr: 0.10,
  competitive: 0.12,
};

/** And the ramp their running tissue supports. The lower of the two wins. */
export const RUNNING_RAMP: Record<RunningSelf, number> = {
  doesnt_run: 0.06,
  walk_breaks: 0.08,
  "5k_nonstop": 0.10,
  runs_regularly: 0.12,
};

/**
 * Week 1's volume: the lower of what they train like and what they run like.
 *
 * `current_km_week` caps it further when given — a stated number beats an inferred
 * one, always, and someone who says they run 10 km a week should not be handed 15
 * because a table thinks they could.
 */
export function startVolume(x: Intake): number {
  const ceiling = RUNNING_CEILING[x.running_self];
  const inferred = ceiling == null
    ? BASE_VOLUME[x.training_base]
    : Math.min(BASE_VOLUME[x.training_base], ceiling);
  const stated = x.current_km_week;
  return Math.max(4, Math.round(stated != null && stated > 0 ? Math.min(stated, inferred) : inferred));
}

/** The ramp: the lower of the two, for the same reason. */
export const rampRate = (x: Intake) =>
  Math.min(BASE_RAMP[x.training_base], RUNNING_RAMP[x.running_self]);

// ------------------------------------------------------------------ the split

export type Allocation = { run: number; station: number; strength: number };

/**
 * How the week divides, by role in the pair.
 *
 * `protected` is from the plan spec: the partner takes the sled, the lunges and
 * most of the burpees; the protected athlete sets the run pace and takes ski and
 * row metres, so their plan is weighted to running.
 *
 * `lead` and `even` are the mirror and the midpoint. They have NOT been confirmed
 * against a plan document — only `protected` has — and are the first thing to
 * correct if a lead athlete's block looks wrong.
 */
export const ALLOCATION: Record<PartnerRole, Allocation> = {
  protected: { run: 0.60, station: 0.25, strength: 0.15 },
  even: { run: 0.50, station: 0.30, strength: 0.20 },
  lead: { run: 0.45, station: 0.30, strength: 0.25 },
};

/** Singles carry every station themselves, so the split is not a doubles split. */
export const SOLO_ALLOCATION: Allocation = { run: 0.50, station: 0.30, strength: 0.20 };

export const allocationFor = (x: Intake): Allocation =>
  x.goal_kind === "hyrox_doubles" && x.partner_role
    ? ALLOCATION[x.partner_role]
    : SOLO_ALLOCATION;

// ------------------------------------------------------------- commitments

export type Classification = {
  /** how much of it transfers to the goal */
  transfer: "none" | "partial" | "high";
  /** what it costs the legs, which is what constrains placement */
  leg_cost: "low" | "medium" | "high";
  /** what one session counts as, against aerobic volume */
  volume_multiplier: number;
  why: string;
};

/**
 * What a standing commitment actually costs.
 *
 * A spin class is not steady cycling: high cadence, interval structure,
 * uncontrolled intensity, quads cooked. It counts at 0.3× aerobic volume and it
 * cannot sit the day before a key session — which is a placement rule, not a
 * volume one, and is the part a simple "cross-training" category would lose.
 */
export const COMMITMENT: Record<CommitmentKind, Classification> = {
  spin: {
    transfer: "partial", leg_cost: "high", volume_multiplier: 0.3,
    why: "High cadence, interval structure, uncontrolled intensity. The quads pay for it.",
  },
  cycling: {
    transfer: "partial", leg_cost: "medium", volume_multiplier: 0.4,
    why: "Steady aerobic work, but it does not load the running tissue.",
  },
  swimming: {
    transfer: "partial", leg_cost: "low", volume_multiplier: 0.4,
    why: "Aerobic with almost no leg cost — the cheapest volume there is.",
  },
  yoga: {
    transfer: "none", leg_cost: "low", volume_multiplier: 0,
    why: "Not aerobic volume. Costs nothing and can sit anywhere.",
  },
  pilates: {
    transfer: "none", leg_cost: "low", volume_multiplier: 0,
    why: "Not aerobic volume. Costs nothing and can sit anywhere.",
  },
  climbing: {
    transfer: "none", leg_cost: "medium", volume_multiplier: 0,
    why: "Upper body and grip. Grip matters for carries; the legs still pay a little.",
  },
  team_sport: {
    transfer: "partial", leg_cost: "high", volume_multiplier: 0.3,
    why: "Sprints, changes of direction and no control over the intensity.",
  },
  martial_arts: {
    transfer: "partial", leg_cost: "high", volume_multiplier: 0.3,
    why: "Aerobic, but rounds are hard days whether or not they are planned as hard days.",
  },
  crossfit: {
    transfer: "high", leg_cost: "high", volume_multiplier: 0.4,
    why: "Closest thing to station work, and the most likely to become a third hard day.",
  },
  other: {
    transfer: "partial", leg_cost: "medium", volume_multiplier: 0.2,
    why: "Unclassified, so counted conservatively.",
  },
};

/** A day that must stay easy because a commitment already spends it. */
export function heavyDays(x: Intake): number[] {
  return x.commitments
    .filter((c) => c.day != null && COMMITMENT[c.kind]?.leg_cost === "high")
    .map((c) => c.day as number);
}

/** Aerobic volume a week's commitments contribute, in kilometre-equivalents. */
export function commitmentVolume(x: Intake, weeklyKm: number): number {
  return x.commitments.reduce(
    (n, c) => n + COMMITMENT[c.kind].volume_multiplier * c.per_week * (weeklyKm / 3),
    0,
  );
}

// -------------------------------------------------------------- the standards

/**
 * The race itself: distances and reps that do not vary by division.
 */
export const RACE_SHAPE = {
  runs: 8, run_m: 1000,
  ski_m: 1000, row_m: 1000,
  /** 2 x 25 m, both sleds. */
  sled_push_m: 50, sled_pull_m: 50,
  burpee_broad_jump_m: 80,
  farmers_m: 200, lunge_m: 100,
  wall_balls: 100,
} as const;

/**
 * What each station weighs, by division.
 *
 * Transcribed from the official standards table. Sled weights are given both ways
 * because both are quoted and confusing them is a 52 kg error: `_kg` is the weight
 * added to the sled, `_total_kg` includes the sled itself, which is what a gym's
 * sled actually has to be loaded to.
 *
 * Target height is not tracked. It does not vary in a way that changes what gets
 * programmed, and a session prescribes a weight and a rep count.
 */
export type Standards = {
  sled_push_kg: number; sled_push_total_kg: number;
  sled_pull_kg: number; sled_pull_total_kg: number;
  farmers_kg: number;   // per hand
  lunge_kg: number;
  wall_ball_kg: number;
};

const MENS_OPEN: Standards = {
  sled_push_kg: 100, sled_push_total_kg: 152,
  sled_pull_kg: 50, sled_pull_total_kg: 103,
  farmers_kg: 24, lunge_kg: 20, wall_ball_kg: 6,
};

export const STANDARDS: Partial<Record<Division, Standards>> = {
  womens_open: {
    sled_push_kg: 50, sled_push_total_kg: 102,
    sled_pull_kg: 25, sled_pull_total_kg: 78,
    farmers_kg: 16, lunge_kg: 10, wall_ball_kg: 4,
  },
  womens_pro: {
    sled_push_kg: 100, sled_push_total_kg: 152,
    sled_pull_kg: 50, sled_pull_total_kg: 103,
    farmers_kg: 24, lunge_kg: 20, wall_ball_kg: 6,
  },
  mens_open: MENS_OPEN,
  mens_pro: {
    sled_push_kg: 150, sled_push_total_kg: 202,
    sled_pull_kg: 100, sled_pull_total_kg: 153,
    farmers_kg: 32, lunge_kg: 30, wall_ball_kg: 9,
  },
  // Confirmed as men's open weights, not inferred from them. Shared by reference
  // so the two can never drift apart in an edit.
  mixed_doubles: MENS_OPEN,
};

/**
 * Divisions we do not have confirmed loads for.
 *
 * Listed because people enter them, not filled in because nobody has supplied the
 * numbers. They fall back to a share of race weight and say so — which is a worse
 * plan than one with real kilos, and a much better one than a plan carrying a
 * weight somebody guessed.
 */
export const UNLOADED_DIVISIONS: Division[] = ["womens_doubles", "mens_doubles", "relay", "unknown"];

export const standardsFor = (x: Intake): Standards | null => STANDARDS[x.division] ?? null;


export const needsStandards = (x: Intake) =>
  isHyrox(x.goal_kind) && standardsFor(x) === null;

export const isHyrox = (k: GoalKind) => k === "hyrox" || k === "hyrox_doubles";

export const GOAL_LABEL: Record<GoalKind, string> = {
  hyrox: "Hyrox",
  hyrox_doubles: "Hyrox doubles",
  race_5k: "5K",
  race_10k: "10K",
  half: "Half marathon",
  general: "General fitness",
};

// ------------------------------------------------------------------ validation

export type Problem = { field: keyof Intake; why: string };

/** Injected in tests; the real one is today(). */
let clock = () => new Date().toISOString().slice(0, 10);
export const setClock = (fn: () => string) => { clock = fn; };
export const todayish = () => clock();

/**
 * What has to be true before a block can be built.
 *
 * Bounds rather than opinions: they exist to stop a typo becoming a plan, not to
 * tell anyone their goal is wrong. A 400 km week is a slipped decimal point.
 */
export function validate(x: Partial<Intake>): Problem[] {
  const p: Problem[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const need = <T,>(v: unknown, list: readonly T[], field: keyof Intake, why: string) => {
    if (!list.includes(v as T)) p.push({ field, why });
  };

  need(x.training_base, TRAINING_BASE, "training_base", "How long have you been training consistently?");
  need(x.running_self, RUNNING_SELF, "running_self", "How much can you run right now?");
  need(x.goal_kind, GOAL_KIND, "goal_kind", "Pick what you are training for.");
  need(x.gym_access, GYM_ACCESS, "gym_access", "Pick what you have access to.");
  need(x.division, DIVISION, "division", "Pick your division — it sets the station weights.");
  need(x.sled_experience, SLED_EXPERIENCE, "sled_experience", "Have you used a sled before?");

  if (x.goal_kind === "hyrox_doubles" && !PARTNER_ROLE.includes(x.partner_role as PartnerRole)) {
    p.push({ field: "partner_role", why: "In a pair, who carries what? It changes the whole plan." });
  }

  const km = num(x.current_km_week);
  if (km !== null && (km < 0 || km > 250)) {
    p.push({ field: "current_km_week", why: "Weekly kilometres, somewhere between 0 and 250." });
  }
  const longest = num(x.longest_run_km);
  if (longest !== null && (longest < 0 || longest > 100)) {
    p.push({ field: "longest_run_km", why: "Your longest recent run, in kilometres." });
  }
  if (km !== null && longest !== null && km > 0 && longest > km) {
    p.push({ field: "longest_run_km", why: "That is longer than your whole week. Check both numbers." });
  }

  const days = num(x.days_per_week);
  if (days === null || days < 2 || days > 7) {
    p.push({ field: "days_per_week", why: "Between 2 and 7 days a week." });
  }
  if (days !== null && (x.preferred_days?.length ?? 0) > 0 && (x.preferred_days?.length ?? 0) < days) {
    p.push({ field: "preferred_days", why: `Pick at least ${days} days, or leave it blank.` });
  }

  if (x.goal_date) {
    const away = diffDays(x.goal_date, todayish());
    if (away < 14) p.push({ field: "goal_date", why: "A block needs at least a fortnight." });
    if (away > 500) p.push({ field: "goal_date", why: "That is more than a year out." });
  }
  const t = num(x.goal_time_seconds);
  if (t !== null && (t < 600 || t > 6 * 3600)) {
    p.push({ field: "goal_time_seconds", why: "Between ten minutes and six hours." });
  }

  for (const c of x.commitments ?? []) {
    if (!COMMITMENT_KIND.includes(c.kind)) {
      p.push({ field: "commitments", why: `"${c.name || c.kind}" is not a kind we classify.` });
      break;
    }
    if (c.per_week < 1 || c.per_week > 7) {
      p.push({ field: "commitments", why: `How many times a week is ${c.name || c.kind}?` });
      break;
    }
  }
  return p;
}
