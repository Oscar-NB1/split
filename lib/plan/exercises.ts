/**
 * What each movement is, how to do it, and roughly what to load it with.
 *
 * Two problems, one table. The load column was empty — `prescribed_load` came from
 * the last time the athlete lifted that movement, so a first block showed "—" on
 * every set and the athlete guessed. And the exercise names stood alone: "Rear-foot
 * elevated split squat" is a sentence in a language somebody has to already speak.
 *
 * The load is guidance and says so. Nobody can know a stranger's back squat, but a
 * coach handed a new athlete does not shrug — they look at bodyweight and training
 * history, name a number, and correct it after the first set. That is exactly what
 * this is, and it is replaced by the athlete's own history the moment there is any.
 */

export type Pattern = "hinge" | "squat" | "single_leg" | "press" | "pull" | "carry"
  | "core" | "calf" | "grip";

export type Exercise = {
  /** what it trains and why a Hyrox athlete does it, in one or two sentences */
  what: string;
  /** how to do it — the two or three cues that matter */
  how: string;
  pattern: Pattern;
  /**
   * Working load as a multiple of bodyweight, for a set of 8 at an intermediate
   * training age. Null where the movement is bodyweight or a band and a number would
   * be nonsense.
   *
   * Deliberately conservative: an athlete who finds the first set easy adds weight in
   * thirty seconds, and one who finds it too heavy has already hurt themselves.
   */
  bw: number | null;
  /** true where the number is per hand rather than total */
  perHand?: boolean;
};

