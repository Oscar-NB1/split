import { diffDays } from "./dates";

/**
 * What an athlete tells us, and what it resolves to.
 *
 * The answers, their option lists, and every table that reads them. The block
 * itself is built in lib/generate.ts.
 *
 * This mirrors the intake in the design question for question and value for
 * value — the labels here are the strings the screens send, not an internal
 * enum, so there is no translation layer to drift out of step. The governing
 * rule is unchanged: every number in a plan traces to a stated answer, and where
 * an answer is missing the plan says so rather than filling the gap.
 */

// ---------------------------------------------------------------- the answers

export const HAS_RACE = ["Yes", "No"] as const;

export const DISCIPLINE = [
  "Hyrox doubles", "Hyrox singles", "Running race", "General fitness",
] as const;

export const RACE_DISTANCE = ["5 km", "10 km", "Half marathon", "Marathon"] as const;

/** Doubles is not an even split, and which side you are on changes the block. */
export const ROLE = ["Protected", "Engine", "Even split"] as const;

export const DIVISION_SOLO = [
  "Women · open", "Women · pro", "Men · open", "Men · pro",
] as const;

/** Doubles divisions, which is a different list rather than a modifier. */
export const DIVISION_DOUBLES = [
  "Mixed doubles",
  "Women’s doubles · open", "Women’s doubles · pro",
  "Men’s doubles · open", "Men’s doubles · pro",
] as const;

export const DIVISION = [...DIVISION_SOLO, ...DIVISION_DOUBLES] as const;

export const BASE = [
  "Under 3 months", "3 to 12 months", "Over a year", "Several years",
] as const;

/**
 * How much they can run, which is a different question from how long they have
 * trained, and the one that governs.
 *
 * Someone a year into consistent training who still runs with walk breaks reads
 * as experienced and would be prescribed 30 km in week 1, when they cannot yet
 * run 5 km without stopping. Aerobic fitness runs ahead of connective tissue,
 * which is exactly how people get hurt in week 3.
 */
export const RUNNING_SELF = [
  "I do not run", "Runs with walk breaks", "5 km nonstop", "Runs regularly",
  "Half marathon fit", "Marathon runner", "Competitive",
] as const;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const COMMITMENTS = [
  "Spin class", "Kickboxing", "Football", "Padel", "Climbing", "Nothing fixed",
] as const;

/**
 * Kit, as the reworked form lists it.
 *
 * Two sleds rather than one: training on a lighter sled is not the same access
 * as race weight, and it is the single most common place a first race falls
 * apart, so the answer has to be able to say which.
 */
export const EQUIPMENT = [
  "Sled — race weight", "Sled — lighter only", "SkiErg", "Rower", "Wall balls",
  "Sandbag", "Kettlebells", "Barbell", "Rig or pull-up bar", "Burpee floor space",
  "Treadmill", "Indoor track", "Run from the door",
] as const;

/** A running block asks a different equipment question. */
export const EQUIPMENT_RUNNING = ["Treadmill only", "Track", "Trails", "Gym", "Barbell"] as const;

export const SLED = [
  "Never used one", "Used a lighter sled",
  "Race weight, short distances", "Race weight and distance",
] as const;

export const VOLUME_PREF = ["Conservative", "Progressive", "Aggressive"] as const;
export const DIFFICULTY = ["Steady", "Challenging", "Hard"] as const;

/** Where the benchmark got to. `logged` is the only one that lifts the caps. */
export const BENCHMARK = ["offered", "scheduled", "skipped", "logged"] as const;

export type HasRace = (typeof HAS_RACE)[number];
export type Discipline = (typeof DISCIPLINE)[number];
export type RaceDistance = (typeof RACE_DISTANCE)[number];
export type Role = (typeof ROLE)[number];
export type Division = (typeof DIVISION)[number];
export type Base = (typeof BASE)[number];
export type RunningSelf = (typeof RUNNING_SELF)[number];
export type Day = (typeof DAYS)[number];
export type CommitmentName = (typeof COMMITMENTS)[number];
export type Equipment = (typeof EQUIPMENT)[number] | (typeof EQUIPMENT_RUNNING)[number];
export type Sled = (typeof SLED)[number];
export type VolumePref = (typeof VOLUME_PREF)[number];
export type Difficulty = (typeof DIFFICULTY)[number];
export type BenchmarkState = (typeof BENCHMARK)[number];

