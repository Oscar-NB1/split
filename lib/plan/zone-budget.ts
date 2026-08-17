import type { PhaseName } from "./skeleton";
import type { RunningBase } from "./resolve";
import type { LadderId } from "./ladders";

/**
 * Stage 5a: how much of each intensity a phase is for.
 *
 * The mix of quality sessions used to be four typed proportions per phase, and they
 * disagreed with the sentence written directly above them. The comment said "L5 is
 * maintenance and never a focus"; the table gave L5 **forty per cent of the base
 * phase** — two of every five quality sessions in the first month spent on 200s and
 * strides, for an event whose shortest effort is a kilometre. Nobody chose that. It
 * is what happens when the distribution is typed as ladder shares instead of derived
 * from what the phase is trying to do.
 *
 * So the intensity distribution is stated here, once, in the only terms it can be
 * argued about — how much of the hard work sits in each zone — and the ladder mix is
 * derived from it. Change what a phase is for and the sessions follow; you cannot
 * change one without the other any more.
 *
 *   Z3  threshold, the pace you could hold for an hour. The engine's ceiling, and
 *       the thing a 60-minute event is mostly decided by.
 *   Z4  critical velocity and race pace. What the race actually asks for.
 *   Z5  above it. Neuromuscular, and deliberately almost absent: a Hyrox has no
 *       sprint in it, the shortest run is a kilometre, and the top end an athlete
 *       needs is bought by the strides in every quality warm-up rather than by
 *       spending one of two weekly hard sessions on it.
 *   race  compromised running, transitions, simulations. Only once the block is
 *         race-shaped, and only for athletes who can reach the stations.
 */

export type Zone = "z3" | "z4" | "z5" | "race";

/**
 * The share of hard work in each zone, by phase.
 *
 * Reading across a row is the phase's argument for itself:
 *
 *   base      build the ceiling. Threshold-led, a quarter at race pace so the
 *             prescription is not a stranger by the time it matters, no top end.
 *   build     the tilt to race pace. This is where the fitness is made, and it is
 *             the only phase with any Z5 in it at all.
 *   specific  race-shaped. Race pace and station work between them take three
 *             quarters; threshold holds what was built rather than adding to it.
 *   taper     race pace and nothing new. A taper is rehearsal.
 */
export const ZONE_BUDGET: Record<PhaseName, Record<Zone, number>> = {
  base:     { z3: 0.75, z4: 0.25, z5: 0.00, race: 0.00 },
  build:    { z3: 0.40, z4: 0.50, z5: 0.10, race: 0.00 },
  specific: { z3: 0.20, z4: 0.45, z5: 0.05, race: 0.30 },
  taper:    { z3: 0.10, z4: 0.65, z5: 0.05, race: 0.20 },
};

/** Which ladder serves each zone. */
export const LADDER_FOR_ZONE: Record<Zone, LadderId> = {
  z3: "L3", z4: "L4", z5: "L5", race: "L6",
};

/**
 * Nobody gets prescribed a zone they cannot execute.
 *
 * An athlete who cannot yet run five kilometres without stopping has no threshold
 * session to do: the honest first block is continuous aerobic running and run/walk,
 * which is what L1 and L2 are. The budget above describes an athlete who can run;
 * this is the door they come through first.
 *
 * The old table had no L1 or L2 in it at any phase, so a `doesnt_run` athlete's
 * quality slot drew from the threshold ladder and their entry rung fell through to
 * zero — "2 × 8 min" at threshold, in week one, for somebody who does not run.
 */
const BEGINNER: Record<string, Partial<Record<LadderId, number>>> = {
  doesnt_run:  { L1: 0.70, L2: 0.30 },
  walk_breaks: { L1: 0.40, L2: 0.40, L3: 0.20 },
};

/**
 * The ladder mix for a phase, derived.
 *
 * `stations` gates the race-specific ladder — an athlete training in a field with a
 * sandbag cannot do a simulation — and its share is handed back to race pace rather
 * than spread around, because that is the closest thing to it they can execute.
 */
export function ladderMix(
  phase: PhaseName, base: RunningBase, stations: boolean,
  /**
   * Whether the caller is choosing the *running* session or the whole week.
   *
   * The budget describes all of a week's hard work, and the race share of it is
   * delivered by the Hyrox session — which the allocator has already put in the week
   * as a slot of its own. Handing that share to the quality-run slot as well meant
   * roughly three in ten race-specific weeks prescribed "Compromised running" as the
   * interval session too: the same session twice, on consecutive days, which is
   * exactly the fault the hard-day rules were written to stop.
   *
   * So a running slot draws from the running zones and the race share is
   * renormalised away rather than converted into more race pace — the Hyrox session
   * is already spending it.
   */
  forRunningSlot = false,
): Partial<Record<LadderId, number>> {
  const beginner = BEGINNER[base];
  if (beginner) {
    /*
     * A beginner's phases differ in volume, not in kind.
     *
     * Every phase gives them the same two ladders, because the thing that changes
     * across a first block is how long they can run for — not which zone they are
     * running in. Tilting a base-phase non-runner towards race pace would be
     * prescribing an intensity to somebody still buying the ability to be out there.
     */
    return beginner;
  }

  const budget = ZONE_BUDGET[phase] ?? ZONE_BUDGET.base;
  const out: Partial<Record<LadderId, number>> = {};
  for (const [zone, share] of Object.entries(budget) as [Zone, number][]) {
    if (share <= 0) continue;
    if (zone === "race") {
      // Nowhere to put it: a running slot leaves it to the Hyrox session, and an
      // athlete with no stations gets it as race pace, which is the nearest thing
      // to a simulation they can execute.
      if (forRunningSlot) continue;
      out[stations ? "L6" : "L4"] = (out[stations ? "L6" : "L4"] ?? 0) + share;
      continue;
    }
    const ladder = LADDER_FOR_ZONE[zone];
    out[ladder] = (out[ladder] ?? 0) + share;
  }
  return out;
}

/**
 * What share of the hard work this phase puts above race pace.
 *
 * Exported so the validator can assert on it rather than on a ladder name: the
 * claim worth defending is "almost no Z5, and none of it outside the build weeks",
 * and that claim should survive somebody renaming a ladder.
 */
export const z5Share = (phase: PhaseName): number => ZONE_BUDGET[phase]?.z5 ?? 0;
