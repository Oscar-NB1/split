import type { RunningBase } from "./resolve";
import type { PhaseName } from "./skeleton";
import { ladderMix } from "./zone-budget";

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
 * Which ladder the quality slot draws from — derived, not typed.
 *
 * This used to be four rows of hand-written proportions, and they contradicted the
 * sentence above them: the comment said L5 was "maintenance and never a focus" while
 * the table gave it forty per cent of the base phase. The distribution now comes
 * from `ZONE_BUDGET` in zone-budget.ts, which states the same thing in the terms it
 * can actually be argued about — how much of the hard work sits in each zone — so
 * the mix cannot drift from what the phase is for.
 *
 * It also now depends on the athlete: somebody who does not yet run gets the
 * run/walk and aerobic ladders at every phase, where before their quality slot drew
 * from threshold and their entry rung fell through to zero.
 */
export const ladderMixFor = ladderMix;

/** The ceiling a phase puts on how far up a ladder a session may go. */
export const PHASE_CAP: Record<PhaseName, number> = {
  base: 0.5, build: 0.75, specific: 1.0,
  /*
   * The taper is the one phase allowed to go backwards.
   *
   * At 1.0 it could reach the top of every ladder, and it did: the first taper week
   * prescribed "2 × 20 min" — forty minutes at threshold, the longest quality session
   * in the block, a fortnight out from the race. Intensity stays in a taper and
   * volume comes down, and the rung is the volume.
   */
  taper: 0.6,
};

/**
 * Pick the ladder for a given week deterministically.
 *
 * Largest-remainder over the phase mix, cycled by week index, so a phase of
 * five weeks at 40/40/20 gives two, two and one rather than whatever a random
 * draw happens to produce. Same input, same plan.
 */
export function ladderFor(
  phase: PhaseName, weekInPhase: number, canDoStations: boolean,
  base: RunningBase = "runs_regularly",
): LadderId {
  // The running slot: the race share belongs to the Hyrox session, which is a slot
  // of its own in the same week.
  const mix = Object.entries(ladderMix(phase, base, canDoStations, true))
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
  /**
   * How far into the whole block this week is, where the caller knows.
   *
   * `weeksIn` counts from the start of the *phase*, which is what makes a rung climb
   * inside a phase — and what made it fall off a cliff at every boundary: week 9 of
   * the build finished on "8 × 1000 m" and week 10 of the specific phase started
   * again at "3 × 8 min", because the counter went back to zero. A session got easier
   * because the calendar turned a page.
   *
   * The block week is a floor, not a replacement: it stops a later phase starting
   * below what an earlier one reached, while the phase cap still decides how far up
   * the ladder that phase is allowed to go.
   */
  blockWeek?: number,
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
  const climbed = entry + Math.floor(weeksIn / 2);
  /*
   * The floor from the block, capped by the phase.
   *
   * A phase that is allowed further up the ladder than the last one starts where the
   * last one finished rather than at its own entry rung; a phase with a lower cap —
   * the taper — is still held down by it, which is the point of the cap.
   */
  const floor = blockWeek === undefined
    ? 0
    : Math.min(entry + Math.floor(blockWeek / 3), ceiling);
  const rung = Math.min(Math.max(climbed, floor), ceiling, rungs.length - 1);
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
export function otherLadder(
  first: LadderId, canDoStations: boolean,
  /**
   * Which half of the race limits this athlete, where it is known.
   *
   * The second quality session should train the thing that is losing them time. A
   * run-limited athlete — the one whose partner protects them on the stations — gets
   * their finish decided by the eight runs, so their second hard session is running:
   * threshold, then race pace. A station carrier is already the stronger runner, and
   * a second interval session is the least useful hour in their week when the sled and
   * the sandbag are what cost them minutes.
   *
   * Without this, both got the same pairing and the plan trained whichever quality the
   * cycle happened to land on.
   */
  role?: string | null,
): LadderId {
  const pair: Record<LadderId, LadderId> = {
    L1: "L2", L2: "L1", L3: "L4", L4: "L3", L5: "L3",
    L6: canDoStations ? "L4" : "L3",
  };
  const other = pair[first];

  /*
   * The limiter overrides the pairing, but never invents a session they cannot do.
   *
   * A run-limited athlete never gets the race-specific ladder as their second hard
   * session — they already have a Hyrox session in the week and their problem is not
   * exposure to stations. A station carrier gets it wherever they can reach one.
   */
  /*
   * "Protected" is the run-limited case under another name.
   *
   * The intake stores four roles and two of them mean the same thing here: an athlete
   * whose partner protects them on the stations is one whose finish time is decided by
   * their running.
   */
  const runLimited = role === "run_limiter" || role === "protected";
  if (runLimited && other === "L6") return "L3";
  if (role === "station_carrier" && canDoStations && (other === "L3" || other === "L4")) {
    return "L6";
  }
  return other;
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