export type Intake = {
  hasRace: HasRace;
  discipline: Discipline;
  raceDistance: RaceDistance | null;
  raceDate: string | null;
  role: Role | null;
  division: Division | null;
  base: Base;
  runningSelf: RunningSelf;
  /** Current 5 km, as minutes and seconds. */
  paceMin: number | null;
  paceSec: number | null;
  paceUnknown: boolean;
  /**
   * What they have actually been running lately, which beats every adjective
   * above it.
   *
   * The biggest week of the last four is what week 1 is built from; the longest
   * run of the last eight caps where the long run starts and how fast it grows.
   * Both are optional — not everyone tracks, and refusing to build a plan
   * without them would be worse than the bracket guess they replace.
   */
  peakWeekKm: number | null;
  longestRunKm: number | null;
  /** The steps the reworked form added. All nullable: an intake saved before
   *  they existed is still a valid intake, and the generator has defaults. */
  goal: string | null;
  goalMin: number | null;
  startDate: string | null;
  targetSessions: string | null;
  allowDoubles: string | null;
  wantRestDay: string | null;
  sessionPref: string | null;
  hyroxExp: string | null;
  runDelta: string | null;
  stationDelta: string | null;
  /** how freely the kit can be used, which gates compromised running */
  gymAccess: string | null;
  /**
   * Races already run, typed in.
   *
   * Kept as answers rather than normalised: they are what the athlete told us,
   * and the race planner reads the most recent one for its roxzone — the one
   * number nothing in training measures.
   */
  pastRaces: {
    event: string; division: string | null; finish: string;
    run_avg: string; stations: string; rox: string;
  }[];
  /** where those two came from — "strava" halves the unmeasured haircut */
  volumeSource: "strava" | "self" | null;
  days: Day[];
  commitments: CommitmentName[];
  /** how many times a week each one happens */
  freq: Record<string, number>;
  /** the days it is fixed to, if any */
  commitDay: Record<string, Day[]>;
  equipment: Equipment[];
  sled: Sled | null;
  injuries: string | null;
  volume: VolumePref;
  difficulty: Difficulty;
  benchmark: BenchmarkState;
};

export const isDoubles = (d: Discipline) => d.includes("doubles");
export const isHyrox = (d: Discipline) => d.startsWith("Hyrox");

/**
 * Which questions this athlete is actually asked.
 *
 * Shared with the screens so the form and the validator cannot disagree about
 * whether a question was ever put — demanding a division from a marathon runner
 * makes the form impossible to complete rather than safe.
 */
export function liveQuestions(x: Pick<Intake, "discipline" | "hasRace">): string[] {
  const all = [
    "hasRace", "discipline", "raceDistance", "raceDate", "role", "division",
    "base", "runningSelf", "pace", "days", "commitments", "equipment", "sled",
    "injuries", "prefs",
  ];
  return all.filter((id) => {
    if (id === "role") return isDoubles(x.discipline);
    if (id === "raceDistance") return x.discipline === "Running race";
    if (id === "division" || id === "sled") return isHyrox(x.discipline);
    if (id === "raceDate") return x.hasRace === "Yes";
    return true;
  });
}

export const divisionsFor = (d: Discipline): readonly string[] =>
  isDoubles(d) ? DIVISION_DOUBLES : DIVISION_SOLO;

export const equipmentFor = (d: Discipline): readonly string[] =>
  d === "Running race" ? EQUIPMENT_RUNNING : EQUIPMENT;

// --------------------------------------------------------------- the two caps

/** Weekly volume the training history alone points at. */
export const BASE_KM: Record<Base, number> = {
  "Under 3 months": 12,
  "3 to 12 months": 20,
  "Over a year": 30,
  "Several years": 38,
};

