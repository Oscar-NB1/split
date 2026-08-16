import { addDays, today } from "../dates";
import type { Intake } from "../intake";
import type { Absence } from "./intake-rules";
import type { Commitment } from "./slots";
import type { Goal } from "./allocate";
import type { Params } from "./generate";
import type { RecentRunning, RunningBase, TrainingAge } from "./resolve";
import { hyroxToAge, olderOf } from "./resolve";
import { deriveVariant, type Access, type Kit, type RunAttachment } from "./variant";

/**
 * The intake form, translated into generator parameters.
 *
 * The one place the two vocabularies meet. The form asks questions in the
 * athlete's language — "Half marathon fit", "Over a year", "Used a lighter
 * sled" — and the generator works in bands and numbers. Keeping the mapping
 * here rather than inside either side means a reworded question changes one
 * table, and the generator never learns what a question was called.
 */

const TRAINING_AGE: Record<string, TrainingAge> = {
  "Under 3 months": "novice",
  "3 to 12 months": "intermediate",
  "Over a year": "advanced",
  "Several years": "elite",
};

const RUNNING_BASE: Record<string, RunningBase> = {
  "I do not run": "doesnt_run",
  "Runs with walk breaks": "walk_breaks",
  "5 km nonstop": "5k_nonstop",
  "Runs regularly": "runs_regularly",
  "Half marathon fit": "half_marathon_fit",
  "Marathon runner": "marathon_competitive",
  Competitive: "marathon_competitive",
};

/** Hyrox-specific history, as the months and frequency the bands expect. */
const HYROX: Record<string, { months: number; sessions_per_week: number }> = {
  None: { months: 0, sessions_per_week: 0 },
  Occasional: { months: 3, sessions_per_week: 0.5 },
  Weekly: { months: 9, sessions_per_week: 1 },
  "Multiple weekly": { months: 18, sessions_per_week: 2 },
  "Daily focus": { months: 24, sessions_per_week: 5 },
};

const GOALS: Record<string, Goal> = {
  "Just finish it": "finish",
  "Finish strong, no blow-ups": "strong",
  "Target a time": "compete",
};

/** Where a partner answer sits on the −2..2 scale the roles are read from. */
const DELTA: Record<string, number> = {
  "They are much faster": 2, "They are a bit faster": 1, "About the same": 0,
  "I am a bit faster": -1, "I am much faster": -2,
  "They are much stronger": -2, "They are a bit stronger": -1,
  "I am a bit stronger": 1, "I am much stronger": 2,
};

const KIT: Record<string, Kit> = {
  "Sled — race weight": "race_weight_sled",
  "Sled — lighter only": "light_sled",
  SkiErg: "ski",
  Rower: "row",
  "Wall balls": "wall_balls",
  Sandbag: "sandbag",
  Kettlebells: "kettlebells",
  Barbell: "barbell",
  "Rig or pull-up bar": "pull_up_bar",
  "Burpee floor space": "burpee_space",
  Treadmill: "treadmill",
  "Indoor track": "running_track",
};

/** How a locked commitment sits with the plan. */
const INTENSITY: Record<string, Commitment["intensity"]> = {
  "Spin class": "high", Kickboxing: "high", Football: "high", Padel: "medium",
  Climbing: "medium", Swimming: "low", Yoga: "low",
};

const DAY_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

export type Extra = {
  /** measured or reported recent running, already resolved by lib/recent.ts */
  recent: RecentRunning | null;
  absences: Absence[];
  max_hr: number | null;
  /** true once a benchmark has been logged, which is the only thing that
   *  turns confidence to measured */
  measured: boolean;
  /**
   * Official Hyrox results on file.
   *
   * Read from the imported results rather than asked for. The intake used to
   * have a past-race step and it was dropped, which left the advanced and elite
   * Hyrox tiers unreachable — both need a race behind them, and nothing was
   * collecting one. The app already holds real results, so it counts those.
   */
  hyrox_races?: number;
};

