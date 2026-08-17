import type { Kit } from "./strength";

/**
 * The eight stations, in race order, and what a training dose of each one is.
 *
 * A Hyrox session was being written as "1 station Z4" — a placeholder standing in for
 * the actual work, which tells an athlete nothing and cannot be followed. The session
 * is a list of things to do in an order: four hundred metres, twenty-five wall balls,
 * four hundred metres, a sled. That is what it should say.
 *
 * Race doses are the event's own. Training doses are roughly a quarter of them, which
 * is what makes four rounds of run-plus-station fit inside an hour without becoming a
 * race simulation nobody recovers from.
 */

export type Station = {
  id: string;
  /** what to call it on the session */
  name: string;
  /** the event's dose, for a simulation */
  race: string;
  /** a quarter of it, for an interval session */
  training: string;
  /** what it needs, and what to do instead where the athlete has none of it */
  needs: keyof Kit | "none";
  instead: string;
};

export const STATIONS: Station[] = [
  {
    id: "ski", name: "SkiErg", race: "1000 m", training: "250 m",
    needs: "none", instead: "250 m row, or 60 burpees if there is no machine",
  },
  {
    id: "sled_push", name: "Sled push", race: "50 m", training: "25 m",
    needs: "sled", instead: "40 m heavy carry, arms straight, no rest",
  },
  {
    id: "sled_pull", name: "Sled pull", race: "50 m", training: "25 m",
    needs: "sled", instead: "20 hard band or rope pulls",
  },
  {
    id: "burpee", name: "Burpee broad jump", race: "80 m", training: "20 m",
    needs: "none", instead: "20 burpees, jumping forward on each",
  },
  {
    id: "row", name: "Row", race: "1000 m", training: "250 m",
    needs: "none", instead: "250 m ski, or 2 min hard skipping",
  },
  {
    id: "carry", name: "Farmers carry", race: "200 m", training: "100 m",
    needs: "kettlebells", instead: "100 m carrying anything heavy in each hand",
  },
  {
    id: "lunge", name: "Sandbag lunges", race: "100 m", training: "50 m",
    needs: "none", instead: "50 m walking lunges holding weight at the chest",
  },
  {
    id: "wall_ball", name: "Wall balls", race: "100 reps", training: "25 reps",
    needs: "none", instead: "25 squat-to-press with anything you can hold",
  },
];

const canDo = (s: Station, kit: Kit) => s.needs === "none" || kit[s.needs];

/**
 * The load, in kilograms, from the division the athlete entered.
 *
 * Stations were named and dosed and carried no weight at all — "25 m Sled push" is
 * half an instruction, and the half it leaves out is the half that decides whether the
 * session is the session. The weights come from the standards table the intake already
 * populates from their division, so a mixed-doubles athlete pushes the mixed-doubles
 * sled rather than a number this file invented.
 */
export type Loads = {
  sled_push_total_kg: number; sled_pull_total_kg: number;
  farmers_kg: number; lunge_kg: number; wall_ball_kg: number;
};

export function loadFor(id: string, loads?: Loads | null): string | null {
  if (!loads) return null;
  switch (id) {
    // Total sled weight, which is how a venue and a gym both label it.
    case "sled_push": return `${loads.sled_push_total_kg} kg total`;
    case "sled_pull": return `${loads.sled_pull_total_kg} kg total`;
    case "carry": return `${loads.farmers_kg} kg each hand`;
    case "lunge": return `${loads.lunge_kg} kg`;
    case "wall_ball": return `${loads.wall_ball_kg} kg`;
    default: return null;   // machines and bodyweight carry no load
  }
}

/**
 * The stations for one session, in race order, starting where the block is.
 *
 * Rotated by the week so an athlete is not doing the ski and the sled every Saturday
 * for fifteen weeks, and filtered to what they can actually reach — with the
 * substitution stated rather than the station silently dropped, because an athlete
 * with no sled still has to train the pattern.
 */
export function stationsFor(
  kit: Kit, count: number, week = 1, loads?: Loads | null,
): { name: string; dose: string; load?: string | null; note?: string }[] {
  const usable = STATIONS.map((s) => ({
    s,
    available: canDo(s, kit),
  }));
  const start = (week - 1) % STATIONS.length;
  const ordered = [...usable.slice(start), ...usable.slice(0, start)];

  return ordered.slice(0, Math.max(1, count)).map(({ s, available }) => ({
    name: available ? s.name : `${s.name} — substituted`,
    dose: available ? s.training : s.instead,
    load: available ? loadFor(s.id, loads) : null,
    ...(available ? {} : { note: `You said you have no ${s.needs}. ${s.instead}.` }),
  }));
}

/** The full event, for a simulation: every station at its race dose. */
export const raceOrder = (
  kit: Kit, loads?: Loads | null,
): { name: string; dose: string; load?: string | null }[] =>
  STATIONS.map((s) => ({
    name: canDo(s, kit) ? s.name : `${s.name} (substituted)`,
    dose: canDo(s, kit) ? s.race : s.instead,
    load: canDo(s, kit) ? loadFor(s.id, loads) : null,
  }));