/** The ceiling their running actually supports, whatever their training says. */
export const RUN_CEIL: Record<RunningSelf, number> = {
  "I do not run": 8,
  "Runs with walk breaks": 15,
  "5 km nonstop": 22,
  "Runs regularly": 34,
  "Half marathon fit": 48,
  "Marathon runner": 70,
  Competitive: 999,
};

/** And the weekly climb their running tissue supports, as a percentage. */
export const RUN_RAMP: Record<RunningSelf, number> = {
  "I do not run": 6,
  "Runs with walk breaks": 8,
  "5 km nonstop": 9,
  "Runs regularly": 10,
  "Half marathon fit": 10,
  "Marathon runner": 12,
  Competitive: 12,
};

/** run / station / strength, as percentages of the week. */
export const ALLOC: Record<Role, [number, number, number]> = {
  Protected: [60, 25, 15],
  Engine: [45, 35, 20],
  "Even split": [50, 30, 20],
};

/** The disciplines that are not a doubles pair have their own split. */
export const ALLOC_SOLO: Record<string, [number, number, number]> = {
  "Hyrox singles": [45, 35, 20],
  "Running race": [80, 0, 20],
  "General fitness": [65, 10, 25],
};

/**
 * The week's split, as a copy.
 *
 * Returning the row itself hands out a live reference into ALLOC, so anything
 * that adjusts the result — and adjusting it is the obvious next thing to do
 * with it — permanently rewrites the table for every athlete after it. The
 * symptom is a split that drifts a little on each render and never comes back.
 */
export const allocationFor = (x: Intake): [number, number, number] => {
  const row = isDoubles(x.discipline)
    ? ALLOC[x.role ?? "Even split"] ?? [50, 30, 20]
    : ALLOC_SOLO[x.discipline] ?? [50, 30, 20];
  return [...row] as [number, number, number];
};

// ------------------------------------------------------------- the benchmark

/**
 * The benchmark: four rounds of 400 m plus a station.
 *
 * Variants exist so the test is never a gate. Someone with no equipment, or
 * someone the safety gate has flagged, still gets a benchmark — a smaller one —
 * rather than being told to come back when they own a sled.
 */
export const BENCH_VARIANTS = {
  full: {
    label: "Full", kit: "Hyrox gym",
    stations: ["Ski erg 200 m", "Burpee broad jump 15 m", "Wall balls ×15", "Sled push 12.5 m"],
  },
  gym: {
    label: "Gym", kit: "Normal gym",
    stations: ["Row 200 m", "Burpee broad jump 15 m", "Wall balls ×15", "Heavy carry 25 m"],
  },
  field: {
    label: "Field", kit: "No equipment",
    stations: ["30 burpees", "Bounding 15 m", "30 burpees", "Bounding 15 m"],
  },
  submax: {
    label: "Submaximal", kit: "RPE 7, three rounds",
    stations: ["Ski erg 200 m", "Burpee broad jump 15 m", "Wall balls ×15"],
  },
} as const;

export type BenchVariant = keyof typeof BENCH_VARIANTS;

// -------------------------------------------------------------- the standards

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
 * Sled weights are stored both ways because both are quoted and confusing them
 * is a 52 kg error: `_kg` is the weight added to the sled, `_total_kg` includes
 * the sled itself, which is what a gym's sled has to be loaded to.
 */
export type Standards = {
  sled_push_kg: number; sled_push_total_kg: number;
  sled_pull_kg: number; sled_pull_total_kg: number;
  farmers_kg: number;   // per hand
  lunge_kg: number;
  wall_ball_kg: number;
};

