/**
 * How far the athlete has nudged their weekly volume, as a multiplier.
 *
 * Pure, and in `lib/plan/` rather than beside the code that stores it, because the
 * generator reads it and the generator is imported by client components. Keeping it next
 * to `volume-apply.ts` — which opens a database connection — dragged `postgres` into the
 * browser bundle and broke the build with "Can't resolve 'net'".
 */

/** Five per cent a step, two steps either way. */
export const STEP = 0.05;
export const MAX_STEPS = 2;

export const dialFor = (steps: number): number =>
  1 + STEP * Math.max(-MAX_STEPS, Math.min(MAX_STEPS, steps));
