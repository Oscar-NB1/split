/**
 * What we know about an athlete, and how sure we are of it.
 *
 * Append-only. One row per field per capture, never updated in place — a
 * measurement six months old is still a measurement, and overwriting it loses
 * the ability to say when something changed.
 */

export const SOURCE = [
  "measured_race", "measured_benchmark", "reported_race", "reported_self",
] as const;
export type Source = (typeof SOURCE)[number];

/** Rank 1 is the most trustworthy. Nothing ever overwrites downward. */
export const RANK: Record<Source, number> = {
  measured_race: 1,
  measured_benchmark: 2,
  reported_race: 3,
  reported_self: 4,
};

export type Capability = {
  field: string;
  value: number;
  source: Source;
  captured_at: string;
};

/**
 * Fields only a real result can supply.
 *
 * Nobody self-reports their transition time. A roxzone that arrived from a quiz
 * is not a slower roxzone, it is a made-up one, and a plan built on it would be
 * confidently wrong about the thing worth 90–110 seconds on race day.
 */
export const MEASURED_ONLY = new Set(["roxzone_s"]);

/**
 * The best value we hold for each field.
 *
 * Highest-ranked source wins; within a source, the most recent capture. A quiz
 * retake can never clobber a benchmark — which is the whole reason this is a
 * hierarchy rather than a last-write-wins column.
 */
export function best(rows: Capability[]): Record<string, Capability> {
  const out: Record<string, Capability> = {};
  for (const row of rows) {
    if (MEASURED_ONLY.has(row.field) && RANK[row.source] > RANK.measured_benchmark) continue;
    const held = out[row.field];
    if (!held) { out[row.field] = row; continue; }
    if (RANK[row.source] < RANK[held.source]) { out[row.field] = row; continue; }
    if (RANK[row.source] === RANK[held.source] && row.captured_at > held.captured_at) {
      out[row.field] = row;
    }
  }
  return out;
}

/** Whether the plan built from this is estimated or measured. */
export const confidenceFrom = (rows: Capability[]): "estimated" | "measured" =>
  rows.some((r) => RANK[r.source] <= RANK.measured_benchmark) ? "measured" : "estimated";

/**
 * A retest much worse than the last one on the same variant.
 *
 * Not silently accepted: a bad night's sleep and a real decline look identical
 * in the number and completely different in what should happen next, so the
 * athlete decides rather than the generator guessing.
 */
export const BAD_DAY_THRESHOLD = 0.15;

export function badDay(previous: number, next: number, lowerIsBetter = true): boolean {
  if (!previous || !next) return false;
  const worse = lowerIsBetter ? next / previous - 1 : previous / next - 1;
  return worse > BAD_DAY_THRESHOLD;
}
