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

export type Lift = {
  name: string; sets: number; reps: number; note?: string;
  /**
   * Seconds between sets, prescribed rather than guessed.
   *
   * The rest is part of the prescription: five heavy singles with ninety seconds
   * between them is a different session from the same five with three minutes. It
   * was being inferred from the rep count, so the timer counted down a number the
   * plan had never chosen — and an accessory got the same three minutes as the
   * heaviest set of the block.
   */
  rest: number;
};

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
const SCHEME: Record<PhaseName, {
  sets: number; reps: number; rest: number; note: string;
}> = {
  base: { sets: 3, reps: 8, rest: 120, note: "Leave two in the tank on every set. The point of these weeks is to be able to lift, not to prove you can." },
  build: { sets: 3, reps: 5, rest: 180, note: "Heaviest sets of the block. This is the phase that makes you stronger — everything after it maintains." },
  specific: { sets: 3, reps: 6, rest: 150, note: "Hold the load, drop the volume. Nothing here should cost you Sunday." },
  taper: { sets: 2, reps: 5, rest: 150, note: "Keep the pattern, drop the work. Nothing to prove this week." },
};

/** Accessories are not the session. Short rests, and out. */
const ACCESSORY_REST = 60;

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
  const heavy = { sets: s.sets, reps: s.reps, rest: s.rest };

  const hinge: Lift = kit.barbell
    ? { name: a ? "Trap bar deadlift" : "Romanian deadlift", ...heavy }
    : kit.kettlebells
      ? { name: a ? "Kettlebell deadlift" : "Single-leg RDL", ...heavy, reps: s.reps + 2 }
      : { name: "Single-leg hip thrust", sets: 3, reps: 12, rest: 90 };

  const squat: Lift = kit.barbell
    ? { name: a ? "Front squat" : "Back squat", ...heavy }
    : kit.kettlebells
      ? { name: "Goblet squat", ...heavy, reps: s.reps + 2 }
      : {
        name: "Tempo squat", sets: 3, reps: 15, rest: 90,
        note: "Three seconds down, no pause, stand up fast.",
      };

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
      sets: 3, reps: 8, rest: 120, note: "Each leg. Slow down, drive up.",
    }
    : { name: "Reverse lunge", sets: 3, reps: 12, rest: 90, note: "Each leg." };

  const press: Lift = kit.barbell
    ? { name: "Overhead press", sets: 3, reps: 8, rest: 120 }
    : kit.kettlebells
      ? { name: "Kettlebell push press", sets: 3, reps: 8, rest: 120, note: "Each arm." }
      : { name: "Press-up", sets: 3, reps: 12, rest: 90 };

  const pull: Lift = kit.rig
    ? { name: "Pull-up", sets: 3, reps: 6, rest: 120 }
    : kit.kettlebells
      ? { name: "Bent-over row", sets: 3, reps: 10, rest: 120 }
      : { name: "Inverted row", sets: 3, reps: 10, rest: 90 };

  /*
   * Grip and core, on the end, at low effort.
   *
   * The farmers carry, the sled pull and the sandbag all end when the hands do, and
   * grip is the one quality nobody trains until it costs them a race. It sits with
   * the accessories because it does not need to be fresh — it needs to be done.
   */
  const grip: Lift = kit.kettlebells
    ? {
      name: a ? "Farmers carry" : "Suitcase carry",
      sets: 3, reps: 40, rest: ACCESSORY_REST,
      note: "Metres, not reps — 40 m a set, as heavy as you can hold without setting it down.",
    }
    : kit.rig
      ? { name: "Dead hang", sets: 3, reps: 30, rest: ACCESSORY_REST, note: "Seconds, not reps." }
      : { name: "Towel hang or heavy hold", sets: 3, reps: 30, rest: ACCESSORY_REST, note: "Seconds, not reps." };

  const core: Lift = a
    ? {
      name: "Suitcase hold plank", sets: 3, reps: 40, rest: ACCESSORY_REST,
      note: "Seconds. Anti-rotation — the sled is one-sided and so is the carry.",
    }
    : {
      name: "Hanging or dead-bug hollow", sets: 3, reps: 12, rest: ACCESSORY_REST,
      note: "Slow. It is the position you hold on the ski that this protects.",
    };

  /*
   * Four heavy movements, then two accessories.
   *
   * Both lower lifts every session, because the race is a leg event: the sled and
   * the lunge take more out of an athlete than everything above the waist put
   * together. Which upper lift alternates so the block is not the same six
   * exercises for fifteen weeks.
   */
  return a
    ? [hinge, singleLeg, pull, squat, grip, core]
    : [squat, singleLeg, press, hinge, grip, core];
}

/** The lifts as the app's strength syntax, one per line. */
export function strengthTarget(phase: PhaseName, week: number, kit: Kit): string {
  return liftsFor(phase, week, kit)
    .map((l) => `${l.name} ${l.sets}x${l.reps} rest ${l.rest}s`)
    .join("\n");
}

/** What to say about the session as a whole. */
export const strengthNote = (phase: PhaseName): string =>
  (SCHEME[phase] ?? SCHEME.base).note;
