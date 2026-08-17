/**
 * What to look for when you are booking a class instead of writing the session.
 *
 * A Hyrox session has two honest forms. Either the athlete does it themselves, in
 * which case the plan says exactly what to do — and it now does, station by station.
 * Or they go to a class, in which case the plan cannot know what the coach has
 * written, and pretending otherwise produced the worst card in the app: a numbered
 * list reading "1. Hyrox class, 2. 2 km running inside it, 3. Stations at race
 * weight", each tagged STATION.
 *
 * That is not a session. It is the plan's own note to itself, printed as instructions.
 *
 * What an athlete actually needs before a class is a filter: which class on the
 * timetable serves this week, what it should contain, and what to do if the one they
 * can get to is the wrong shape. That is answerable without knowing the class.
 */

export type ClassGuide = {
  /** the label a timetable would use, so it can be matched against one */
  looking_for: string;
  /** what the session is for, in the plan's terms */
  why: string;
  /** what a class has to contain to count */
  must: string[];
  /** what makes it the wrong class this week */
  avoid: string[];
  /** roughly how long, so a 45-minute class is not silently a 60-minute session */
  minutes: number;
  /** what to do when the only class available is the wrong shape */
  fallback: string;
};

const COMPROMISED: ClassGuide = {
  looking_for: "Hyrox / functional class — compromised running",
  why: "Running off a station is a different skill from running, and this is the week's exposure to it.",
  must: [
    "Runs alternating with weighted stations — not stations in one block and cardio in another",
    "At least 1.5–2 km of running inside the hour, in pieces of 400 m or more",
    "Sled, carry or lunge at a load you would race",
  ],
  avoid: [
    "A pure strength or bodybuilding class — that is Monday's session",
    "A HIIT or AMRAP class with no running in it at all",
    "Anything scored for reps: you are holding a pace, not chasing a leaderboard",
  ],
  minutes: 60,
  fallback: "If the only class is stations-only, run 2 km at your easy pace immediately after it — the point is running on tired legs, and that gets you there.",
};

const TRANSITIONS: ClassGuide = {
  looking_for: "Hyrox class — stations and transitions",
  why: "The roxzone is where a minute and a half hides, and it is trained by moving between things rather than by doing them.",
  must: [
    "Several stations in sequence with short changeovers",
    "Race-weight sled or carries at least once",
    "A coach who times you, or a clock you can see",
  ],
  avoid: [
    "Long rests between exercises — the transition is the session",
    "A class that spends twenty minutes on technique for one movement",
  ],
  minutes: 60,
  fallback: "Any station class works if you time your own changeovers and refuse to rest between them.",
};

const SIMULATION: ClassGuide = {
  looking_for: "Hyrox simulation / race-prep class",
  why: "A rehearsal of the event in the order you will meet it, at the intensity you will meet it.",
  must: [
    "All eight stations, or a clean half of them, in race order",
    "1 km runs between stations, or 500 m at minimum",
    "Race weights, not scaled",
  ],
  avoid: [
    "A partner format, unless you are racing doubles with that partner",
    "A class the week before your race — this is a hard day and it needs a fortnight of clearance",
  ],
  minutes: 75,
  fallback: "No simulation on the timetable? Do it alone: this is the one session worth booking a lane and a sled for.",
};

const EASY: ClassGuide = {
  looking_for: "Open gym, or a low-intensity conditioning class",
  why: "Aerobic work on the machines that are a quarter of your station time, without another eight kilometres on your legs.",
  must: [
    "Machines you can set your own pace on — ski, row, bike",
    "Freedom to keep it conversational",
  ],
  avoid: [
    "Any class that is scored, timed or coached at intensity — a class is never easy",
    "Sled, sandbag or heavy carries: this session is deliberately unloaded",
  ],
  minutes: 45,
  fallback: "This one is better done alone than in a class. Twenty minutes of ski and row, easy enough to talk through.",
};

/**
 * Which guide a session wants, from its own label.
 *
 * Read off the label rather than a new field because the label is already the
 * race-specific ladder's own description — compromised running, transitions, a half
 * or full simulation — and it progresses with the block.
 */
export function classGuideFor(kind: string, label = ""): ClassGuide | null {
  const l = label.toLowerCase();
  if (kind === "easy_hyrox") return EASY;
  if (kind !== "hyrox") return null;
  if (/simulation/.test(l)) return SIMULATION;
  if (/transition/.test(l)) return TRANSITIONS;
  return COMPROMISED;
}
