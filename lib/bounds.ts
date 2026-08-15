/**
 * What a recorded activity is allowed to claim.
 *
 * These exist because the same two data defects have now surfaced in three
 * separate places, each time as a confident wrong number rather than an error:
 *
 *   - "Fastest kilometre: 0:15" on the records backfill — a 3,412 m split logged
 *     as 15 s of moving time against 1,205 s elapsed. The GPS jumped.
 *   - "0:15" again on the Awards screen, because that route runs its own query
 *     against the same rows and I had bounded only the first one.
 *   - "1,256 Zone-2 minutes" in a weekly challenge score — 21 hours — from a
 *     weight-training activity of 68,740 s with moving equal to elapsed. A watch
 *     left running overnight.
 *   - "Fastest kilometre: 3:24 — Afternoon Ride". Six of the eight best
 *     kilometres on the Awards screen were bike rides. lib/records.ts had always
 *     required a running activity; the Awards route, querying the same split rows
 *     itself, had not. Exactly the mistake the second entry above describes,
 *     third time round, in the same file.
 *
 * The lesson is the reason this file exists: a data-quality rule that lives next
 * to one query is not a rule, it is a patch, and the next reader of the same
 * rows will not know about it. Every consumer of activity durations and split
 * speeds imports from here.
 *
 * Clamped rather than excluded where a total is concerned: the session did
 * happen, it is only its duration that cannot be trusted.
 */

/** 7 m/s over a kilometre is 2:23 — already faster than any amateur. */
export const MAX_SPEED_MS = 7.0;

/** Six hours is generous against a two-hour long run and a one-hour race. */
export const MAX_SESSION_SECONDS = 6 * 3600;

/** For a SQL `least(moving_seconds, …)`. */
export const MAX_SESSION_SQL = MAX_SESSION_SECONDS;

/**
 * Which activities a running record may come from.
 *
 * A bike ride has kilometre splits too, and at 17 km/h they sit comfortably under
 * MAX_SPEED_MS — the speed bound cannot catch this, because nothing about a
 * 3:24 kilometre is implausible. Only the sport is wrong.
 *
 * Matched on the substring so Strava's Run, TrailRun and VirtualRun all qualify.
 * A Hyrox race logged as "Workout" does not, deliberately: its splits straddle
 * the stations, so they are not clean running kilometres even though the running
 * inside them is real.
 */
export const RUN_SPORT_SQL = "%run%";

/** The same rule for rows already in hand. */
export const isRunSport = (sport: string | null | undefined) => /run/i.test(sport ?? "");
