/**
 * The intake, as data.
 *
 * Ported from the design's `CoachPlan.INTAKE` so the questions, their order and
 * the rules for when each one applies live in one place rather than being spread
 * through a component. The flow is long enough that "why did it ask me that"
 * needs an answer you can read.
 *
 * Pure: no React, no fetch, no clock. The gating is a function of the answers so
 * far, which is what makes the progress bar honest — a step that will never be
 * shown is never counted.
 */

export type StepKind =
  | "choice" | "chips" | "date" | "time" | "text" | "prefs"
  | "connect" | "km" | "goal" | "races" | "start" | "gear" | "bRaces";

export type Step = {
  id: string;
  kind: StepKind;
  /**
   * Which section of the form this belongs to, and a two-word name for it.
   *
   * On the step rather than in a table beside it: a table is a second list that
   * drifts, and a question missing from it is a question the overview cannot
   * reach. The sections in the overview are derived from these.
   */
  block: Block;
  short: string;
  q: string;
  sub: string;
  /** [label, sub-label] pairs for choice steps */
  opts?: [string, string?][];
  /** flat labels for chips and gear */
  chips?: string[];
  other?: boolean;
  skip?: string;
  min?: number; max?: number; step?: number; unit?: string;
  /** first tap jumps here rather than counting up from zero */
  seed?: number;
};

/**
 * The sections, in the order they are asked.
 *
 * "You and your partner" holds only the two questions about the pair, so it
 * disappears for anyone not racing doubles rather than putting a partner heading
 * over an athlete's own answers.
 */
export const BLOCK_ORDER = [
  "Your race", "You and your partner", "Your standards and history",
  "Where you are starting", "Your week", "Your setup",
] as const;
export type Block = (typeof BLOCK_ORDER)[number];

/** What each section covers, for the overview. */
export const BLOCK_TOPIC: Record<Block, string> = {
  "Your race": "What you are training for and when",
  "You and your partner": "How the pair splits the work",
  "Your standards and history": "Weights, experience, races behind you",
  "Where you are starting": "Your base, your running, your recent volume",
  "Your week": "Days, sessions, and what is already in it",
  "Your setup": "Kit, access, and how hard you want it",
};

const c = (...opts: [string, string?][]) => opts;

