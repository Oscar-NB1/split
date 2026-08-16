import type { RunningBase } from "./resolve";
import type { PhaseName } from "./skeleton";

/**
 * Stage 5: what the quality session actually is, week by week.
 *
 * Six ladders by stimulus rather than one list of workouts. An athlete enters
 * each at the rung their running supports and climbs about one a week, capped
 * by the phase — so the session gets harder because they got fitter, not
 * because the calendar moved.
 */

export const LADDER = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
export type LadderId = (typeof LADDER)[number];

export type Rung = { label: string; rung: number };

export const LADDERS: Record<LadderId, { name: string; rungs: string[] }> = {
  L1: {
    name: "Run/walk",
    rungs: ["6 × (3 min run / 1 min walk)", "5 × (4/1)", "4 × (6/1)", "4 × (8/1)", "3 × 10 min"],
  },
  L2: {
    name: "Aerobic",
    rungs: ["20 min continuous", "30 min", "40 min", "50 min", "60 min"],
  },
  L3: {
    name: "Threshold",
    rungs: ["2 × 8 min", "3 × 8 min", "4 × 8 min", "2 × 15 min", "3 × 15 min", "2 × 20 min"],
  },
  L4: {
    name: "CV / race pace",
    rungs: [
      "5 × 800 m", "6 × 800 m", "5 × 1000 m", "6 × 1000 m", "4 × 2000 m",
      "8 × 1000 m @ race pace, walk recovery", "8 × 1000 m @ race pace, standing recovery",
    ],
  },
  L5: {
    name: "Neuromuscular",
    rungs: ["Strides", "8 × 100 m", "6 × 200 m", "8 × 200 m", "6 × 300 m", "10 × 400 m"],
  },
  L6: {
    name: "Race specific",
    rungs: ["Compromised running", "Transitions", "Half simulation", "Full simulation"],
  },
};

/**
 * Which rung to start on.
 *
 * From the running self-assessment, because that is the answer that describes
 * what someone can execute. A pace anchor can lift the entry — but only after
 * a benchmark; the self-report is the floor of the evidence, not the whole of
 * it.
 */
export const ENTRY: Record<RunningBase, Partial<Record<LadderId, number>>> = {
  doesnt_run:           { L1: 0, L2: 0, L5: 0 },
  walk_breaks:          { L1: 1, L2: 1, L5: 0 },
  "5k_nonstop":         { L2: 2, L3: 0, L4: 0, L5: 1 },
  runs_regularly:       { L2: 3, L3: 1, L4: 1, L5: 2 },
  half_marathon_fit:    { L2: 4, L3: 3, L4: 2, L5: 3 },
  marathon_competitive: { L2: 4, L3: 4, L4: 4, L5: 4 },
};

/**
 * Which ladder the quality slot draws from, by phase.
 *
 * L5 is maintenance and never a focus: an athlete already running 400s at 3:39
 * needs threshold work, not more top end.
 */
export const PHASE_MIX: Record<PhaseName, Partial<Record<LadderId, number>>> = {
  base:     { L3: 0.40, L4: 0.20, L5: 0.40 },
  build:    { L3: 0.40, L4: 0.40, L5: 0.20 },
  specific: { L3: 0.20, L4: 0.40, L5: 0.10, L6: 0.30 },
  taper:    { L3: 0.20, L4: 0.40, L5: 0.20, L6: 0.20 },
};

/** The ceiling a phase puts on how far up a ladder a session may go. */
export const PHASE_CAP: Record<PhaseName, number> = {
  base: 0.5, build: 0.75, specific: 1.0, taper: 1.0,
};

/**
 * Pick the ladder for a given week deterministically.
 *
 * Largest-remainder over the phase mix, cycled by week index, so a phase of
 * five weeks at 40/40/20 gives two, two and one rather than whatever a random
 * draw happens to produce. Same input, same plan.
 */
export function ladderFor(phase: PhaseName, weekInPhase: number, canDoStations: boolean): LadderId {
  const mix = Object.entries(PHASE_MIX[phase])
    .filter(([id]) => canDoStations || id !== "L6") as [LadderId, number][];
  const total = mix.reduce((n, [, w]) => n + w, 0);

  // build the cycle once: each ladder appears in proportion to its share
  const cycle: LadderId[] = [];
  const size = 10;
  const counts = mix.map(([id, w]) => [id, (w / total) * size] as [LadderId, number]);
  const whole = counts.map(([id, n]) => [id, Math.floor(n)] as [LadderId, number]);
  let placed = whole.reduce((n, [, c]) => n + c, 0);
  const remainders = counts
    .map(([id, n], i) => [i, n - Math.floor(n)] as [number, number])
    .sort((a, b) => b[1] - a[1]);
  for (let i = 0; placed < size; i++, placed++) whole[remainders[i % remainders.length][0]][1]++;
  whole.forEach(([id, n]) => { for (let i = 0; i < n; i++) cycle.push(id); });

  return cycle[weekInPhase % cycle.length] ?? mix[0][0];
}

/**
 * The rung for a week: entry, plus roughly one a week, capped by the phase.
 *
 * Capping by phase is what stops a base week prescribing a full simulation
 * because the arithmetic allowed it.
 */
export function rungFor(
  ladder: LadderId, base: RunningBase, weeksIn: number, phase: PhaseName,
): Rung {
  const rungs = LADDERS[ladder].rungs;
  const ceiling = Math.max(0, Math.floor((rungs.length - 1) * PHASE_CAP[phase]));
  /*
   * Start below the ceiling so there is somewhere to climb.
   *
   * An athlete whose entry already sat at the phase cap got the same rung in week
   * one and week four — the clamp pinned it, and every Monday of the base phase
   * was the same session. Entering a rung under the cap leaves the phase somewhere
   * to go, and the cap still decides how far.
   */
  const entry = Math.min(ENTRY[base]?.[ladder] ?? 0, Math.max(0, ceiling - 1));
  // Every other week, not every week: a rung is a change of session, and changing
  // it weekly means nothing is ever repeated well enough to be measured.
  const rung = Math.min(entry + Math.floor(weeksIn / 2), ceiling, rungs.length - 1);
  return { label: rungs[Math.max(0, rung)], rung: Math.max(0, rung) };
}

/** Can this athlete do a race-specific session at all? */
export const canDoStations = (variant: string) => variant !== "field";

/**
 * A different stimulus for a second quality run in the same week.
 *
 * Asking the cycle for "next week's ladder" returned the same one often enough that
 * a Hard week held "4 × 8 min" on Monday and "4 × 8 min" on Tuesday. The pairing
 * here is deliberate: threshold and CV are the two that complement each other, and
 * where the athlete cannot do stations the race-specific ladder is not an option.
 */
export function otherLadder(first: LadderId, canDoStations: boolean): LadderId {
  const pair: Record<LadderId, LadderId> = {
    L1: "L2", L2: "L1", L3: "L4", L4: "L3", L5: "L3",
    L6: canDoStations ? "L4" : "L3",
  };
  return pair[first];
}

/**
 * A different rung of the same ladder.
 *
 * Asking for "next week's rung" returns the same one whenever the phase cap binds,
 * which is how a week ended up with the same Hyrox session on two consecutive days.
 * This steps deliberately: one up where there is room, one down where there is not.
 */
export function otherRung(ladder: LadderId, rung: number): string {
  const rungs = LADDERS[ladder].rungs;
  if (rungs.length < 2) return rungs[0];
  const next = rung + 1 < rungs.length ? rung + 1 : Math.max(0, rung - 1);
  return rungs[next];
}
