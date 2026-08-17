import type { Pattern } from "./exercises";
import type { Lift } from "./strength";

/**
 * Training around something, in the only vocabulary the plan can actually act in.
 *
 * The intake has always asked "anything to train around?" and the app has always been
 * honest that nothing read the answer — the profile screen says so out loud: "Nothing
 * parses it automatically, so an injury that should stop a session still needs saying out
 * loud." That is a fair warning and a bad feature. Somebody who writes "left knee is
 * rubbish on deep lunging" has told the plan something specific, and the plan kept
 * prescribing rear-foot elevated split squats.
 *
 * What makes this safe to act on is the shape of the vocabulary rather than the accuracy of
 * whatever read the sentence. A constraint can only ever REMOVE or SUBSTITUTE. There is no
 * constraint that adds a session, raises a volume, sets a pace or prescribes a rehab
 * exercise, because none of those are decisions to make from a sentence in a text box — and
 * a model that misreads "knee" as "hip" produces a different squat, not a training decision
 * nobody asked for.
 *
 * Two further rules, both deliberate:
 *
 *   Nothing applies until the athlete has confirmed it. A reading is a proposal shown back
 *   in their own words. Silently reshaping a block from a health note would be the app
 *   making a medical judgement it is not entitled to make.
 *
 *   Anything the vocabulary cannot express is surfaced, never dropped. "Sharp pain in my
 *   chest when I run hard" has no substitution — it has a doctor. The reading says so
 *   instead of quietly finding nothing to do.
 */

/** Everything the plan is able to do about a niggle. Nothing here adds work. */
export type TrainingConstraint = {
  /**
   * A movement pattern to keep out of the gym session, or a single named movement.
   *
   * Patterns are the useful unit most of the time — a knee that hates lunging hates every
   * single-leg lift, not just the one that got prescribed this week.
   */
  avoid_pattern?: Pattern;
  /** A named exercise or station, where the athlete was that specific. */
  avoid_movement?: string;
  /** The athlete's own words, so the confirmation screen quotes them rather than us. */
  quote: string;
  /** Why this follows from those words, in one line, in plain language. */
  because: string;
};

export type ConstraintReading = {
  constraints: TrainingConstraint[];
  /**
   * What was understood but cannot be acted on, said plainly.
   *
   * This is the part that keeps the feature honest. A plan that silently found nothing to
   * do about chest pain reads, to the person who typed it, exactly like a plan that took it
   * into account.
   */
  unactionable: { quote: string; why: string }[];
  /** Whether a model or the keyword reader produced this. */
  by: "model" | "words";
};

/** What is stored once the athlete has agreed to it. */
export type ConfirmedConstraints = {
  constraints: TrainingConstraint[];
  /** The text they were read from, so a changed note invalidates a stale reading. */
  source_text: string;
  confirmed_at: string;
};

/**
 * Substitutes, by pattern.
 *
 * A dropped lift is a worse session, not a safer one: taking out the single-leg work leaves
 * two hundred metres of race lunges untrained, which is the thing that ends races. So each
 * pattern names what trains the same quality with the offending demand removed — and where
 * nothing honestly does, it is dropped and said.
 */
