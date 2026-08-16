import { addDays, mondayOf, today } from "../dates";
import type { Intake } from "../intake";
import type { Absence } from "./intake-rules";
import type { Commitment } from "./slots";
import type { Goal } from "./allocate";
import type { Params } from "./generate";
import type { RecentRunning, RunningBase, TrainingAge } from "./resolve";
import { hyroxToAge, olderOf } from "./resolve";
import { anchorFromFiveK, anchorFromGoal, anchorFromRaceSplit } from "./paces";
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
/**
 * The five answers as signed deltas, on roleFrom()'s scale: positive means the
 * PARTNER is the stronger of the two, for running and for stations alike.
 *
 * The station half of this table was inverted, so a pair where the partner runs
 * faster and carries the heavy stations came out as "run_limiter" — the athlete
 * holding the stations — and got the wrong split for the whole block. Protected
 * and run_limiter were swapped for every doubles athlete who answered either
 * comparison in the partner's favour.
 */
const DELTA: Record<string, number> = {
  "They are much faster": 2, "They are a bit faster": 1, "About the same": 0,
  "I am a bit faster": -1, "I am much faster": -2,
  "They are much stronger": 2, "They are a bit stronger": 1,
  "I am a bit stronger": -1, "I am much stronger": -2,
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
   * Races with a result behind them.
   *
   * From the imported official results where they exist, and otherwise from the
   * intake's own past-race step. Both are real races; one is scraped and one is
   * typed, and the count is the same either way. Without it the advanced and
   * elite Hyrox tiers are unreachable, because both require a race.
   */
  hyrox_races?: number;
};

export function paramsFrom(x: Intake, extra: Extra): Params {
  /*
   * The athlete's first day, and the Monday its week belongs to.
   *
   * Weeks run Monday to Sunday because that is what a week is — the day indices
   * every stage places on are 0 = Monday, so laying the block from a Wednesday put
   * a session the athlete had been told was Monday's on a Wednesday.
   *
   * Starting mid-week does not move the answer: week 1 is simply a short one, and
   * the days before the athlete started are not written at all.
   */
  const start = startFrom(x) ?? today();
  const anchor = mondayOf(start);
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
  // Asked now, rather than guessed from whether a treadmill happens to be listed.
  const run_attachment: RunAttachment =
    x.runStationLink === "Yes, running is right there" ? "attached"
    : x.runStationLink === "No, separate places" ? "separate" : "short_walk";

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
    /*
     * The difficulty dial, which this generator was ignoring entirely — Steady and
     * Hard produced the same week, and only the older generator's copy read it.
     */
    quality_target: DIFFICULTY[x.difficulty]?.quality ?? 1,
    long_run_pace: DIFFICULTY[x.difficulty]?.longRunPace ?? true,
    allow_doubles: (x.allowDoubles ?? "").startsWith("Yes"),
    recent: extra.recent,

    // ------- the rest
    length,
    days: (x.days ?? []).map((d) => DAY_INDEX[d]).filter((n) => n !== undefined).sort(),
    /*
     * Three answers, not two. "No, but keep one easy" is the common one and used to
     * be read as "train seven hard days", because the field was a boolean.
     */
    rest_day: !x.wantRestDay ? "none"
      : x.wantRestDay.startsWith("Yes") ? "full" : "easy",
    long_run_day: DAY_INDEX[String(x.longRunDay ?? "")] ?? null,
    discipline: disciplineOf(x),
    goal: GOALS[String(x.goal ?? "")] ?? "strong",
    partner: partnerOf(x),
    variant: deriveVariant({ kit, access, run_attachment }),
    /** the equipment answers as given, for the strength prescription */
    equipment: x.equipment ?? [],
    /*
     * Whether the station work is written out or attended.
     *
     * "Mix" means classes for the stations and written sessions for the intervals —
     * which is what it says on the step. Running is always written: no class
     * prescribes an athlete's paces.
     */
    session_style: (x.sessionPref ?? "").startsWith("Classes") ? "classes"
      : (x.sessionPref ?? "") === "Mix" ? "mix"
      : "written",
    max_hr: extra.max_hr,
    /*
     * The paces come from the best time on file.
     *
     * A benchmark anchors it where one has been run; otherwise the athlete's own
     * 5 km does. Only where there is neither does the plan fall back to zones and
     * effort — which is where it was falling for everybody, including athletes who
     * had typed in a 5 km time, so no session carried a pace at all.
     */
    anchor: anchorFor(x),
    commitments: commitmentsOf(x),
    absences: extra.absences,
    exclusions: [],
    benchmark: x.benchmark !== "skipped",
    week_start: (n) => addDays(anchor, (n - 1) * 7),
    /** the day they actually begin, inside week 1 */
    first_day: start,
  };
}