const WOMENS_OPEN: Standards = {
  sled_push_kg: 50, sled_push_total_kg: 102,
  sled_pull_kg: 25, sled_pull_total_kg: 78,
  farmers_kg: 16, lunge_kg: 10, wall_ball_kg: 4,
};
const MENS_OPEN: Standards = {
  sled_push_kg: 100, sled_push_total_kg: 152,
  sled_pull_kg: 50, sled_pull_total_kg: 103,
  farmers_kg: 24, lunge_kg: 20, wall_ball_kg: 6,
};
const MENS_PRO: Standards = {
  sled_push_kg: 150, sled_push_total_kg: 202,
  sled_pull_kg: 100, sled_pull_total_kg: 153,
  farmers_kg: 32, lunge_kg: 30, wall_ball_kg: 9,
};

/**
 * The division they entered sets the load. Asked, never derived.
 *
 * There is no sex field in this intake and no rule that turns one into a set of
 * weights: a woman racing mixed doubles pushes the mixed doubles sled, which is
 * the men's open load, whatever a sex-by-division table would have inferred.
 *
 * Women's pro and men's open are the same weights on every station — an identity
 * that reads like a copy-paste mistake until it is asserted, so a test does.
 */
/**
 * A doubles division carries its singles equivalent's loads — the pair share the
 * work, not a lighter sled. Mixed doubles is the exception and is men's open.
 *
 * Every value is shared by reference rather than copied, so a correction to one
 * row cannot leave its doubles twin behind. And the type is a full Record rather
 * than a Partial: adding a division without loads is a compile error, not a
 * silent fall back to percentages that nobody notices until race day.
 */
export const STANDARDS: Record<Division, Standards> = {
  "Women · open": WOMENS_OPEN,
  "Women · pro": MENS_OPEN,
  "Men · open": MENS_OPEN,
  "Men · pro": MENS_PRO,
  "Women’s doubles · open": WOMENS_OPEN,
  "Women’s doubles · pro": MENS_OPEN,
  "Men’s doubles · open": MENS_OPEN,
  "Men’s doubles · pro": MENS_PRO,
  "Mixed doubles": MENS_OPEN,
};

export const standardsFor = (x: Intake): Standards | null =>
  x.division ? STANDARDS[x.division] : null;

/** True only before a division has been picked: every division has loads. */
export const needsStandards = (x: Intake) =>
  isHyrox(x.discipline) && standardsFor(x) === null;

// --------------------------------------------------------------- commitments

export type Classification = {
  transfer: "none" | "partial" | "high";
  leg_cost: "low" | "medium" | "high";
  volume_multiplier: number;
  why: string;
};

/**
 * What a standing commitment actually costs.
 *
 * A spin class is not steady cycling: high cadence, interval structure,
 * uncontrolled intensity, quads cooked. It counts at 0.3x aerobic volume — and
 * more usefully it is a *placement* rule, because the day after it is where an
 * easy run belongs and a key session does not.
 */
export const COMMITMENT: Record<string, Classification> = {
  "Spin class": {
    transfer: "partial", leg_cost: "high", volume_multiplier: 0.3,
    why: "High cadence, interval structure, uncontrolled intensity. The quads pay for it.",
  },
  Kickboxing: {
    transfer: "partial", leg_cost: "high", volume_multiplier: 0.3,
    why: "Aerobic, but rounds are hard days whether or not they are planned as hard days.",
  },
  Football: {
    transfer: "partial", leg_cost: "high", volume_multiplier: 0.3,
    why: "Sprints, changes of direction, and no control over the intensity.",
  },
  Padel: {
    transfer: "partial", leg_cost: "medium", volume_multiplier: 0.2,
    why: "Short efforts and lateral load. Cheaper than it feels, but not free.",
  },
  Climbing: {
    transfer: "none", leg_cost: "medium", volume_multiplier: 0,
    why: "Upper body and grip. Grip helps the carries; the legs still pay a little.",
  },
};

export const classify = (name: string): Classification =>
  COMMITMENT[name] ?? {
    transfer: "partial", leg_cost: "medium", volume_multiplier: 0.2,
    why: "Unclassified, so counted conservatively.",
  };

/** The commitments actually locked in — "Nothing fixed" is the absence of them. */
export const lockedCommitments = (x: Pick<Intake, "commitments">) =>
  (x.commitments ?? []).filter((c) => c !== "Nothing fixed");

