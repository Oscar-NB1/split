import type { PhaseName } from "./skeleton";

/**
 * Stage 3: how the week divides between running, stations and strength.
 *
 * Role comes from the *sign* of the partner deltas, not their size. Magnitude
 * decides how the work is split on race day; it does not decide what you train.
 */

export const ROLE = ["protected", "run_limiter", "balanced", "station_carrier"] as const;
export type Role = (typeof ROLE)[number];

export const GOAL = ["finish", "strong", "compete"] as const;
export type Goal = (typeof GOAL)[number];

export type Allocation = { running: number; station: number; strength: number };

/**
 * Who carries what.
 *
 * A partner who is faster and stronger leaves you protected: you set the run
 * pace and take machine metres. A partner who is slower at running means you
 * carry the stations, whatever else is true — hence "any" in that row.
 */
export function roleFrom(runDelta: number, stationDelta: number): Role {
  const run = Math.sign(runDelta);      // +1 partner runs faster
  const station = Math.sign(stationDelta); // +1 partner is stronger at stations
  if (run > 0) return station > 0 ? "protected" : "run_limiter";
  if (run < 0) return "station_carrier";
  return "balanced";
}

/** running / station / strength, as percentages. */
export const ALLOCATION: Record<Role, Record<Goal, Allocation>> = {
  protected: {
    finish:  { running: 45, station: 35, strength: 20 },
    strong:  { running: 55, station: 30, strength: 15 },
    compete: { running: 70, station: 20, strength: 10 },
  },
  run_limiter: {
    finish:  { running: 45, station: 35, strength: 20 },
    strong:  { running: 55, station: 30, strength: 15 },
    compete: { running: 65, station: 25, strength: 10 },
  },
  balanced: {
    finish:  { running: 45, station: 35, strength: 20 },
    strong:  { running: 45, station: 35, strength: 20 },
    compete: { running: 50, station: 30, strength: 20 },
  },
  station_carrier: {
    finish:  { running: 45, station: 35, strength: 20 },
    strong:  { running: 40, station: 38, strength: 22 },
    compete: { running: 35, station: 40, strength: 25 },
  },
};

/** Station work never falls below this, whatever the role and goal say. */
export const STATION_FLOOR = 15;

/** How far toward the specialised split each phase goes. */
export const PHASE_WEIGHT: Record<PhaseName, number> = {
  base: 0.3, build: 0.6, specific: 1.0, taper: 1.0,
};

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/**
 * The split for one phase.
 *
 * Specialisation ramps rather than arriving on day one: early in a block the
 * limiter is aerobic capacity, which is the same work whoever you are racing
 * with, and narrowing a beginner's training in week 1 buys nothing.
 *
 * At `finish` every role gets the same split on purpose. Specialising someone
 * who wants to enjoy the day narrows their training for no return.
 */
export function allocationFor(
  role: Role, goal: Goal, phase: PhaseName, discipline: "doubles" | "singles" = "doubles",
): Allocation {
  // Singles carries every station personally, so a doubles role means nothing.
  const target = ALLOCATION[discipline === "singles" ? "balanced" : role][goal];
  const balanced = ALLOCATION.balanced[goal];
  const w = PHASE_WEIGHT[phase];

  const out: Allocation = {
    running: lerp(balanced.running, target.running, w),
    station: lerp(balanced.station, target.station, w),
    strength: lerp(balanced.strength, target.strength, w),
  };

  // The floor is a hard rule, so what it takes has to come from somewhere: it
  // comes off running, which is the share that grew past it.
  if (out.station < STATION_FLOOR) {
    out.running -= STATION_FLOOR - out.station;
    out.station = STATION_FLOOR;
  }

  const total = out.running + out.station + out.strength;
  return {
    running: Math.round((out.running / total) * 1000) / 10,
    station: Math.round((out.station / total) * 1000) / 10,
    strength: Math.round((out.strength / total) * 1000) / 10,
  };
}