/**
 * Where the paces come from, best evidence first.
 *
 * A benchmark result outranks everything, and is applied elsewhere once one exists.
 * Below that: the athlete's own race splits, then a 5 km they have run, then — only
 * if there is nothing at all — the time they are aiming at, flagged as the
 * aspiration it is. Every source states itself on the session, so a target built
 * from a goal is never mistaken for one built from a measurement.
 */
function anchorFor(x: Intake): ReturnType<typeof anchorFromFiveK> {
  return anchorFromRaceSplit(raceRunSplit(x))
    ?? anchorFromFiveK(fiveKSeconds(x))
    ?? anchorFromGoal(x.goal === "Target a time" && x.goalMin
      ? Math.round(x.goalMin * 60) : null);
}

/** mm:ss or h:mm:ss as seconds. */
function clock(t: string | undefined | null): number | null {
  if (!t) return null;
  const parts = String(t).trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/** The average run split from the race the athlete anchored the plan on. */
function raceRunSplit(x: Intake): number | null {
  const races = x.pastRaces ?? [];
  if (races.length === 0) return null;
  const anchored = races.find((r) => r.anchored) ?? races[0];
  return clock(anchored.run_avg);
}

/** The 5 km the athlete gave, in seconds, or nothing if they skipped it. */
function fiveKSeconds(x: Intake): number | null {
  if (x.paceUnknown) return null;
  const m = Number(x.paceMin), s = Number(x.paceSec ?? 0);
  if (!Number.isFinite(m) || m <= 0) return null;
  return Math.round(m * 60 + (Number.isFinite(s) ? s : 0));
}

const VOLUME_DIAL: Record<string, number> = {
  Conservative: 0.6, Progressive: 1, Aggressive: 1.25,
};

/** What each difficulty asks for. The same three rows the older generator used. */
const DIFFICULTY: Record<string, { quality: number; longRunPace: boolean }> = {
  Steady: { quality: 1, longRunPace: false },
  Challenging: { quality: 1, longRunPace: true },
  Hard: { quality: 2, longRunPace: true },
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
      /*
       * The activity is a key, and the athlete's own words are the title.
       *
       * Only the key was carried through, so a session called "Padel" appeared on
       * the week as "padel" — the internal form of their answer, shown back to
       * them.
       */
      activity: c.toLowerCase().replace(/\s+/g, "_"),
      label: c,
      per_week: x.freq?.[c] ?? 1,
      fixed_days: (x.commitDay?.[c] ?? []).map((d) => DAY_INDEX[d]).filter((n) => n !== undefined),
      intensity: INTENSITY[c] ?? "medium",
      // Asked now. It decides whether the commitment costs a slot or only load.
      mode: (x.commitMode?.[c] === "replace" ? "replace" : "add") as "add" | "replace",
      locked: (x.commitDay?.[c] ?? []).length > 0,
    }));
}

/** The start date the athlete chose, if they got that far. */
const startFrom = (x: Intake): string | null => x.startDate ?? null;