const SUBSTITUTE: Partial<Record<Pattern, Lift>> = {
  single_leg: {
    name: "Split squat, short range", sets: 3, reps: 10, rest: 90,
    note: "Each leg, and only as deep as is comfortable. Stop where the knee complains.",
  },
  squat: {
    name: "Leg press or sled march", sets: 3, reps: 12, rest: 120,
    note: "The same load through the legs with the range you choose.",
  },
  hinge: {
    name: "Hip thrust", sets: 3, reps: 12, rest: 90,
    note: "Posterior chain with the back out of it.",
  },
  press: {
    name: "Floor press or press-up", sets: 3, reps: 12, rest: 90,
    note: "Pressing without going overhead.",
  },
  pull: {
    name: "Chest-supported row", sets: 3, reps: 12, rest: 90,
    note: "Pulling with the shoulder in a supported position.",
  },
  carry: {
    name: "Suitcase hold", sets: 3, reps: 30, rest: 60,
    note: "Seconds. Held rather than walked.",
  },
  calf: {
    name: "Seated calf raise", sets: 3, reps: 15, rest: 60,
    note: "Off the achilles, through the calf.",
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** Whether a constraint bites on a named movement. */
export function blocks(
  c: TrainingConstraint, name: string, pattern: Pattern | null,
): boolean {
  if (c.avoid_movement) {
    const a = norm(c.avoid_movement), b = norm(name);
    if (a && (b.includes(a) || a.includes(b))) return true;
  }
  return Boolean(c.avoid_pattern && pattern && c.avoid_pattern === pattern);
}

/**
 * The session, with what the athlete cannot do swapped out.
 *
 * Substituted rather than filtered, and the reason travels with the line: an athlete who
 * opens their session and finds the split squat gone should be able to see that it is gone
 * because of what they told us, not wonder whether the plan forgot.
 */
export function applyToLifts(
  lifts: Lift[], constraints: TrainingConstraint[],
  patternOf: (name: string) => Pattern | null,
): Lift[] {
  if (constraints.length === 0) return lifts;
  const out: Lift[] = [];
  for (const l of lifts) {
    const hit = constraints.find((c) => blocks(c, l.name, patternOf(l.name)));
    if (!hit) { out.push(l); continue; }

    const sub = hit.avoid_pattern ? SUBSTITUTE[hit.avoid_pattern] : null;
    /*
     * A named movement with no pattern behind it is dropped rather than guessed at. "No
     * burpees" is a clear instruction and inventing a burpee-shaped replacement for it is
     * not what was asked.
     */
    if (!sub) continue;
    /* One substitute per pattern, never two — the swap must not lengthen the session. */
    if (out.some((o) => o.name === sub.name)) continue;
    out.push({ ...sub, note: `${sub.note ?? ""} Swapped: you said ${hit.quote}.`.trim() });
  }
  return out;
}

/**
 * A station the athlete should not do, and what to say instead.
 *
 * Stations already have a substitution each, written for the athlete with no sled or no
 * kettlebells. A constraint reuses it: the reason changes from "you have none" to "you told
 * us not to", and the athlete still trains the round.
 */
export function stationBlocked(
  constraints: TrainingConstraint[], name: string,
): TrainingConstraint | null {
  return constraints.find((c) => blocks(c, name, null)) ?? null;
}

/**
 * What a pattern means to somebody who does not think in patterns.
 *
 * "Training around single_leg" is the plan talking to itself. Shared with the screen that
 * asks for confirmation so the words an athlete ticks are the words they later read on the
 * session — a substitution explained one way and displayed another reads as two features.
 */
export const PATTERN_SAYS: Record<string, string> = {
  single_leg: "single-leg work — lunges, split squats, step-ups",
  squat: "heavy double-leg work — squats",
  hinge: "hinging — deadlifts and RDLs",
  press: "pressing overhead",
  pull: "pulling — pull-ups and rows",
  carry: "loaded carries",
  calf: "calf work",
  grip: "hanging and grip work",
  core: "loaded core work",
};

/** The one thing a constraint keeps out, in the athlete's language. */
export const saysWhat = (c: TrainingConstraint): string =>
  c.avoid_movement ?? PATTERN_SAYS[c.avoid_pattern ?? ""] ?? c.avoid_pattern ?? "that";

/** One line for the session, so a confirmed constraint is visible rather than inferred. */
export function sayConstraints(cs: TrainingConstraint[]): string {
  if (cs.length === 0) return "";
  /* Only the first clause of each, or a six-exercise session grows a paragraph under it. */
  const what = cs.map((c) => saysWhat(c).split(" — ")[0]);
  return `Training around ${what.join(" and ")} — you can change this any time.`;
}
