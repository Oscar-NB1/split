import { addDays, diffDays, mondayOf } from "./dates";

/**
 * An athlete's training block: what it is, and the questions you can ask it.
 *
 * Deliberately free of any database import. The Week, Plan and Program screens are
 * client components and they all need `weekOf` and `daysToRace`, so a `sql` import
 * here puts postgres in the browser bundle — which it did, and the whole app
 * returned 500 with "Module not found: Can't resolve 'net'". The loaders live in
 * lib/block-db.ts.
 *
 * This replaces the constants in lib/coach.ts. Those described one block — a
 * start date, a race, a goal, a fifteen-row volume table and a phase narrative —
 * as module-level values, which meant every screen that read them showed that
 * block to whoever happened to be signed in. The second athlete was shown the
 * first's race and target as hers, reading "0/15 weeks done" against a block she
 * was not doing.
 *
 * Everything here is per athlete and nullable. An athlete with no plan gets null
 * rather than someone else's, and every screen has to say so.
 */

export type PlanWeek = {
  /** 1-based week of the block. */
  n: number;
  /** the Monday it starts, derived from the block start rather than stored */
  start: string;
  km: number;
  note: string;
};

export type Intent = {
  phase: string;
  purpose: string;
  protect: string[];
  sacrifice: string;
  watch: string;
};

/** An intent, and the weeks it covers. Inclusive at both ends. */
export type IntentRange = Intent & { from: number; to: number };

export type Block = {
  id: string;
  name: string;
  /** Monday of week 1. */
  start: string;
  /** the Sunday of the final week — the block's last day */
  end: string;
  race_date: string | null;
  race_name: string | null;
  goal_label: string | null;
  goal_seconds: number | null;
  weeks: PlanWeek[];
  intents: IntentRange[];
};

export type Row = {
  id: string; name: string; start_date: string;
  race_date: string | null; race_name: string | null;
  goal_label: string | null; goal_seconds: number | null;
  volume: { km: number; note?: string }[] | null;
  intents: IntentRange[] | null;
  weeks: unknown[][] | null;
};

/**
 * Week start dates are derived, never stored.
 *
 * Storing them would let the volume table and the session shapes disagree about
 * when week 7 is — and materialise() already derives its own week from
 * start_date, so a stored date would be a second answer to a question that
 * already has one.
 */
function toWeeks(row: Row): PlanWeek[] {
  const start = mondayOf(row.start_date);
  const volume = Array.isArray(row.volume) ? row.volume : [];
  // fall back to the session shapes' length, so a plan with no volume table still
  // knows how many weeks it runs for
  const count = volume.length || (Array.isArray(row.weeks) ? row.weeks.length : 0);
  return Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    start: addDays(start, i * 7),
    km: Number(volume[i]?.km ?? 0),
    note: volume[i]?.note ?? "",
  }));
}

export function toBlock(row: Row): Block {
  const weeks = toWeeks(row);
  return {
    id: row.id,
    name: row.name,
    start: mondayOf(row.start_date),
    end: weeks.length ? addDays(weeks[weeks.length - 1].start, 6) : mondayOf(row.start_date),
    race_date: row.race_date,
    race_name: row.race_name,
    goal_label: row.goal_label,
    goal_seconds: row.goal_seconds,
    weeks,
    intents: Array.isArray(row.intents) ? row.intents : [],
  };
}

// ------------------------------------------------------------ block questions
//
// These were module functions closed over the constants. They now take the block,
// which is what makes them answerable for more than one athlete.

/** Which plan week a date falls in, or null outside the block. */
export function weekOf(block: Block | null, date: string): PlanWeek | null {
  if (!block) return null;
  const monday = mondayOf(date);
  return block.weeks.find((w) => w.start === monday) ?? null;
}

/** What a week is for. Null if the plan carries no narrative for it. */
export function intentFor(block: Block | null, n: number): Intent | null {
  if (!block) return null;
  return block.intents.find((i) => n >= i.from && n <= i.to) ?? null;
}

/** Days remaining until race day. Positive before it, negative after. */
export function daysToRace(block: Block | null, from: string): number | null {
  if (!block?.race_date) return null;
  return diffDays(block.race_date, from);
}

/** Is this date before the block has started? */
export const beforeBlock = (block: Block | null, date: string) =>
  !!block && mondayOf(date) < block.start;
