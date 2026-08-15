import type { IntentRange } from "./block";
import { addDays, diffDays, dow, mondayOf } from "./dates";
import type { Rules, TemplateDay } from "./templates";

/**
 * The intake, and the block it produces.
 *
 * This exists because the alternative was worse. Asked to give the second athlete
 * a plan, I wrote one: a starting volume, a progression, a race and a set of
 * session notes, none of which came from her. It read as authoritative and was
 * invented. A training plan that nobody can trace back to a stated fact about the
 * athlete is not a plan, it is a guess with a coach's voice.
 *
 * So every number the generator produces traces to an answer:
 *
 *   - starting volume comes from the km/week they say they currently run
 *   - the ceiling comes from that, not from anyone else's proven ceiling
 *   - the number of weeks comes from today and their race date
 *   - which day carries what comes from the days they say they can train
 *   - station work appears only for equipment they say they have
 *   - pace targets appear only if they give a recent benchmark
 *
 * Where an answer is missing, the block says so rather than filling the gap. No
 * goal time means no goal time — the Form screen reports "no target" instead of
 * scoring them against a number nobody chose.
 */

export const EXPERIENCE = ["new", "returning", "consistent", "competitive"] as const;
export const GOAL_KIND = [
  "hyrox", "hyrox_doubles", "race_5k", "race_10k", "half", "general",
] as const;
export const GYM_ACCESS = ["none", "home", "basic_gym", "full_gym", "hyrox_gym"] as const;

/** The kit that changes what can be programmed, not everything in a gym. */
export const EQUIPMENT = [
  "sled", "skierg", "rower", "wall_ball", "sandbag", "kettlebell",
  "barbell", "pull_up_bar", "dumbbells", "treadmill",
] as const;

export type Experience = (typeof EXPERIENCE)[number];
export type GoalKind = (typeof GOAL_KIND)[number];
export type GymAccess = (typeof GYM_ACCESS)[number];
export type Equipment = (typeof EQUIPMENT)[number];

export type Intake = {
  experience: Experience;
  current_km_week: number;
  longest_run_km: number;
  recent_5k_seconds: number | null;
  goal_kind: GoalKind;
  goal_race_name: string | null;
  goal_date: string | null;
  goal_time_seconds: number | null;
  days_per_week: number;
  /** 0 = Monday. */
  preferred_days: number[];
  long_run_day: number | null;
  gym_access: GymAccess;
  equipment: Equipment[];
  injuries: string | null;
  constraints_note: string | null;
};

export const GOAL_LABEL: Record<GoalKind, string> = {
  hyrox: "Hyrox",
  hyrox_doubles: "Hyrox doubles",
  race_5k: "5K",
  race_10k: "10K",
  half: "Half marathon",
  general: "General fitness",
};

const DAY_NAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const isHyrox = (k: GoalKind) => k === "hyrox" || k === "hyrox_doubles";

// ------------------------------------------------------------------ validation

export type Problem = { field: keyof Intake; why: string };

/**
 * What has to be true before a block can be built from this.
 *
 * Bounds rather than opinions: they exist to stop a typo becoming a plan, not to
 * tell anyone their goal is wrong. A 400 km week is a slipped decimal point.
 */
