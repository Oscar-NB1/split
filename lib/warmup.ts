/**
 * The warm-up for the session you are actually about to do.
 *
 * There was one warm-up in the app, and it was a runner's: eight minutes of easy
 * jogging, leg swings, A-skips, strides. Prescribed before a back squat that is
 * eight minutes of the wrong thing followed by two drills that prepare a stride
 * length nobody is about to use — and before an easy run it is longer than the
 * session's own opening kilometre already is.
 *
 * A warm-up has one job, and the job changes with what follows it:
 *
 *   before intervals   raise the pace gradually and rehearse the target speed, so
 *                      rep one is not the fastest rep of the set
 *   before lifting     get the joints through range under no load, then the bar
 *                      itself. No running: a squat does not need a raised
 *                      respiratory rate, it needs hips and ankles that move
 *   before a long run  almost nothing. The first two kilometres are the warm-up,
 *                      and anything else is time on the legs for no return
 *   before Hyrox       the machines, briefly, and the movement patterns the
 *                      stations use — because the first station is where an
 *                      unwarmed shoulder or a cold hamstring goes
 *
 * The plan prescribes sessions, not mobility, so these are the app's own — which is
 * exactly why they have to be right for the session they sit under.
 */

export type WarmupStep = {
  name: string;
  /** what to actually do, in one line */
  cue: string;
  dose: string;
};

export type Warmup = {
  /** what this warm-up is for, said in one line above the steps */
  purpose: string;
  steps: WarmupStep[];
};

const RUN_DRILLS: WarmupStep[] = [
  { name: "Leg swings", cue: "Front-to-back then side-to-side, holding something.", dose: "10 each" },
  { name: "Walking lunge", cue: "Long step, back knee low, chest tall.", dose: "10 each" },
  { name: "A-skips", cue: "Quick ground contact, tall posture.", dose: "2 × 20 m" },
];

const JOINTS: WarmupStep[] = [
  { name: "Hip circles", cue: "Stand tall, knee up, draw a circle. Slow and deliberate.", dose: "8 each way" },
  { name: "Deep squat hold", cue: "Sit into the bottom, elbows inside the knees, breathe.", dose: "45 s" },
  { name: "Ankle rocks", cue: "Knee over toes against a wall, heel stays down.", dose: "10 each" },
];

const QUALITY: Warmup = {
  purpose: "Raise the pace in steps and rehearse the target, so rep one is not the fastest rep of the set.",
  steps: [
    { name: "Easy jog", cue: "Conversational. Nothing to prove yet.", dose: "10 min" },
    ...RUN_DRILLS,
    {
      name: "Strides",
      cue: "Build into today's target pace and step off it. Not faster — this is rehearsal, not a rep.",
      dose: "4 × 20 s",
    },
  ],
};

const STRENGTH: Warmup = {
  purpose: "Get the joints through range with no load, then let the bar be the warm-up. No running — a squat needs hips and ankles that move, not a raised heart rate.",
  steps: [
    { name: "Bike, row or ski", cue: "Easy. Just enough to stop being cold.", dose: "5 min" },
    ...JOINTS,
    { name: "Glute bridge", cue: "Squeeze at the top, two seconds. Wakes up what the first set needs.", dose: "12" },
    {
      name: "Empty bar or light sets",
      cue: "Two sets of the first movement at half the working weight, full range and full speed.",
      dose: "2 × 8",
    },
  ],
};

const HYROX: Warmup = {
  purpose: "The machines briefly, then the patterns the stations use. The first station is where a cold shoulder or a cold hamstring goes.",
  steps: [
    { name: "Row and ski", cue: "Build from easy to moderate. Both, so neither is a surprise.", dose: "3 min each" },
    ...JOINTS.slice(0, 2),
    { name: "Air squats into wall balls", cue: "Ten unweighted, then ten with the ball. Find the depth now.", dose: "10 + 10" },
    { name: "Easy jog with the first run pace", cue: "Finish on 200 m at the pace your card asks for.", dose: "5 min" },
  ],
};

const LONG: Warmup = {
  purpose: "Almost nothing. The first two kilometres are the warm-up — anything more is time on the legs for no return.",
  steps: [
    ...RUN_DRILLS.slice(0, 2),
    {
      name: "Start slower than feels right",
      cue: "The opening 2 km should be the slowest of the day. If it is not, the last 5 km will pay for it.",
      dose: "2 km",
    },
  ],
};

const EASY: Warmup = {
  purpose: "None needed. The run starts easy and that is the warm-up — this is only here for the days something feels tight.",
  steps: [
    ...RUN_DRILLS.slice(0, 2),
    { name: "Walk 3 minutes", cue: "Only if you are stiff. Otherwise start running slowly and let it come.", dose: "3 min" },
  ],
};

const RACE: Warmup = {
  purpose: "Long enough to be ready for a hard first kilometre, short enough to still be fresh for the eighth.",
  steps: [
    { name: "Easy jog", cue: "Finish this 20 minutes before the gun, not 5.", dose: "12 min" },
    ...RUN_DRILLS,
    { name: "Strides", cue: "Three, at race pace. Then keep moving and keep warm.", dose: "3 × 20 s" },
    { name: "Ten wall balls, ten air squats", cue: "So the first station is not the first time today.", dose: "10 + 10" },
  ],
};

/**
 * Which warm-up belongs to a session.
 *
 * Keyed on the kinds the plan actually writes, with the legacy `run_*` names the
 * older generator used mapped alongside them — a session stored before the rename
 * should not fall back to a generic warm-up.
 */
export function warmupFor(kind: string, title = ""): Warmup {
  const k = kind.toLowerCase();
  if (k === "strength" || /strength|lift/.test(k)) return STRENGTH;
  if (k === "race" || /race/.test(k)) return RACE;
  if (k === "hyrox" || k === "easy_hyrox" || /hyrox|station/.test(k)) return HYROX;
  if (k === "long_run" || k === "run_long") return LONG;
  if (k === "quality_run" || k === "run_intervals" || k === "benchmark") return QUALITY;
  if (k === "easy_run" || k === "run_easy") return EASY;

  /*
   * A commitment — a class, a match, a swim — gets the general one.
   *
   * The plan did not write the session and has no business telling somebody how to
   * warm up for their own kickboxing class, so this stays deliberately short.
   */
  if (/spin|class|padel|kickbox|swim|football|tennis/i.test(`${k} ${title}`)) {
    return {
      purpose: "Your session, your warm-up — this is only a floor. Whoever runs the class will take you through theirs.",
      steps: JOINTS,
    };
  }
  return EASY;
}
