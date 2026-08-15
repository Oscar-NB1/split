import { diffDays } from "../dates";

/**
 * Server-side intake validation, before anything is persisted.
 *
 * The backend never silently corrects an athlete's answer. It rejects what
 * cannot be true, accepts what can, and flags the consequence of anything that
 * reshapes the plan — because the consequence is the part they can act on.
 */

export type Absence = {
  from_date: string; to_date: string;
  type: "no_training" | "some_access" | "normal";
};

export type Problem = { field: string; why: string };
export type Flag = { code: string; message: string };

export type IntakeCheck = {
  start_date: string;
  race_date: string | null;
  absences: Absence[];
  target_sessions: number;
  available_days: number[];
  allow_doubles: boolean;
  kit: string[];
  run_attachment: string;
};

/** An absence that reaches into the last three weeks reshapes the block. */
export const PROXIMITY_WEEKS = 3;

/** Overlapping ranges merge rather than being counted twice. */
export function mergeAbsences(list: Absence[]): { merged: Absence[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const sorted = [...list]
    .filter((a) => a.from_date && a.to_date)
    .sort((a, b) => a.from_date.localeCompare(b.from_date));

  const merged: Absence[] = [];
  for (const a of sorted) {
    if (a.to_date < a.from_date) {
      problems.push({ field: "absences", why: `${a.from_date} to ${a.to_date} ends before it starts.` });
      continue;
    }
    const last = merged[merged.length - 1];
    if (last && a.from_date <= last.to_date) {
      // Same type merges silently; different types are a clash worth naming,
      // because "no training" and "training as normal" cannot both be true.
      if (last.type !== a.type) {
        problems.push({
          field: "absences",
          why: `${a.from_date}–${a.to_date} overlaps ${last.from_date}–${last.to_date}, and they say different things about training.`,
        });
        continue;
      }
      last.to_date = a.to_date > last.to_date ? a.to_date : last.to_date;
      continue;
    }
    merged.push({ ...a });
  }
  return { merged, problems };
}

export function checkIntake(x: IntakeCheck): { problems: Problem[]; flags: Flag[]; absences: Absence[] } {
  const problems: Problem[] = [];
  const flags: Flag[] = [];

  if (x.race_date && x.race_date < x.start_date) {
    problems.push({ field: "start_date", why: "The block starts after the race." });
  }

  const { merged, problems: clashes } = mergeAbsences(x.absences);
  problems.push(...clashes);

  const absences: Absence[] = [];
  for (const a of merged) {
    // A trip past race day is truncated, not rejected: the part before the race
    // is real and the part after does not concern this block.
    let to = a.to_date;
    if (x.race_date && to > x.race_date) {
      to = x.race_date;
      flags.push({
        code: "absence_truncated",
        message: `Your time away runs past race day; only the part before it affects the plan.`,
      });
    }
    if (x.race_date && a.from_date > x.race_date) continue;
    absences.push({ ...a, to_date: to });

    if (x.race_date) {
      const out = diffDays(x.race_date, a.from_date);
      if (out <= PROXIMITY_WEEKS * 7 && a.type !== "normal") {
        flags.push({
          code: "absence_near_race",
          message:
            "That time away lands inside the last three weeks. It changes the shape of the block rather than one week's volume — the taper moves with it.",
        });
      }
    }
  }

  if (x.target_sessions > x.available_days.length && !x.allow_doubles) {
    problems.push({
      field: "target_sessions",
      why: `${x.target_sessions} sessions across ${x.available_days.length} days needs doubles turned on.`,
    });
  }

  if (x.kit.includes("light_sled") && !x.kit.includes("race_weight_sled")) {
    flags.push({
      code: "light_sled_only",
      message:
        "You only have a lighter sled, so race day would be the first time you meet race weight.",
    });
  }
  if (x.run_attachment === "separate") {
    flags.push({
      code: "runs_separate",
      message:
        "Your runs and stations are in different places, so transitions need dedicated facility sessions in the specific phase.",
    });
  }

  return { problems, flags, absences };
}

/**
 * What an absence does to a week.
 *
 * "Training as normal" deliberately does not consume a down week — someone who
 * keeps training on a work trip has not had a recovery week, and treating it as
 * one would quietly remove a real deload from the block.
 */
export const ABSENCE_EFFECT = {
  no_training: { volume: 0.35, consumesDeload: true },
  some_access: { volume: 0.60, consumesDeload: true },
  normal: { volume: 1.0, consumesDeload: false },
} as const;

/** Days away before coming back needs its own ramp. */
export const RE_ENTRY_DAYS = 10;
export const RE_ENTRY_CUT = 0.6; // −40% of the pre-trip level

/**
 * Coming back.
 *
 * Any real absence of ten days or more inserts a return week at 60% of where
 * they were, ramping back over two. Resuming at full volume after two weeks off
 * is where the injuries are, and it is independent of whatever the trip week
 * itself was cut to.
 */
export function needsReEntry(a: Absence): boolean {
  if (a.type === "normal") return false;
  return diffDays(a.to_date, a.from_date) + 1 >= RE_ENTRY_DAYS;
}