export function validate(x: Partial<Intake>): Problem[] {
  const p: Problem[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  if (!EXPERIENCE.includes(x.experience as Experience)) {
    p.push({ field: "experience", why: "Pick where you are now." });
  }
  const km = num(x.current_km_week);
  if (km === null || km < 0 || km > 250) {
    p.push({ field: "current_km_week", why: "Weekly kilometres, somewhere between 0 and 250." });
  }
  const longest = num(x.longest_run_km);
  if (longest === null || longest < 0 || longest > 100) {
    p.push({ field: "longest_run_km", why: "Your longest recent run, in kilometres." });
  }
  if (km !== null && longest !== null && longest > km && km > 0) {
    // not fatal, but it means the week is one run — worth saying
    p.push({ field: "longest_run_km", why: "That is longer than your whole week. Check both numbers." });
  }
  if (!GOAL_KIND.includes(x.goal_kind as GoalKind)) {
    p.push({ field: "goal_kind", why: "Pick what you are training for." });
  }
  const days = num(x.days_per_week);
  if (days === null || days < 2 || days > 7) {
    p.push({ field: "days_per_week", why: "Between 2 and 7 days a week." });
  }
  if (days !== null && (x.preferred_days?.length ?? 0) > 0
      && (x.preferred_days?.length ?? 0) < days) {
    p.push({ field: "preferred_days", why: `Pick at least ${days} days, or leave it blank.` });
  }
  if (!GYM_ACCESS.includes(x.gym_access as GymAccess)) {
    p.push({ field: "gym_access", why: "Pick what you have access to." });
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
  return p;
}

/** Injected in tests; the real one is today(). */
let clock = () => new Date().toISOString().slice(0, 10);
export const setClock = (fn: () => string) => { clock = fn; };
const todayish = () => clock();

// ------------------------------------------------------------- the progression

/**
 * How hard the build climbs, by stated experience.
 *
 * `step` is the weekly increase as a share of the starting volume; `ceiling` caps
 * the peak as a multiple of it. Someone returning after a break gets the gentlest
 * climb and the lowest ceiling — that is where blocks are most often lost.
 */
const CLIMB: Record<Experience, { step: number; ceiling: number; days: number }> = {
  new:         { step: 0.08, ceiling: 1.6, days: 3 },
  returning:   { step: 0.10, ceiling: 1.8, days: 4 },
  consistent:  { step: 0.10, ceiling: 2.0, days: 5 },
  competitive: { step: 0.12, ceiling: 2.2, days: 6 },
};

/** Every fourth week comes down. Standard, and the reason blocks survive. */
const DOWN_EVERY = 4;
const DOWN_FACTOR = 0.7;

/**
 * The weekly volume table.
 *
 * Starts at what they say they run now — never above it. The first week of a
 * block being harder than the week before it is the single most common way a
 * plan is abandoned in week two.
 */
export function volumeFor(intake: Intake, weeks: number): { km: number; note: string }[] {
  const start = Math.max(5, Math.round(intake.current_km_week));
  const { step, ceiling } = CLIMB[intake.experience];
  const cap = Math.round(start * ceiling);
  const out: { km: number; note: string }[] = [];
  // the last week is always a taper into the race
  const taperWeeks = weeks >= 8 ? 2 : weeks >= 4 ? 1 : 0;
  const buildWeeks = weeks - taperWeeks;

  let climbed = 0;
  for (let n = 1; n <= buildWeeks; n++) {
    const down = n % DOWN_EVERY === 0 && n !== buildWeeks;
    if (!down) climbed++;
    const raw = start + start * step * (climbed - 1);
    const km = Math.round(Math.min(cap, raw) * (down ? DOWN_FACTOR : 1));
    out.push({
      km: Math.max(5, km),
      note: down ? "Down week — the volume drop is the point of it." : "",
    });
  }
  for (let i = 0; i < taperWeeks; i++) {
    const last = i === taperWeeks - 1;
    out.push({
      km: Math.max(5, Math.round(start * (last ? 0.5 : 0.75))),
      note: last ? "Race week — nothing you do now makes you fitter." : "Taper.",
    });
  }
  return out;
}

/** Which weeks are which, expressed the way the Week screen reads them. */
export function intentsFor(intake: Intake, weeks: number): IntentRange[] {
  const goal = GOAL_LABEL[intake.goal_kind];
  const taperFrom = weeks >= 8 ? weeks - 1 : weeks;
  const third = Math.max(1, Math.floor(taperFrom / 3));
  const out: IntentRange[] = [];

  const longRun = intake.long_run_day ?? 6;
  const protect = isHyrox(intake.goal_kind)
    ? [`${DAY_NAME[longRun]} · Long run`, "Compromised running session"]
    : [`${DAY_NAME[longRun]} · Long run`, "The week's one hard session"];

  out.push({
    from: 1, to: third,
    phase: `Base · weeks 1–${third}`,
    purpose:
      `Get the week itself repeatable at ${Math.round(intake.current_km_week)} km, which is where you said you are. ` +
      "Nothing here is meant to hurt — the block is bought by finishing every week.",
    protect,
    sacrifice: "Strength goes before running. Never the long run.",
    watch: "Easy runs run too hard are the failure mode. They cost the hard session.",
  });
  if (taperFrom > third) {
    out.push({
      from: third + 1, to: Math.min(taperFrom, third * 2),
      phase: `Build · weeks ${third + 1}–${Math.min(taperFrom, third * 2)}`,
      purpose:
        "Volume climbs toward this block's ceiling. The adaptation to want is the same pace at a lower heart rate, not a faster pace.",
      protect,
      sacrifice: "A midweek session can become an easy run before the long run moves.",
      watch: "Two hard days a week, no more. Everything else is easy.",
    });
  }
  if (taperFrom > third * 2) {
    out.push({
      from: third * 2 + 1, to: taperFrom,
      phase: `Specific · weeks ${third * 2 + 1}–${taperFrom}`,
      purpose: isHyrox(intake.goal_kind)
        ? "Station work stops being fitness and becomes rehearsal: transitions, splits, roxzone."
        : `Sessions take the shape of the ${goal}. Volume holds; the intensity gets specific.`,
      protect,
      sacrifice: "Everything that would compromise the specific session.",
      watch: "Rep 1 fastest means the session failed, whatever the average says.",
    });
  }
  if (taperFrom < weeks) {
    out.push({
      from: taperFrom + 1, to: weeks,
      phase: "Taper and race week",
      purpose: "Volume drops, intensity stays. The work is done; this only protects it.",
      protect: intake.goal_date ? [`${intake.goal_race_name ?? goal}`] : ["Rest"],
      sacrifice: "Any session you feel unsure about. When in doubt, rest.",
      watch: "Do not chase a session you missed. Missed work in taper is free.",
    });
  }
  return out;
}

// ------------------------------------------------------------ the week's shape

/**
 * Which days carry what.
 *
 * Their stated days are used in the order given, and the long run goes on the day
 * they chose for it. When they name no days, the fallback spreads sessions rather
 * than assuming a Monday-to-Friday life — but a stated preference always wins,
 * because the plan someone actually does beats the plan that is better on paper.
 */
export function daysFor(intake: Intake): { run: number[]; long: number; gym: number[] } {
  const want = Math.min(7, Math.max(2, intake.days_per_week));
  const stated = [...new Set(intake.preferred_days)].filter((d) => d >= 0 && d <= 6).sort();
  const days = stated.length >= want ? stated.slice(0, want)
    : [...new Set([...stated, ...[0, 2, 4, 6, 1, 3, 5]])].slice(0, want).sort();

  const long = intake.long_run_day != null && days.includes(intake.long_run_day)
    ? intake.long_run_day
    : days[days.length - 1];

  const rest = days.filter((d) => d !== long);
  // gym only where there is something to train with, and never on the long run day
  const gymDays = intake.gym_access === "none" ? 0 : intake.experience === "new" ? 1 : 2;
  return { run: rest, long, gym: rest.slice(0, gymDays) };
}

/** What a strength session can actually contain, given what they said they have. */
export function strengthFor(intake: Intake): string | null {
  const has = (e: Equipment) => intake.equipment.includes(e);
  if (intake.gym_access === "none") return null;
  const lines: string[] = [];
  if (has("barbell")) lines.push("Back squat 3x5", "Romanian deadlift 3x8");
  else if (has("dumbbells") || has("kettlebell")) lines.push("Goblet squat 3x8", "Single-leg RDL 3x8 each");
  else lines.push("Split squat 3x10 each", "Hip hinge 3x12");
  if (has("pull_up_bar")) lines.push("Pull-up 3x6");
  if (has("sandbag")) lines.push("Sandbag lunge 3x20 m");
  if (has("kettlebell")) lines.push("Kettlebell swing 3x15");
  return lines.join("\n");
}

/**
 * The Hyrox-specific session, limited to stations they can actually do.
 *
 * Returns null when the goal is not Hyrox or when they have none of the kit —
 * programming a sled push for someone without a sled is how a plan stops being
 * believed.
 */
export function stationsFor(intake: Intake): string | null {
  if (!isHyrox(intake.goal_kind)) return null;
  const has = (e: Equipment) => intake.equipment.includes(e);
  const can: string[] = [];
  if (has("skierg")) can.push("SkiErg 500 m");
  if (has("rower")) can.push("Row 500 m");
  if (has("sled")) can.push("Sled push 25 m", "Sled pull 25 m");
  if (has("wall_ball")) can.push("Wall balls 40");
  if (has("sandbag")) can.push("Sandbag lunge 50 m");
  if (has("kettlebell")) can.push("Farmers carry 100 m");
  can.push("Burpee broad jump 30 m"); // needs nothing
  return can.join("\n");
}

/**
 * One week, as day shapes.
 *
 * The rhythm is the same every week and the *content* changes with the phase,
 * which is what makes it schedulable around a real life.
 */
export function weekShape(intake: Intake, n: number, weeks: number, km: number): TemplateDay[] {
  const { run, long: preferredLong, gym } = daysFor(intake);
  const days: TemplateDay[] = [];
  const taperFrom = weeks >= 8 ? weeks - 1 : weeks;
  const specific = n > Math.max(1, Math.floor(taperFrom / 3)) * 2;
  const raceWeek = n === weeks && !!intake.goal_date;

  // The race goes on the day the race actually is, which is not negotiable and is
  // not their preferred long-run day: a Saturday race put on a Sunday long-run day
  // lands on the 29th for a race on the 28th.
  const raceDay = raceWeek ? dow(intake.goal_date!) : null;
  const long = raceDay ?? preferredLong;

  // the one hard session of the week, on the first stated day — and in race week,
  // never on the race day itself
  const hardDay = (raceDay != null ? run.find((d) => d !== raceDay) : run[0]) ?? preferredLong;
  const pace = intake.recent_5k_seconds
    ? ` @ ${paceCue(intake.recent_5k_seconds, specific ? 0 : 8)}`
    : "";
  days.push(
    raceWeek
      ? { day: hardDay, kind: "run_easy", title: "Shakeout", minutes: 25, slot: "AM",
          coach_note: "Legs awake, nothing more." }
      : {
          day: hardDay,
          kind: "run_intervals",
          title: specific ? `Race-pace intervals${pace}` : `Intervals${pace}`,
          minutes: 45,
          slot: "AM",
          target: specific ? "6 x 1000m, 90s standing" : "5 x 800m, 90s jog",
          coach_note: intake.recent_5k_seconds
            ? "Even splits. Rep 1 fastest means the session failed, whatever the average says."
            : "No pace target yet — run these by effort until you have a benchmark.",
          significance: "key",
        },
  );

  // the Hyrox or second run day
  const secondDay = run[1];
  if (secondDay != null && !raceWeek) {
    const stations = stationsFor(intake);
    days.push(stations
      ? { day: secondDay, kind: "hyrox", title: specific ? "Compromised running" : "Stations + running",
          minutes: 50, slot: "AM", target: stations,
          coach_note: specific
            ? "Stations straight into runs. This is the thing the race actually asks for."
            : "Stations at effort, runs easy. Getting used to running on tired legs." }
      : { day: secondDay, kind: "run_easy", title: "Easy run", minutes: 40, slot: "AM",
          coach_note: "Conversational. If you cannot talk, it is too fast." });
  }

  // any remaining stated days are easy running
  for (const d of run.slice(2)) {
    if (raceWeek) break;
    days.push({ day: d, kind: "run_easy", title: "Easy run", minutes: 35, slot: "AM",
      coach_note: "Conversational the whole way." });
  }

  // strength, on days that already carry a run, so rest days stay rest days
  const strength = strengthFor(intake);
  if (strength && !raceWeek) {
    for (const d of gym) {
      days.push({ day: d, kind: "strength", title: "Strength", minutes: 35, slot: "PM",
        target: strength,
        coach_note: "Two reps in reserve. This supports the running, it does not compete with it." });
    }
  }

  // the long run takes what the week's volume has not already spent
  const spent = days.reduce((t, d) => t + (d.kind.startsWith("run") || d.kind === "hyrox" ? d.minutes / 6 : 0), 0);
  const longKm = Math.max(4, Math.round(km - spent));
  if (!raceWeek) {
    days.push({
      day: long, kind: "run_long", title: `Long run ${longKm} km`, minutes: longKm * 6, slot: "AM",
      coach_note: "Easy the whole way. This is the session that builds the engine.",
    });
  } else {
    days.push({
      day: raceDay!, kind: "hyrox",
      title: intake.goal_race_name ?? GOAL_LABEL[intake.goal_kind],
      minutes: 75, slot: "AM", significance: "race",
      coach_note: "Race day. Hold back early — everyone goes out hot.",
    });
  }
  return days;
}

/** 5K time → a per-kilometre cue, `slower` seconds off race pace. */
export function paceCue(fiveKSeconds: number, slower: number): string {
  const perKm = fiveKSeconds / 5 + slower;
  const m = Math.floor(perKm / 60);
  return `${m}:${String(Math.round(perKm % 60)).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ the block

export type GeneratedPlan = {
  name: string;
  start: string;
  weeks: number;
  race_date: string | null;
  race_name: string | null;
  goal_label: string | null;
  goal_seconds: number | null;
  volume: { km: number; note: string }[];
  intents: IntentRange[];
  shapes: TemplateDay[][];
  rules: Rules;
};

/** How long a block runs when no race pins the end of it. */
const DEFAULT_WEEKS = 12;

/**
 * The block, from the answers.
 *
 * The length comes from the race date when there is one — a block ends on race
 * day, not on a round number — and defaults to twelve weeks when there is not.
 */
export function generate(intake: Intake, from: string = todayish()): GeneratedPlan {
  // start the Monday after today, so week 1 is a whole week
  const start = mondayOf(addDays(from, 7));
  const weeks = intake.goal_date
    ? Math.max(2, Math.ceil((diffDays(intake.goal_date, start) + 1) / 7))
    : DEFAULT_WEEKS;

  const volume = volumeFor(intake, weeks);
  const shapes = volume.map((v, i) => weekShape(intake, i + 1, weeks, v.km));

  return {
    name: `${GOAL_LABEL[intake.goal_kind]} · ${weeks} weeks`,
    start,
    weeks,
    race_date: intake.goal_date,
    race_name: intake.goal_race_name ?? (intake.goal_date ? GOAL_LABEL[intake.goal_kind] : null),
    goal_label: intake.goal_time_seconds ? hms(intake.goal_time_seconds) : null,
    goal_seconds: intake.goal_time_seconds,
    volume,
    intents: intentsFor(intake, weeks),
    shapes,
    // the volume table is written out week by week, so the engine must not also
    // progress it — that would apply the climb twice
    rules: { long_run_delta_min: 0, deload_every: 0, fatigue_skips_to_deload: 2, fatigue_cut: 0.85 },
  };
}

const hms = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${m}:${String(s % 60).padStart(2, "0")}`;
};
