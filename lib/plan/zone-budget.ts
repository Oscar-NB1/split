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

/**
 * Which race-specific session a phase should be doing, and how often.
 *
 * The rung came off a ladder that climbed by week, so the *kind* of session was decided
 * by arithmetic rather than by what the weeks were for: transitions turned up in the base
 * phase because the counter had reached them, and compromised running kept appearing in
 * the specific weeks because the alternation sent it there.
 *
 * Each of the four trains something different and each belongs somewhere:
 *
 *   base      almost all compromised running. The skill being learned is running on
 *             wrecked legs, and it is the foundation the other three stand on. No
 *             simulations: there is nothing yet to simulate.
 *   build     compromised running still leads, transitions arrive. Changeover speed is
 *             worth practising once the running off a station is not itself the problem.
 *   specific  transitions lead and the first simulations appear. The work is now shaped
 *             like race day rather than like the qualities race day needs.
 *   taper     one half simulation at most, and only early in the phase. A full one
 *             inside three weeks of a race costs more than it teaches.
 */
/*
 * No simulations in the mix, deliberately.
 *
 * A full simulation needs eight stations at race weight, a kilometre of running between
 * each, two hours and usually a venue — and most people will not do one, which means
 * prescribing it produces a week with a hole in it every time. A session an athlete
 * reliably skips is worse than no session: it teaches them that the plan does not know
 * what their life looks like, and once they believe that they start skipping the
 * sessions that mattered.
 *
 * So the scheduled work is the two an athlete can actually do in a normal gym, and the
 * simulation becomes a suggestion attached to the weeks that could carry one — see
 * `simulationWindow`. If they do it, it replaces that week's Hyrox session; if they do
 * not, the week was always complete.
 */
export const HYROX_MIX: Record<PhaseName, Record<string, number>> = {
  base:     { compromised: 0.85, transitions: 0.15 },
  build:    { compromised: 0.60, transitions: 0.40 },
  specific: { compromised: 0.45, transitions: 0.55 },
  taper:    { compromised: 0.60, transitions: 0.40 },
};

/**
 * Whether this week could carry a simulation, and what to say about it.
 *
 * A suggestion, not a session. The weeks that can hold one are specific enough to be
 * worth naming: far enough into the block that there is something to simulate, not a
 * down week, and clear of the race by enough that a two-hour effort still pays for
 * itself. Everything else gets nothing rather than a vague encouragement.
 */
export function simulationWindow(
  phase: PhaseName, weeksToRace: number, isDown: boolean,
): { kind: "half" | "full"; why: string } | null {
  if (isDown || phase === "base") return null;
  /*
   * Nothing inside three weeks. A full simulation is a race, and racing three weeks out
   * costs more than it teaches — which is the one thing the taper exists to protect.
   */
  if (weeksToRace <= 3) return null;
  if (phase === "specific" && weeksToRace >= 4 && weeksToRace <= 6) {
    return {
      kind: "full",
      why: "This is the week for a full simulation if you are going to do one — far enough out to recover from it, close enough that the numbers still describe race day. All eight stations at race weight, 1 km between each, and record every split.",
    };
  }
  if (phase === "build" || phase === "specific") {
    return {
      kind: "half",
      why: "A good week for a half simulation: four stations in race order at race weight with 1 km runs between them. Worth doing instead of this week's Hyrox session rather than as well as it.",
    };
  }
  return null;
}

const HYROX_LABEL: Record<string, string> = {
  compromised: "compromised running",
  transitions: "transitions",
  half: "half simulation",
  full: "full simulation",
};

/**
 * The session for one week, chosen deterministically from the phase's mix.
 *
 * Largest remainder over a cycle of ten, cycled by the week within the phase — the same
 * method the ladder mix uses, so the same input always produces the same plan and a
 * phase of four weeks at 55/35/10 gives two, one and one rather than whatever a draw
 * happens to produce.
 */
export function hyroxKindFor(
  phase: PhaseName, weekInPhase: number, canSimulate = true,
): string {
  const mix = Object.entries(HYROX_MIX[phase] ?? HYROX_MIX.base)
    .filter(([k, w]) => w > 0 && (canSimulate || (k !== "half" && k !== "full")));
  if (mix.length === 0) return HYROX_LABEL.compromised;

  const total = mix.reduce((n, [, w]) => n + w, 0);
  const size = 10;
  const counts = mix.map(([k, w]) => [k, (w / total) * size] as [string, number]);
  const whole = counts.map(([k, n]) => [k, Math.floor(n)] as [string, number]);
  let placed = whole.reduce((n, [, c]) => n + c, 0);
  const remainders = counts
    .map(([, n], i) => [i, n - Math.floor(n)] as [number, number])
    .sort((a, b) => b[1] - a[1]);
  for (let i = 0; placed < size; i += 1, placed += 1) {
    whole[remainders[i % remainders.length][0]][1] += 1;
  }
  const cycle: string[] = [];
  whole.forEach(([k, n]) => { for (let i = 0; i < n; i += 1) cycle.push(k); });
  return HYROX_LABEL[cycle[weekInPhase % cycle.length]] ?? HYROX_LABEL.compromised;
}