export function paramsFrom(x: Intake, extra: Extra): Params {
  // Not snapped to a Monday: weeks are seven days from whenever the athlete
  // starts, so insisting on one only moved their answer.
  const start = startFrom(x) ?? today();
  const race = x.raceDate ?? null;

  /*
   * Block length from the calendar, not from a preference. Clamped because a
   * six-month block is not a block and a two-week one is not trainable — both
   * are surfaced as flags by the generator rather than silently accepted.
   */
  const length = race
    ? Math.max(4, Math.min(24, Math.round(
        (Date.parse(`${race}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 604_800_000,
      )))
    : 12;

  const general = TRAINING_AGE[x.base] ?? "novice";
  const hyroxExp = HYROX[String(x.hyroxExp ?? "None")] ?? HYROX.None;
  const hyrox_experience = isHyrox(x)
    ? { ...hyroxExp, races_done: extra.hyrox_races ?? 0 }
    : null;

  const kit = (x.equipment ?? []).map((e) => KIT[e]).filter(Boolean) as Kit[];
  const access: Access = x.gymAccess === "Classes only" ? "classes_only"
    : x.gymAccess === "Busy — expect to queue" ? "queue" : "open_floor";
  const run_attachment: RunAttachment = kit.includes("treadmill")
    || kit.includes("running_track") ? "attached" : "short_walk";

  return {
    // ------- resolve inputs
    general_training_age: hyrox_experience
      ? olderOf(general, hyroxToAge(hyrox_experience))
      : general,
    hyrox_experience,
    running_base: RUNNING_BASE[x.runningSelf] ?? "doesnt_run",
    target_sessions: Number(x.targetSessions) || (x.days?.length ?? 4),
    available_days: x.days?.length ?? 4,
    // Only a logged benchmark is a measurement. Strava volume is a measurement
    // of volume, not of pace, and the two are not interchangeable.
    confidence: extra.measured ? "measured" : "estimated",
    volume_dial: VOLUME_DIAL[x.volume] ?? 1,
    allow_doubles: (x.allowDoubles ?? "").startsWith("Yes"),
    recent: extra.recent,

    // ------- the rest
    length,
    days: (x.days ?? []).map((d) => DAY_INDEX[d]).filter((n) => n !== undefined).sort(),
    want_rest_day: (x.wantRestDay ?? "Yes, keep one").startsWith("Yes"),
    discipline: disciplineOf(x),
    goal: GOALS[String(x.goal ?? "")] ?? "strong",
    partner: partnerOf(x),
    variant: deriveVariant({ kit, access, run_attachment }),
    max_hr: extra.max_hr,
    // No anchor without a benchmark: every pace is derived and flagged as such.
    anchor: null,
    commitments: commitmentsOf(x),
    absences: extra.absences,
    exclusions: [],
    benchmark: x.benchmark !== "skipped",
    week_start: (n) => addDays(start, (n - 1) * 7),
  };
}

const VOLUME_DIAL: Record<string, number> = {
  Conservative: 0.6, Progressive: 1, Aggressive: 1.25,
};

const isHyrox = (x: Intake) => (x.discipline ?? "").startsWith("Hyrox");

function disciplineOf(x: Intake): Params["discipline"] {
  if ((x.discipline ?? "").includes("doubles")) return "doubles";
  if (x.discipline === "Hyrox singles") return "singles";
  return "running";
}

/** Only doubles has a partner, and only if they answered about one. */
function partnerOf(x: Intake): Params["partner"] {
  if (!(x.discipline ?? "").includes("doubles")) return null;
  const run = DELTA[String(x.runDelta ?? "")];
  const station = DELTA[String(x.stationDelta ?? "")];
  if (run === undefined || station === undefined) return null;
  return { run_delta: run, station_delta: station };
}

/**
 * The athlete's own sessions, which the plan schedules around rather than
 * prescribes. `add` rather than `replace`: they are doing these anyway, so they
 * cost load without buying a slot back.
 */
function commitmentsOf(x: Intake): Commitment[] {
  return (x.commitments ?? [])
    .filter((c) => c !== "Nothing fixed")
    .map((c) => ({
      activity: c.toLowerCase().replace(/\s+/g, "_"),
      per_week: x.freq?.[c] ?? 1,
      fixed_days: (x.commitDay?.[c] ?? []).map((d) => DAY_INDEX[d]).filter((n) => n !== undefined),
      intensity: INTENSITY[c] ?? "medium",
      mode: "add" as const,
      locked: (x.commitDay?.[c] ?? []).length > 0,
    }));
}

/** The start date the athlete chose, if they got that far. */
const startFrom = (x: Intake): string | null => x.startDate ?? null;
