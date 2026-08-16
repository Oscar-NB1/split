import type { PhaseName } from "./skeleton";

/**
 * The strength session: what a Hyrox actually costs the body, lifted.
 *
 * It used to prescribe wall balls and sandbag lunges, which are not strength work —
 * they are stations. Doing them here spends the one session a week that can make an
 * athlete stronger on rehearsing movements the Hyrox session already rehearses, and
 * leaves the thing that limits the sled, the lunge and the carry untrained.
 *
 * What a Hyrox demands of the gym, in order:
 *
 *   double-leg strength   the sled push and pull are a squat pattern under load
 *   single-leg strength   200 m of lunges is the most common place a race falls
 *                         apart, and it is trained one leg at a time
 *   posterior chain       everything heavy is a hinge
 *   grip                  the farmers carry, the sled pull and the sandbag all end
 *                         when the hands do
 *   push and pull         the ski and the row, and enough upper body to hold a
 *                         position for sixty minutes
 *
 * Loads are relative and unstated. A prescribed number nobody has earned is worse
 * than an instruction to work to a hard set.
 */

export type Lift = { name: string; sets: number; reps: number; note?: string };

/** Only what the athlete said they can reach. */
export type Kit = {
  barbell: boolean;
  kettlebells: boolean;
  rig: boolean;
  sled: boolean;
};

export function kitFrom(equipment: string[] = []): Kit {
  const has = (s: string) => equipment.some((e) => e.toLowerCase().includes(s));
  return {
    barbell: has("barbell"),
    kettlebells: has("kettlebell"),
    rig: has("rig") || has("pull-up"),
    sled: has("sled"),
  };
}

/**
 * The scheme, by phase.
 *
 * Base builds the capacity to lift at all; build takes it heavy, because that is
 * where strength is actually made; specific stops chasing load and holds it while
 * the running turns race-shaped; the taper keeps the pattern and drops the work.
 */
const SCHEME: Record<PhaseName, { sets: number; reps: number; note: string }> = {
  base: { sets: 3, reps: 8, note: "Leave two in the tank on every set. The point of these weeks is to be able to lift, not to prove you can." },
  build: { sets: 4, reps: 5, note: "Heaviest sets of the block. This is the phase that makes you stronger — everything after it maintains." },
  specific: { sets: 3, reps: 6, note: "Hold the load, drop the volume. Nothing here should cost you Sunday." },
  taper: { sets: 2, reps: 5, note: "Keep the pattern, drop the work. Nothing to prove this week." },
};

/**
 * One session's lifts.
 *
 * Two days alternate so the block is not the same four exercises for fifteen weeks:
 * the A day leads with a hinge and pulls, the B day with a squat and presses. Both
 * carry single-leg work and grip, because both are what the race takes.
 */
export function liftsFor(phase: PhaseName, week: number, kit: Kit): Lift[] {
  const s = SCHEME[phase] ?? SCHEME.base;
  const a = week % 2 === 1;

  const hinge: Lift = kit.barbell
    ? { name: a ? "Trap bar deadlift" : "Romanian deadlift", sets: s.sets, reps: s.reps }
    : kit.kettlebells
      ? { name: a ? "Kettlebell deadlift" : "Single-leg RDL", sets: s.sets, reps: s.reps + 2 }
      : { name: "Single-leg hip thrust", sets: 3, reps: 12 };

  const squat: Lift = kit.barbell
    ? { name: a ? "Front squat" : "Back squat", sets: s.sets, reps: s.reps }
    : kit.kettlebells
      ? { name: "Goblet squat", sets: s.sets, reps: s.reps + 2 }
      : { name: "Tempo squat", sets: 3, reps: 15, note: "Three seconds down, no pause, stand up fast." };

  /*
   * The single-leg lift is not optional.
   *
   * Two hundred metres of lunges is where a Hyrox most often comes apart, and it is
   * not trained by squatting: the demand is one leg at a time, under load, for
   * longer than feels reasonable.
   */
  const singleLeg: Lift = kit.barbell || kit.kettlebells
    ? {
      name: a ? "Rear-foot elevated split squat" : "Weighted step-up",
      sets: 3, reps: 8, note: "Each leg. Slow down, drive up.",
    }
    : { name: "Reverse lunge", sets: 3, reps: 12, note: "Each leg." };

  /*
   * Grip, deliberately last and deliberately heavy.
   *
   * The farmers carry, the sled pull and the sandbag all end when the hands do, and
   * grip is the one quality nobody trains until it costs them a race.
   */
  const grip: Lift = kit.kettlebells
    ? {
      name: a ? "Farmers carry" : "Suitcase carry",
      sets: 4, reps: 40,
      note: "Metres, not reps — 40 m a set, as heavy as you can hold without setting it down.",
    }
    : kit.rig
      ? { name: "Dead hang", sets: 4, reps: 30, note: "Seconds, not reps. Stop before the grip fails." }
      : { name: "Towel hang or heavy hold", sets: 4, reps: 30, note: "Seconds, not reps." };

  const press: Lift = kit.barbell
    ? { name: "Overhead press", sets: 3, reps: 8 }
    : kit.kettlebells
      ? { name: "Kettlebell push press", sets: 3, reps: 8, note: "Each arm." }
      : { name: "Press-up", sets: 3, reps: 12 };

  const pull: Lift = kit.rig
    ? { name: "Pull-up", sets: 3, reps: 6 }
    : kit.kettlebells
      ? { name: "Bent-over row", sets: 3, reps: 10 }
      : { name: "Inverted row", sets: 3, reps: 10 };

  // Four movements and grip: any more and it stops being a session anyone finishes
  // on a day that also holds a run.
  return a
    ? [hinge, singleLeg, pull, grip]
    : [squat, singleLeg, press, grip];
}

/** The lifts as the app's strength syntax, one per line. */
export function strengthTarget(phase: PhaseName, week: number, kit: Kit): string {
  return liftsFor(phase, week, kit)
    .map((l) => `${l.name} ${l.sets}x${l.reps}`)
    .join("\n");
}

/** What to say about the session as a whole. */
export const strengthNote = (phase: PhaseName): string =>
  (SCHEME[phase] ?? SCHEME.base).note;