export const STEPS: Step[] = [
  { id: "hasRace", block: "Your race", short: "race", kind: "choice", q: "Do you have your next race planned?",
    sub: "A date changes everything downstream — plan length, phases, when the taper lands.",
    opts: c(["Yes", "I have picked my race"], ["No", "Help me find a goal to work towards"]) },
  { id: "discipline", block: "Your race", short: "discipline", kind: "choice", q: "What are you training for?",
    sub: "This sets how the week is split between running, stations and strength.",
    opts: c(
      ["Hyrox doubles", "Shared stations with a partner — only this adds the two questions about how you and your partner compare"],
      ["Hyrox singles", "Every station yourself"],
      ["Running race", "5K through marathon"], ["General fitness", "No race, just build"]) },
  { id: "raceDistance", block: "Your race", short: "distance", kind: "choice", q: "Which distance?",
    sub: "The goal time and the long run are built from this.",
    opts: c(["5 km"], ["10 km"], ["Half marathon"], ["Marathon"]) },
  { id: "raceDate", block: "Your race", short: "date", kind: "date", q: "When is race day?",
    sub: "The plan is built backwards from here." },
  { id: "bRaces", block: "Your race", short: "other races", kind: "bRaces", q: "Any other races before then?",
    sub: "Anything you have entered. Each one costs training time, and how much depends on what you want from it.",
    skip: "No other races" },
  { id: "goal", block: "Your race", short: "goal", kind: "goal", q: "What do you want from race day?",
    sub: "This decides how hard the plan pushes, and whether it projects a time at all." },
  { id: "runDelta", block: "You and your partner", short: "run delta", kind: "choice", q: "Over 8 km, who is faster?",
    sub: "Relative, not absolute. The pair runs at the slower runner’s pace, so this decides how the running is weighted.",
    opts: c(["They are much faster"], ["They are a bit faster"], ["About the same"],
      ["I am a bit faster"], ["I am much faster"]) },
  { id: "stationDelta", block: "You and your partner", short: "station delta", kind: "choice", q: "On the heavy stations, who is stronger?",
    sub: "Sleds, sandbag lunges, farmers carry — the ones a pair splits unevenly.",
    opts: c(["They are much stronger"], ["They are a bit stronger"], ["About the same"],
      ["I am a bit stronger"], ["I am much stronger"]) },
  { id: "division", block: "Your standards and history", short: "division", kind: "choice", q: "Which standards apply?",
    sub: "Sled, wall ball and sandbag weights come from this.",
    opts: c(["Women · open"], ["Women · pro"], ["Men · open"], ["Men · pro"]) },
  { id: "hyroxExp", block: "Your standards and history", short: "Hyrox experience", kind: "choice", q: "How much Hyrox-specific training have you done?",
    sub: "Separate from general fitness. Station work and transitions are their own skill.",
    opts: c(["None", "Never trained the stations"], ["Occasional", "A station session here and there"],
      ["Weekly", "One dedicated session most weeks"], ["Multiple weekly", "Two or more, structured"],
      ["Daily focus", "Hyrox is the whole programme"]) },
  { id: "pastRaces", block: "Your standards and history", short: "past races", kind: "races", q: "Have you raced Hyrox before?",
    sub: "Your official splits are the most useful data in this whole form. Name the event and we pull run, station and roxzone times.",
    skip: "This is my first race" },
  { id: "startDate", block: "Where you are starting", short: "start date", kind: "start", q: "When do you want to start, and are you away at all?",
    sub: "Absences move the down weeks rather than being trained through." },
  { id: "base", block: "Where you are starting", short: "base", kind: "choice", q: "How long have you trained consistently?",
    sub: "Sets the volume your body already knows.",
    opts: c(["Under 3 months"], ["3 to 12 months"], ["Over a year"], ["Several years"]) },
  { id: "runningSelf", block: "Where you are starting", short: "running", kind: "choice", q: "How would you describe your running?",
    sub: "Answer honestly. This caps week 1, whatever the rest says. A 5 km time on the next step can lift it.",
    opts: c(["I do not run", "Walking, or no running yet"],
      ["Runs with walk breaks", "Not yet 5 km continuous"],
      ["5 km nonstop", "Comfortable at 5 km, no structure"],
      ["Runs regularly", "10 km comfortably, some intervals"],
      ["Half marathon fit", "15–20 km long runs, structured weeks"],
      ["Marathon runner", "30 km long runs, years of mileage"],
      ["Competitive", "Racing for time, coached or self-coached to a plan"]) },
  { id: "stravaConnect", block: "Where you are starting", short: "Strava", kind: "connect", q: "Connect Strava first?",
    sub: "The next two questions are numbers Strava already knows. Connecting means you confirm them instead of guessing.",
    skip: "Not now — I will enter them myself" },
  { id: "longestRun", block: "Where you are starting", short: "longest run", kind: "km", q: "What is your longest run in the last 8 weeks?",
    sub: "A single run, not a week. This caps where the long run starts and how fast it grows.",
    min: 0, max: 45, step: 1, unit: "km", seed: 10, skip: "I do not know" },
  { id: "peakWeek", block: "Where you are starting", short: "peak week", kind: "km", q: "And your biggest week in the last 4 weeks?",
    sub: "Total running volume in your heaviest recent week. This is the number week 1 is built from.",
    min: 0, max: 90, step: 2, unit: "km", seed: 20, skip: "I do not know" },
  { id: "pace", block: "Where you are starting", short: "5 km", kind: "time", q: "What can you currently run 5 km in?",
    sub: "Current fitness, not a personal best or a goal.", skip: "No idea — test me in week 1" },
  { id: "days", block: "Your week", short: "days", kind: "chips", q: "Which days are you available?",
    sub: "Availability, not a target. What gets scheduled comes next.",
    chips: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  { id: "targetSessions", block: "Your week", short: "sessions", kind: "choice", q: "How many sessions do you want a week?",
    sub: "Fewer, done properly, beats more on paper.",
    opts: c(["3"], ["4"], ["5"], ["6"], ["7"]) },
  { id: "commitments", block: "Your week", short: "commitments", kind: "chips", q: "Anything locked in your week?",
    sub: "Classes and other sports still cost your legs. Name them, say how they sit with the plan, and it works around them.",
    chips: ["Spin class", "Kickboxing", "Football", "Padel", "Climbing", "Swimming", "Yoga", "Nothing fixed"],
    other: true },
  { id: "allowDoubles", block: "Your week", short: "doubles", kind: "choice", q: "Happy to train twice in one day?", sub: "",
    opts: c(["Yes, when it helps"], ["Occasionally"], ["No, once a day"]) },
  { id: "wantRestDay", block: "Your week", short: "rest day", kind: "choice",
    q: "Keep one full rest day?",
    sub: "Your week is full enough that something has to give on one day. Both answers are trainable — neither of them is training seven hard days.",
    opts: c(
      ["Yes, keep one", "One day with nothing on it"],
      ["No, but keep one easy", "Train every day, with one day that is only an easy run"]) },
  /*
   * Which day the long run goes on.
   *
   * Asked rather than assumed. The placer used to spread the hard sessions and
   * whichever day the long run landed on was an accident of the arithmetic —
   * which is fine for the plan and wrong for the athlete whose Sunday is the only
   * day they have two hours.
   */
  { id: "longRunDay", block: "Your week", short: "long run day", kind: "choice",
    q: "Which day suits your long run?",
    sub: "The longest session of the week. Everything else is placed around it.",
    opts: c(["No preference", "Put it wherever the week works best"]) },
  { id: "sessionPref", block: "Your week", short: "session style", kind: "choice", q: "Station work: written sessions or classes?",
    sub: "Only the station and interval work. Running is always yours to do alone — no class prescribes your paces.",
    opts: c(["Write me the session", "Stations written out, done on your own"],
      ["Classes where possible", "You would rather turn up and be coached"],
      ["Mix", "Classes for stations, written sessions for intervals"]) },
  { id: "equipment", block: "Your setup", short: "kit and access", kind: "gear", q: "What can you actually get to?",
    sub: "Kit is only half of it — how freely you can use it decides whether compromised running is trainable.",
    chips: ["Sled — race weight", "Sled — lighter only", "SkiErg", "Rower", "Wall balls", "Sandbag",
      "Kettlebells", "Barbell", "Rig or pull-up bar", "Burpee floor space", "Treadmill",
      "Indoor track", "Run from the door"] },
  { id: "sled", block: "Your setup", short: "sled", kind: "choice", q: "Sled experience?",
    sub: "The most common place a first race falls apart.",
    opts: c(["Never used one"], ["Used a lighter sled"], ["Race weight, short distances"],
      ["Race weight and distance"]) },
  { id: "injuries", block: "Your setup", short: "injuries", kind: "text", q: "Anything to train around?",
    sub: "Read before any volume increase is proposed." },
  { id: "prefs", block: "Your setup", short: "volume and difficulty", kind: "prefs", q: "Volume and difficulty",
    sub: "Both can be changed later without rebuilding the block." },
];

/**
 * What the gear step starts with ticked.
 *
 * Floor space and running from the door are not equipment, they are the absence
 * of an obstacle — nearly everyone has both, and making someone confirm they own
 * a floor reads as a form that has not thought about them. Everything requiring
 * an actual purchase or a gym stays off, because a pre-ticked treadmill would put
 * treadmill sessions in the plan of someone who does not have one.
 */
export const GEAR_ASSUMED = ["Burpee floor space", "Run from the door"];

/**
 * Which answers stop being meaningful when an earlier one changes.
 *
 * Answers determine the questions that follow, so no later question should ever
 * be able to invalidate an earlier answer. The one case where that appears to
 * happen is going back: choose doubles, pick "Mixed doubles", return to step 2
 * and choose singles — and the division you picked belongs to a list that is no
 * longer on offer.
 *
 * That was surfacing as a complaint at the end of the flow, which is the wrong
 * place and the wrong framing: the answer was not wrong when it was given, it
 * stopped applying. So it is cleared when its parent changes, and the question is
 * simply asked again with the right options.
 */
export const DEPENDENTS: Record<string, string[]> = {
  // The division lists differ per discipline, and the partner questions only
  // exist for doubles at all.
  discipline: ["division", "runDelta", "stationDelta", "hyroxExp", "sled",
    "pastRaces", "raceDistance", "equipment"],
  // No race, no date, no goal, and nothing to gate a secondary race against.
  hasRace: ["raceDate", "goal", "goalMin", "bRaces"],
  // A target date moving changes what intent each secondary race can afford.
  raceDate: ["bRaces"],
  // The 5 km question is not asked of someone who does not run 5 km.
  runningSelf: ["paceMin", "paceSec", "paceUnknown"],
  // Both of these only exist when the week does not fit the days.
  days: ["wantRestDay", "allowDoubles"],
  targetSessions: ["wantRestDay", "allowDoubles"],
};

/** Everything that should be forgotten when `field` changes. */
export const dependentsOf = (field: string): string[] => DEPENDENTS[field] ?? [];

export type Answers = Record<string, unknown>;

const str = (a: Answers, k: string) => String(a[k] ?? "");
const arr = (a: Answers, k: string) => (Array.isArray(a[k]) ? (a[k] as unknown[]) : []);
const isDoubles = (a: Answers) => str(a, "discipline").includes("doubles");
const isHyrox = (a: Answers) => str(a, "discipline").startsWith("Hyrox");

/**
 * Sessions the week already contains: what they asked for, plus anything they
 * have locked into it. Two of the steps only exist when that number collides
 * with the days available.
 */
export function weeklyLoad(a: Answers): number {
  const asked = Number(str(a, "targetSessions")) || 0;
  const freq = (a.freq ?? {}) as Record<string, number>;
  const fixed = arr(a, "commitments")
    .filter((c2) => c2 !== "Nothing fixed")
    .reduce<number>((n, c2) => n + (freq[String(c2)] || 1), 0);
  return asked + fixed;
}

/**
 * The steps this athlete will actually be asked, in order.
 *
 * Filtered rather than skipped at render time, so "step 4 of 19" counts the
 * questions that exist for them — a progress bar that jumps two places because
 * a question did not apply is worse than no progress bar.
 */
export function liveSteps(a: Answers, stravaConnected: boolean): Step[] {
  return STEPS.filter((s) => {
    switch (s.id) {
      case "stravaConnect":
        return !stravaConnected;
      // A partner already in the app, or pulled from a race result, answers
      // these two better than the athlete's own estimate would.
      case "runDelta":
      case "stationDelta":
        return isDoubles(a) && !a.partnerInApp
          && !arr(a, "pastRaces").some((r) => (r as { partnerPulled?: boolean }).partnerPulled);
      case "raceDistance":
        return str(a, "discipline") === "Running race";
      case "division": case "sled": case "hyroxExp": case "pastRaces":
        return isHyrox(a);
      // Without a target there is no gap to gate a secondary race against.
      case "raceDate": case "goal": case "bRaces":
        return str(a, "hasRace") === "Yes";
      /*
       * A 5 km time is not a question you can ask someone who does not run 5 km.
       * They were being shown a stepper defaulted to 32 minutes and a "no idea"
       * escape, which is a worse way of saying the same thing. Their paces come
       * from the running base instead, uncalibrated and flagged as such.
       */
      case "pace":
        return !["doesnt_run", "walk_breaks"].includes(
          String(a.runningSelf ?? "") === "I do not run" ? "doesnt_run"
            : String(a.runningSelf ?? "") === "Runs with walk breaks" ? "walk_breaks" : "",
        );
      // Only worth asking when the week does not fit the days.
      case "allowDoubles":
        return weeklyLoad(a) > 7;
      /*
       * Asked once the week is busy, not only when it is impossible.
       *
       * This wanted all seven days AND seven sessions, so the athlete training six
       * times across six days — the case where a rest day is a real decision — was
       * never asked and silently got one.
       */
      case "wantRestDay":
        return weeklyLoad(a) >= 6;
      // Nothing to place if there are no days yet, and no long run under three
      // sessions a week.
      case "longRunDay":
        return arr(a, "days").length > 0 && weeklyLoad(a) >= 3;
      default:
        return true;
    }
  });
}

/** Whether a step has been answered enough to move on. */
export function filled(s: Step, a: Answers): boolean {
  switch (s.kind) {
    // Nothing to fill in: connecting is optional and the rest are skippable.
    case "connect": case "races": case "text": case "time": case "bRaces":
      return true;
    case "km":
      return Number(a[s.id]) > 0 || a[`${s.id}Unknown`] === true;
    case "chips":
      return arr(a, s.id).length > 0 || String(a.otherCommit ?? "").trim().length > 0;
    // Kit alone is not access, and neither answers whether a run can follow a
    // station — all three decide the variant, so all three are required.
    case "gear":
      return arr(a, s.id).length > 0 && !!a.gymAccess && !!a.runStationLink;
    case "prefs":
      return !!a.volume && !!a.difficulty;
    case "start":
      return !!a.startDate;
    default:
      return !!a[s.id];
  }
}

/**
 * The sub-line, where a step rewrites its own.
 *
 * `allowDoubles` only appears because the arithmetic did not work, so it says
 * the arithmetic rather than a general question about doubles.
 */
export function subFor(s: Step, a: Answers): string {
  if (s.id === "allowDoubles") {
    return `Your week comes to ${weeklyLoad(a)} sessions across ${arr(a, "days").length} available days. Something has to double up if you want a rest day.`;
  }
  return s.sub;
}

/** What connecting Strava actually gets them, in the order it matters. */
export const STRAVA_READS: [string, string][] = [
  ["Every run, ride and gym session", "matched to the session it was meant to be"],
  ["Laps and kilometre splits", "so intervals read as intervals"],
  ["Full heart-rate stream", "zone time and drift, which no self-report can give"],
  ["Your last 8 weeks", "longest run and peak week filled in for you"],
];

// ------------------------------------------------------------------- the map

/**
 * The blocks the questions fall into.
 *
 * Twenty-eight steps in one flat line means the only way back to step 8 from step
 * 26 is eighteen taps on an arrow. Grouping them gives somewhere to jump from —
 * and the groups are the athlete's own mental model of the form, not the
 * generator's stages.
 */
export type MapRow = { id: string; q: string; answer: string; step: number };
export type MapBlock = {
  name: Block; topics: string; range: string;
  answered: number; total: number; rows: MapRow[];
};

/**
 * The map, over the steps this athlete is actually being asked.
 *
 * Sections come from the steps rather than from a list beside them, so a section
 * whose questions do not apply is absent rather than empty, and every question
 * belongs to exactly one section by construction.
 */

export function mapOf(
  live: Step[], answers: Answers, describe: (s: Step) => string,
): MapBlock[] {
  const order = new Map<Block, Step[]>();
  live.forEach((st) => order.set(st.block, [...(order.get(st.block) ?? []), st]));

  return BLOCK_ORDER.filter((b) => order.has(b)).map((name) => {
    const steps = order.get(name)!;
    const rows: MapRow[] = steps.map((st) => ({
      id: st.id, q: st.q, answer: describe(st),
      step: live.findIndex((x) => x.id === st.id) + 1,
    }));
    const nums = rows.map((r) => r.step);
    return {
      name, topics: BLOCK_TOPIC[name],
      range: nums.length === 1 ? `Step ${nums[0]}`
        : `Steps ${Math.min(...nums)}\u2013${Math.max(...nums)}`,
      answered: steps.filter((st) => filled(st, answers)).length,
      total: steps.length,
      rows,
    };
  });
}

/**
 * The eyebrow above every question: which section, how much of it is done.
 *
 * The same words the overview uses, because it is the way into the overview —
 * a label that renamed itself between the two would read as a different place.
 */
export function blockLabel(live: Step[], answers: Answers, at: number): string {
  const st = live[at];
  if (!st) return "";
  const mine = live.filter((x) => x.block === st.block);
  const done = mine.filter((x) => filled(x, answers)).length;
  return `${st.block} \u00b7 ${done} of ${mine.length} \u00b7 all questions`;
}
