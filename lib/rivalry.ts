/**
 * Head-to-head scoring.
 *
 * Pure: no database, no clock. Every number here is server-computed and both
 * sides read the same one — two devices scoring locally will disagree, and a
 * disputed head-to-head is worse than none.
 *
 * The whole model is relative to each person's own prescription. Two athletes on
 * different plans are not comparable on raw kilometres: 11 km against a 12 km
 * week is a better week than 9 km against a 34 km week, and loses on the raw
 * number every time. Absolutes are returned for display and never decide a row.
 */

export type Side = "requester" | "addressee";
export type Winner = Side | "tie" | "undecided";

/** What one person did against what their own plan asked for. */
export type SideScore = {
  adherence_pct: number | null;
  volume_pct: number | null;
  station_pct: number | null;
  sessions_done: number;
  sessions_planned: number;
  /** shown, never scored on */
  km_done: number;
  km_planned: number;
  /** true when a trip overlapped the week, which takes them out of scoring */
  away: boolean;
  /** false when they had no active plan, so there was nothing to be a share of */
  has_plan: boolean;
};

export type Prescribed = {
  sessions: number; km: number; station_sessions: number;
  has_plan: boolean; away: boolean;
};
export type Completed = {
  sessions: number; km: number; station_sessions: number;
};

/** A share, or null where the denominator does not exist. */
const share = (done: number, planned: number): number | null =>
  planned <= 0 ? null : Math.round((done / planned) * 1000) / 1000;

export function scoreSide(p: Prescribed, c: Completed): SideScore {
  return {
    adherence_pct: p.has_plan ? share(c.sessions, p.sessions) : null,
    volume_pct: p.has_plan ? share(c.km, p.km) : null,
    station_pct: p.has_plan ? share(c.station_sessions, p.station_sessions) : null,
    sessions_done: c.sessions,
    sessions_planned: p.sessions,
    km_done: Math.round(c.km * 10) / 10,
    km_planned: Math.round(p.km * 10) / 10,
    away: p.away,
    has_plan: p.has_plan,
  };
}

/** Weeks at 80% or better. Kept as a definition rather than a magic number. */
export const CONSISTENT_AT = 0.80;
export const consistency = (weeks: { adherence_pct: number | null }[]) =>
  weeks.filter((w) => (w.adherence_pct ?? 0) >= CONSISTENT_AT).length;

export type Points = { requester: number; addressee: number };

/**
 * Who won the week.
 *
 * Adherence decides it — the share of their own prescription each of them
 * completed. Nothing else is consulted, because adding tiebreakers on volume or
 * stations would smuggle absolute output back in through the side door.
 */
export function decide(
  a: SideScore, b: SideScore, finalised: boolean,
): { winner: Winner; points: Points } {
  const none = { requester: 0, addressee: 0 };

  // Until 24 hours after the week closes there is nothing to declare: late logs
  // are normal and a result that flips the next morning is not a result.
  if (!finalised) return { winner: "undecided", points: none };

  // The rivalry does not start until both have plans. A week where one side had
  // nothing prescribed is not a contest either of them entered.
  if (!a.has_plan || !b.has_plan) return { winner: "undecided", points: none };

  /*
   * A trip takes that person out of scoring for the week. If only one was away
   * the week is a tie rather than a win for whoever stayed home: beating someone
   * who was on a plane is not a result, and taking the point would make holidays
   * cost something they should not.
   */
  if (a.away || b.away) return { winner: "tie", points: { requester: 1, addressee: 1 } };

  const x = a.adherence_pct, y = b.adherence_pct;
  if (x === null || y === null) return { winner: "undecided", points: none };

  if (x === y) return { winner: "tie", points: { requester: 1, addressee: 1 } };
  return x > y
    ? { winner: "requester", points: { requester: 3, addressee: 0 } }
    : { winner: "addressee", points: { requester: 0, addressee: 3 } };
}

// ------------------------------------------------------------ what may be read

/**
 * The whole permitted set, at the one scope that exists.
 *
 * A connection is consent to share effort, not training data. This is enforced
 * by building the payload from this list rather than by trusting a caller to ask
 * for the right fields — an allowlist that lives in the client is not one.
 */
export const SHAREABLE = [
  "adherence_pct", "volume_pct", "station_pct",
  "sessions_done", "sessions_planned", "streak", "weeks_won",
] as const;

export const DENIED = [
  "paces", "splits", "hr", "rpe", "session_detail", "benchmark_results",
  "archetype", "weight", "injuries", "profile", "plan_contents",
] as const;

/** Reduce anything to what a connection is allowed to see. */
export function shareable<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of SHAREABLE) if (k in row) out[k] = row[k];
  return out as Partial<T>;
}

// -------------------------------------------------------------- pair identity

/**
 * One row per pair, whichever way round it was created.
 *
 * Canonically ordered by id so (A,B) and (B,A) cannot both exist. The direction
 * still matters for who asked, so it is kept separately rather than lost to the
 * ordering.
 */
export const pairKey = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a];

/** How many rivalries one person may have running. Keeps the job bounded. */
export const MAX_ACTIVE = 10;

/** An invite is single-use and dies after a week. */
export const INVITE_TTL_DAYS = 7;