export const EXERCISES: Record<string, Exercise> = {
  "Trap bar deadlift": {
    what: "The heaviest thing you will do, and the closest lift there is to a sled push: everything in a Hyrox that is hard is a hinge under load.",
    how: "Hips back, chest proud, bar close. Stand up by pushing the floor away rather than pulling with your back.",
    pattern: "hinge", bw: 0.9,
  },
  "Romanian deadlift": {
    what: "Hamstrings and glutes through a long range. This is what holds the sandbag lunge together at 80 m.",
    how: "Soft knees, hinge from the hip, bar grazing your thighs. Stop when your hamstrings say so, not when the bar reaches the floor.",
    pattern: "hinge", bw: 0.6,
  },
  "Kettlebell deadlift": {
    what: "The hinge pattern with less to learn than a barbell, and enough load to matter.",
    how: "Bell between your feet, hips back, flat back. Squeeze your glutes at the top.",
    pattern: "hinge", bw: 0.5,
  },
  "Single-leg RDL": {
    what: "A hinge and a balance problem at once, which is what running off a station actually is.",
    how: "One leg planted, the other straight behind you, hips level. Slow down, and do not let your hip rotate open.",
    pattern: "single_leg", bw: 0.2, perHand: true,
  },
  "Single-leg hip thrust": {
    what: "Glute strength with no equipment, and the one bodyweight movement that genuinely loads a hinge.",
    how: "Shoulders on a bench or the floor, one foot planted, other knee tucked. Two seconds at the top, ribs down.",
    pattern: "single_leg", bw: null,
  },
  "Front squat": {
    what: "A squat that will not let you lean forward, so it builds the upright position the sled push demands.",
    how: "Elbows high, bar on your shoulders not your hands. Knees track over toes, depth before load.",
    pattern: "squat", bw: 0.6,
  },
  "Back squat": {
    what: "The most load you can put through both legs, and the sled push is a squat pattern under load.",
    how: "Brace before you unrack, sit between your feet rather than back onto your heels, and drive evenly out of the bottom.",
    pattern: "squat", bw: 0.75,
  },
  "Goblet squat": {
    what: "A squat you cannot do badly, held in front so the load teaches the position.",
    how: "Bell at your chest, elbows inside your knees at the bottom. Sit down, not back.",
    pattern: "squat", bw: 0.25,
  },
  "Tempo squat": {
    what: "Bodyweight, made hard by time under tension instead of by load.",
    how: "Three seconds down, no pause, stand up fast. The slow part is the point.",
    pattern: "squat", bw: null,
  },
  "Rear-foot elevated split squat": {
    what: "The single hardest thing in this session and the most useful. Two hundred metres of sandbag lunges is where a Hyrox most often falls apart, and it is trained one leg at a time.",
    how: "Back foot on a bench, front shin vertical, back knee towards the floor. Weight in each hand, torso upright.",
    pattern: "single_leg", bw: 0.2, perHand: true,
  },
  "Weighted step-up": {
    what: "One leg lifting your whole bodyweight, which is what the lunge and every stair in the venue ask for.",
    how: "Box at knee height. Step up without pushing off the back foot, and lower under control rather than dropping.",
    pattern: "single_leg", bw: 0.2, perHand: true,
  },
  "Reverse lunge": {
    what: "The lunge pattern with less knee stress than a forward lunge, and the closest bodyweight match to the sandbag station.",
    how: "Step back, knee down light, front shin vertical. Push through the front foot to stand.",
    pattern: "single_leg", bw: null,
  },
  "Overhead press": {
    what: "Shoulders strong enough to hold a position for sixty minutes, and the pattern the wall ball throw finishes with.",
    how: "Brace your midline, press in a straight line past your face, finish with the bar over your ears.",
    pattern: "press", bw: 0.4,
  },
  "Kettlebell push press": {
    what: "Overhead strength with a small leg drive, which is what a wall ball is.",
    how: "Dip the knees, drive, then press. One arm at a time so neither side hides.",
    pattern: "press", bw: 0.15, perHand: true,
  },
  "Press-up": {
    what: "Upper-body pressing with nothing to carry, and the burpee broad jump is a hundred of these with a jump attached.",
    how: "Hands under your shoulders, body in one line, chest to the floor. Do not let your hips sag.",
    pattern: "press", bw: null,
  },
  "Pull-up": {
    what: "The strongest pulling movement there is, and pulling strength is what the sled pull and the rowing finish rely on.",
    how: "Full hang at the bottom, chest to the bar at the top. Bands or a partner are fine — half a rep is not.",
    pattern: "pull", bw: null,
  },
  "Bent-over row": {
    what: "The sled pull, rehearsed. Hand over hand on a rope is this movement repeated at speed.",
    how: "Hinge to about 45°, back flat, pull to your lower ribs. Elbows past your body, no shrugging.",
    pattern: "pull", bw: 0.5,
  },
  "Inverted row": {
    what: "Pulling strength using your own bodyweight, and the easiest place to build it from nothing.",
    how: "Bar at hip height, body straight, heels on the floor. Chest to the bar, squeeze at the top.",
    pattern: "pull", bw: null,
  },
  "Farmers carry": {
    what: "Two hundred metres of this is a station. Grip is the quality nobody trains until it costs them a race.",
    how: "As heavy as you can hold without setting it down. Tall posture, ribs down, breathe.",
    pattern: "carry", bw: 0.5,
  },
  "Suitcase carry": {
    what: "One-sided carrying, which is what the sled pull and every awkward station demand of your midline.",
    how: "One weight, one hand. Do not lean away from it — stay square and let your side work.",
    pattern: "carry", bw: 0.25, perHand: true,
  },
  "Dead hang": {
    what: "Grip endurance, directly. The carry, the pull and the sandbag all end when your hands do.",
    how: "Full hang, shoulders active rather than loose. Time it and beat it next week.",
    pattern: "grip", bw: null,
  },
  "Towel hang or heavy hold": {
    what: "Grip endurance without a rig. Harder than it sounds, and the same quality the carry needs.",
    how: "Towel over a bar, or the heaviest thing you can hold in each hand. Time it.",
    pattern: "grip", bw: null,
  },
  "Suitcase hold plank": {
    what: "Anti-rotation. The sled is one-sided and so is the carry, and this is what stops your torso giving way under them.",
    how: "Plank with a weight in one hand, or a weight beside you pulling you sideways. Stay square.",
    pattern: "core", bw: null,
  },
  "Hanging or dead-bug hollow": {
    what: "The position you hold on the SkiErg, protected. A midline that folds costs you every machine.",
    how: "Slow. Ribs to hips, lower back flat to the floor. Stop when the position goes rather than when the reps run out.",
    pattern: "core", bw: null,
  },
  "Calf raise": {
    what: "The sled push is a calf station and almost nobody trains it as one.",
    how: "Slow down, pause at the bottom stretch, up fast. One leg at a time once both are easy.",
    pattern: "calf", bw: 0.3,
  },
  "Kettlebell swing": {
    what: "A fast hinge, and the cheapest way to build the hamstring strength the lunge needs.",
    how: "Hips, not arms. The bell floats — you do not lift it. Snap your glutes at the top.",
    pattern: "hinge", bw: 0.2,
  },
  "Nordic or hamstring curl": {
    what: "Hamstrings under load in the position they actually tear in.",
    how: "Lower as slowly as you can, catch yourself, push back up. Two seconds is a good first target.",
    pattern: "single_leg", bw: null,
  },
  "Face pull or band row": {
    what: "Upper-back endurance, which is what holds your posture together on the ski and the row.",
    how: "Band at eye height, pull to your face, elbows high. Light, controlled, and never rushed.",
    pattern: "pull", bw: null,
  },

  /*
   * The substitutions, described like everything else.
   *
   * These are what a confirmed constraint puts in place of a lift somebody cannot do (see
   * ./constraints), which makes them the exercises an athlete is least likely to have met —
   * they arrive precisely because the familiar one was taken away. Leaving them out of here
   * meant the one lift needing an explanation was the one with no info button behind it.
   */
  "Split squat, short range": {
    what: "The single-leg strength a Hyrox lunge needs, taken only as deep as the knee allows. Range is the thing being managed, not load.",
    how: "Back foot on the floor behind you, chest tall. Go down until it is firm rather than sore, and stop there. The same depth every set.",
    pattern: "single_leg", bw: 0.15, perHand: true,
  },
  "Leg press or sled march": {
    what: "Heavy work through both legs with you choosing the range, which is what makes it usable when a squat is not. The sled push is a leg press you do standing up.",
    how: "Feet flat, push through the whole foot. Stop short of locking out, and never let your knees fall inwards.",
    pattern: "squat", bw: 1.2,
  },
  "Hip thrust": {
    what: "Glutes and hamstrings with the spine out of it — the posterior chain a hinge trains, loaded without loading the back.",
    how: "Shoulders on a bench, bar over your hips, chin tucked. Finish with your hips level, not arched past it.",
    pattern: "hinge", bw: 0.8,
  },
  "Floor press or press-up": {
    what: "Pressing strength with the shoulder kept out of the deep overhead position that a sore one dislikes.",
    how: "Elbows about 45 degrees from your body. On the floor the range stops itself, which is the point.",
    pattern: "press", bw: 0.5,
  },
  "Chest-supported row": {
    what: "The pulling work the row and the sled pull ask for, done with the shoulder supported so the position cannot drift.",
    how: "Chest against the bench, pull to your ribs rather than your chest. Shoulder blade moves, torso does not.",
    pattern: "pull", bw: 0.4, perHand: true,
  },
  "Seated calf raise": {
    what: "Calf strength taken off the achilles: seated puts the load through the muscle with the tendon under far less stretch. Two hundred metres of lunges and every metre of the sled is a calf station.",
    how: "Slow down, pause at the bottom without bouncing, drive up. Stop the set when the range shortens.",
    pattern: "calf", bw: 0.4,
  },
};

