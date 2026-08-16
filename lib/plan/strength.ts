import type { PhaseName } from "./skeleton";

/**
 * What to lift, and how much of it.
 *
 * Strength sessions were being written with a name, a duration and nothing else, so
 * the screen said "no lifts prescribed for this one" above a session the plan had
 * put in the week and told the athlete to protect. A strength day with no lifts is
 * not a strength day.
 *
 * The lifts are chosen for what a Hyrox costs the body — hinge, squat, carry, push,
 * pull — and written in the format the app already parses ("Trap bar deadlift 3x5 @
 * 105"), so the set logger fills itself in.
 *
 * Loads are relative and unstated where nothing has been measured. A prescribed
 * number nobody has earned is worse than an instruction to work to a hard set: the
 * athlete would either chase it or ignore it, and both are worse than the truth.
 */

export type Lift = { name: string; sets: number; reps: number; note?: string };

/** Only what the athlete said they can reach. */
export type Kit = {
  barbell: boolean;
  kettlebells: boolean;
  sled: boolean;
  rig: boolean;
  sandbag: boolean;
  wallBalls: boolean;
};

export function kitFrom(equipment: string[] = []): Kit {
  const has = (s: string) => equipment.some((e) => e.toLowerCase().includes(s));
  return {
    barbell: has("barbell"),
    kettlebells: has("kettlebell"),
    sled: has("sled"),
    rig: has("rig") || has("pull-up"),
    sandbag: has("sandbag"),
    wallBalls: has("wall ball"),
  };
}

/**
 * The scheme, by phase.
 *
 * Base builds the capacity to lift at all; build takes it heavy; specific stops
 * chasing load and starts rehearsing the positions the race asks for; the taper
 * keeps the pattern and drops the volume.
 */
const SCHEME: Record<PhaseName, { sets: number; reps: number; note: string }> = {
  base: { sets: 3, reps: 8, note: "Leave two in the tank on every set." },
  build: { sets: 4, reps: 5, note: "Heaviest set of the week, and it should feel like it." },
  specific: { sets: 3, reps: 6, note: "Race positions under load. Speed of the bar matters more than the number on it." },
  taper: { sets: 2, reps: 5, note: "Keep the pattern, drop the work. Nothing to prove this week." },
};

/**
 * A session's lifts.
 *
 * Two of them alternate week to week so the block is not the same three exercises
 * for fifteen weeks — the A day leads with the hinge, the B day with the squat.
 */
export function liftsFor(phase: PhaseName, week: number, kit: Kit): Lift[] {
  const s = SCHEME[phase] ?? SCHEME.base;
  const a = week % 2 === 1;

  const main: Lift = kit.barbell
    ? a
      ? { name: "Trap bar deadlift", sets: s.sets, reps: s.reps }
      : { name: "Back squat", sets: s.sets, reps: s.reps }
    : kit.kettlebells
      ? a
        ? { name: "Kettlebell deadlift", sets: s.sets, reps: s.reps + 2 }
        : { name: "Goblet squat", sets: s.sets, reps: s.reps + 2 }
      : a
        ? { name: "Split squat", sets: s.sets, reps: s.reps + 4 }
        : { name: "Step-up", sets: s.sets, reps: s.reps + 4 };

  const carry: Lift = kit.sandbag
    ? { name: "Sandbag lunge", sets: 3, reps: 20, note: "Metres, not reps — 20 m a set." }
    : kit.kettlebells
      ? { name: "Farmers carry", sets: 3, reps: 40, note: "Metres, not reps — 40 m a set." }
      : { name: "Suitcase carry", sets: 3, reps: 40, note: "Metres, not reps — 40 m a set." };

  const push: Lift = kit.barbell
    ? { name: "Overhead press", sets: 3, reps: 8 }
    : { name: "Press-up", sets: 3, reps: 12 };

  const pull: Lift = kit.rig
    ? { name: "Pull-up", sets: 3, reps: 6 }
    : kit.kettlebells
      ? { name: "Bent-over row", sets: 3, reps: 10 }
      : { name: "Inverted row", sets: 3, reps: 10 };

  // The wall ball is a station, not a lift, and it belongs where it is trained.
  const accessory: Lift = kit.wallBalls
    ? { name: "Wall balls", sets: 3, reps: 15 }
    : { name: "Hip thrust", sets: 3, reps: 12 };

  return a ? [main, carry, pull, accessory] : [main, push, carry, accessory];
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