/** Days already spent by something that costs the legs. */
export function heavyDays(x: Intake): number[] {
  const out = new Set<number>();
  for (const c of lockedCommitments(x)) {
    if (classify(c).leg_cost !== "high") continue;
    for (const d of x.commitDay?.[c] ?? []) {
      const i = DAYS.indexOf(d);
      if (i >= 0) out.add(i);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ validation

export type Problem = { field: string; why: string };

/** Injected in tests; the real one is today(). */
let clock = () => new Date().toISOString().slice(0, 10);
export const setClock = (fn: () => string) => { clock = fn; };
export const todayish = () => clock();

/**
 * What has to be true before a block can be built.
 *
 * Only the questions this athlete was actually asked are required. Bounds rather
 * than opinions: they exist to stop a typo becoming a plan, not to tell anyone
 * their goal is wrong.
 */
export function validate(x: Partial<Intake>): Problem[] {
  const p: Problem[] = [];
  const need = <T,>(v: unknown, list: readonly T[], field: string, why: string) => {
    if (!list.includes(v as T)) p.push({ field, why });
  };

  need(x.hasRace, HAS_RACE, "hasRace", "Do you have a race planned?");
  need(x.discipline, DISCIPLINE, "discipline", "Pick what you are training for.");
  if (!x.discipline || !DISCIPLINE.includes(x.discipline)) return p;

  const live = liveQuestions({ discipline: x.discipline, hasRace: x.hasRace ?? "No" });
  const asked = (id: string) => live.includes(id);

  if (asked("raceDistance")) need(x.raceDistance, RACE_DISTANCE, "raceDistance", "Which distance?");
  if (asked("role")) need(x.role, ROLE, "role", "Which partner are you?");
  if (asked("division")) {
    need(x.division, divisionsFor(x.discipline), "division", "Which standards apply?");
  }
  if (asked("sled")) need(x.sled, SLED, "sled", "How much sled work have you done?");
  need(x.base, BASE, "base", "How long have you trained consistently?");
  need(x.runningSelf, RUNNING_SELF, "runningSelf", "How would you describe your running?");
  need(x.volume, VOLUME_PREF, "volume", "Pick a volume approach.");
  need(x.difficulty, DIFFICULTY, "difficulty", "Pick a difficulty.");

  if (asked("raceDate")) {
    if (!x.raceDate) {
      p.push({ field: "raceDate", why: "When is race day?" });
    } else {
      const away = diffDays(x.raceDate, todayish());
      if (away < 7) p.push({ field: "raceDate", why: "That is less than a week away." });
      if (away > 730) p.push({ field: "raceDate", why: "That is more than two years out." });
    }
  }

  if (!x.paceUnknown) {
    const m = x.paceMin, s = x.paceSec ?? 0;
    if (typeof m !== "number" || !Number.isFinite(m) || m < 12 || m > 60) {
      p.push({ field: "pace", why: "A 5 km time between 12 and 60 minutes, or skip it." });
    }
    if (typeof s !== "number" || s < 0 || s > 59) {
      p.push({ field: "pace", why: "Seconds have to be between 0 and 59." });
    }
  }

  const days = x.days ?? [];
  if (days.length < 2) p.push({ field: "days", why: "Pick at least two days you can train." });
  else if (days.some((d) => !DAYS.includes(d))) {
    p.push({ field: "days", why: "That is not a day of the week." });
  }

  for (const c of lockedCommitments(x as Intake)) {
    const n = x.freq?.[c] ?? 1;
    if (n < 1 || n > 7) { p.push({ field: "commitments", why: `How many times a week is ${c}?` }); break; }
    const fixed = x.commitDay?.[c] ?? [];
    if (fixed.some((d) => !DAYS.includes(d))) {
      p.push({ field: "commitments", why: `${c} is fixed to a day that is not a day.` });
      break;
    }
    if (fixed.length > n) {
      p.push({ field: "commitments", why: `${c} is fixed to more days than it happens.` });
      break;
    }
  }
  return p;
}