/** Names differ by kit; the description should not. Matched on the leading words. */
export function describe(name: string): Exercise | null {
  if (EXERCISES[name]) return EXERCISES[name];
  const key = Object.keys(EXERCISES).find(
    (k) => name.toLowerCase().startsWith(k.toLowerCase().split(" ")[0]),
  );
  return key ? EXERCISES[key] : null;
}

/**
 * Training age moves the whole table.
 *
 * A novice's first working set should be light enough that the third rep teaches them
 * the pattern rather than the load; an advanced athlete starting at a novice's number
 * wastes the block's first fortnight.
 */
const AGE_FACTOR: Record<string, number> = {
  novice: 0.72, beginner: 0.72, intermediate: 1, advanced: 1.15, elite: 1.25,
};

/** Reps move it too: a set of five is heavier than a set of twelve. */
const repFactor = (reps: number): number =>
  reps <= 5 ? 1.12 : reps <= 8 ? 1 : reps <= 12 ? 0.88 : 0.75;

/**
 * A starting load, in kilograms, or null where there is nothing honest to say.
 *
 * Rounded to 2.5 kg because that is what the plates come in, and floored at 5 kg per
 * hand for anything dumbbell-shaped. Null when there is no bodyweight on file — a
 * guess at bodyweight would make every number downstream a guess about a guess, and
 * the screen can ask for one instead.
 */
export function startingLoad(
  name: string, reps: number, bodyweightKg: number | null, trainingAge = "intermediate",
): number | null {
  const ex = describe(name);
  if (!ex || ex.bw === null || !bodyweightKg || bodyweightKg < 30) return null;
  const raw = bodyweightKg * ex.bw * (AGE_FACTOR[trainingAge] ?? 1) * repFactor(reps);
  const rounded = Math.round(raw / 2.5) * 2.5;
  return Math.max(ex.perHand ? 5 : 20, rounded);
}

/** How to say it, so nobody mistakes guidance for a prescription. */
export const loadNote = (perHand: boolean): string =>
  `A starting point from your bodyweight${perHand ? ", per hand" : ""} — not a target. `
  + "If the last rep of the first set is comfortable, put it up.";

/**
 * A strength session in one line: what it trains, then how much of it.
 *
 * The card was showing the first line of the prescription — "Back squat 3×8 rest 120s
 * rpe 7" — which describes one sixth of the session and reads, next to "3 lifts", as
 * though the whole thing were three sets of a squat. Naming the first exercise tells an
 * athlete nothing about whether they have twenty minutes of work ahead of them or fifty.
 *
 * What they want at a glance is what it does to them and how big it is.
 */
const PATTERN_WORD: Partial<Record<Pattern, string>> = {
  squat: "legs", hinge: "hinge", single_leg: "single-leg",
  press: "pressing", pull: "pulling", carry: "carries", grip: "grip",
  core: "core", calf: "calves",
};

export function summariseStrength(
  lifts: { name: string; sets: number; reps: number }[],
): string {
  if (lifts.length === 0) return "";
  const sets = lifts.reduce((n, l) => n + (l.sets || 0), 0);
  const size = `${lifts.length} exercises · ${sets} sets`;

  /*
   * The heavy movements only, and at most three of them.
   *
   * Every session ends with grip and core, so listing those adds nothing that
   * distinguishes one session from another — and a line naming all six patterns is a
   * list rather than a description.
   */
  const words: string[] = [];
  for (const l of lifts.slice(0, 4)) {
    const w = PATTERN_WORD[describe(l.name)?.pattern ?? "core"];
    if (w && !words.includes(w)) words.push(w);
  }
  const what = words.slice(0, 3);
  if (what.length === 0) return size;
  const said = what.length === 1
    ? what[0]
    : `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}`;
  return `${said.charAt(0).toUpperCase()}${said.slice(1)} · ${size}`;
}
