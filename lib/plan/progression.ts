/**
 * Next week's load, from what happened last week.
 *
 * The load was pre-filled from the last session and left there, so an athlete who
 * squatted 100 kg for three easy sets was offered 100 kg again the following week,
 * and the week after, and the week after that. A strength block that does not add
 * weight is not a strength block — it is the same session repeated for fifteen weeks
 * while the running gets harder around it.
 *
 * Double progression, which is what a coach actually does: hit every prescribed rep at
 * or under the target effort and the weight goes up next week; miss reps and it stays;
 * grind the last set well past the target and it comes down. Nothing here needs a
 * percentage table or a one-rep max, both of which are guesses about a stranger.
 */

export type LoggedSet = {
  load_kg: number | null;
  reps: number | null;
  prescribed_reps: number | null;
  done: boolean;
  /** the athlete's own effort report for the set, where they gave one */
  rpe: number | null;
};

export type Step = {
  /** the load to offer next time, or null where there is nothing to go on */
  load: number | null;
  /** what changed, for the line under the number */
  verdict: "up" | "hold" | "down" | "unknown";
  why: string;
};

/**
 * How much to add, by how heavy the movement is.
 *
 * A deadlift takes 5 kg without noticing; adding 5 kg to a 12 kg lateral raise is a
 * forty per cent jump. Proportional, floored at the smallest plate pair anybody owns.
 */
export function increment(load: number): number {
  if (load >= 100) return 5;
  if (load >= 40) return 2.5;
  return 2.5;
}

/**
 * The next load for one exercise.
 *
 * `target` is the prescribed RPE. The session's own sets are the evidence, and the
 * rules are applied in order of how much they should worry us: an abandoned session
 * first, then reps missed, then effort, then success.
 */
export function nextLoad(sets: LoggedSet[], target = 7): Step {
  const logged = sets.filter((s) => s.load_kg != null && s.load_kg > 0);
  if (logged.length === 0) {
    return { load: null, verdict: "unknown", why: "Nothing logged for this one yet." };
  }

  // The working load is the heaviest they actually used, not an average of warm-ups.
  const load = Math.max(...logged.map((s) => s.load_kg as number));
  const completed = logged.filter((s) => s.done);
  const efforts = logged.map((s) => s.rpe).filter((r): r is number => r != null);
  const hardest = efforts.length ? Math.max(...efforts) : null;

  /*
   * A session that was not finished is not evidence about the load.
   *
   * Half a session usually means half an hour, not a weight that was too heavy, and
   * adding weight to a session somebody ran out of time for is the fastest way to make
   * them stop logging.
   */
  if (completed.length < Math.max(1, Math.ceil(logged.length * 0.6))) {
    return {
      load, verdict: "hold",
      why: "Last week's session was not finished, so the load stays where it was.",
    };
  }

  const missed = completed.some((s) =>
    s.prescribed_reps != null && s.reps != null && s.reps < s.prescribed_reps);
  if (missed) {
    return {
      load, verdict: "hold",
      why: "You came up short on reps last week. Same weight — get all of them this time.",
    };
  }

  /*
   * Effort outranks completion.
   *
   * Finishing every rep at RPE 10 is not a session to add weight to: they got through
   * it, and the next thing that happens if we go up is a missed rep or a bad one.
   */
  if (hardest != null && hardest >= target + 2) {
    const down = Math.max(increment(load), Math.round((load * 0.05) / 2.5) * 2.5);
    return {
      load: Math.max(increment(load), load - down), verdict: "down",
      why: `You took that to RPE ${hardest} against a target of ${target}. Back it off and earn it again.`,
    };
  }
  if (hardest != null && hardest > target) {
    return {
      load, verdict: "hold",
      why: `RPE ${hardest} last week against a target of ${target} — hold here until it feels like ${target}.`,
    };
  }

  /*
   * Every rep, at or under the target: add weight.
   *
   * Two increments where it was genuinely easy, because an athlete who finished three
   * sets of eight at RPE 5 is two weeks behind where they should be and one increment
   * will not catch them up.
   */
  const step = increment(load);
  const easy = hardest != null && hardest <= target - 2;
  return {
    load: load + (easy ? step * 2 : step),
    verdict: "up",
    why: easy
      ? `All reps at RPE ${hardest} — that was too light, so it goes up ${step * 2} kg.`
      : `All reps completed last week. Up ${step} kg.`,
  };
}
