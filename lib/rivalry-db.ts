import { sql } from "./db";
import { addDays } from "./dates";
import { isRunSport, RUN_SPORT_SQL } from "./bounds";
import { decide, scoreSide, type Completed, type Prescribed, type SideScore } from "./rivalry";

/**
 * Turning a week of one athlete's plan into a score.
 *
 * The prescription and what they actually did, both read server-side, both for
 * the same seven days. Everything here is a share of that athlete's own plan —
 * see lib/rivalry.ts for why raw output is never compared.
 */

/** Which kinds count as a station session, for the station share. */
const STATION_KINDS = ["hyrox", "strength"];

/**
 * What the plan asked of them that week.
 *
 * `planned_sessions` has no kilometre column, so prescribed volume is read from
 * the template's own week rather than re-derived: the template is what the
 * athlete was actually shown, and a second derivation would be a second answer.
 */
export async function prescribedFor(userId: string, weekStart: string): Promise<Prescribed> {
  const weekEnd = addDays(weekStart, 7);

  const [counts] = await sql<{ sessions: number; stations: number }[]>`
    select count(*)::int as sessions,
           count(*) filter (where kind = any(${STATION_KINDS}))::int as stations
      from planned_sessions
     where user_id = ${userId}
       and planned_date >= ${weekStart} and planned_date < ${weekEnd}
       and kind <> 'rest'
  `;

  const [tpl] = await sql<{ weeks: unknown; start_date: string }[]>`
    select weeks, start_date::text as start_date from plan_templates
     where athlete_id = ${userId} and active order by created_at desc limit 1
  `;

  const km = kmForWeek(tpl?.weeks, tpl?.start_date, weekStart);

  const [away] = await sql<{ away: boolean }[]>`
    select exists (
      select 1 from absences
       where user_id = ${userId} and kind <> 'normal'
         and from_date < ${weekEnd} and to_date >= ${weekStart}
    ) as away
  `;

  return {
    sessions: counts?.sessions ?? 0,
    km,
    station_sessions: counts?.stations ?? 0,
    // No sessions and no template is not a plan. Scoring someone against an
    // empty prescription would make every week a division by zero dressed up
    // as a perfect score.
    has_plan: (counts?.sessions ?? 0) > 0 || km > 0,
    away: away?.away ?? false,
  };
}

/** The template's own figure for the week that starts on this date. */
function kmForWeek(weeks: unknown, startDate: string | undefined, weekStart: string): number {
  if (!Array.isArray(weeks) || !startDate) return 0;
  const n = Math.round(
    (Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 604_800_000,
  ) + 1;
  const w = weeks.find((x) => (x as { n?: number }).n === n) as { km?: number } | undefined;
  return Number(w?.km ?? 0);
}

/** What they actually did. */
export async function completedFor(userId: string, weekStart: string): Promise<Completed> {
  const weekEnd = addDays(weekStart, 7);

  const [done] = await sql<{ sessions: number; stations: number }[]>`
    select count(*)::int as sessions,
           count(*) filter (where kind = any(${STATION_KINDS}))::int as stations
      from planned_sessions
     where user_id = ${userId}
       and planned_date >= ${weekStart} and planned_date < ${weekEnd}
       and kind <> 'rest'
       and (status = 'done' or activity_id is not null)
  `;

  // Volume comes from the activities rather than from the sessions they were
  // matched to: an unplanned run still happened.
  const [vol] = await sql<{ km: number }[]>`
    select coalesce(sum(distance_m), 0) / 1000.0 as km from activities
     where user_id = ${userId}
       and sport_type ilike ${RUN_SPORT_SQL}
       and local_date >= ${weekStart} and local_date < ${weekEnd}
  `;

  return {
    sessions: done?.sessions ?? 0,
    km: Number(vol?.km ?? 0),
    station_sessions: done?.stations ?? 0,
  };
}

export const scoreWeek = async (userId: string, weekStart: string): Promise<SideScore> =>
  scoreSide(await prescribedFor(userId, weekStart), await completedFor(userId, weekStart));

/**
 * A finished week for a pair.
 *
 * `finalised` is the caller's to decide, because it is a fact about the clock
 * rather than about the athletes: a week is only settled 24 hours after it
 * closes, and until then a late log can still change it.
 */
export async function weekFor(
  requesterId: string, addresseeId: string, weekStart: string, finalised: boolean,
) {
  const requester = await scoreWeek(requesterId, weekStart);
  const addressee = await scoreWeek(addresseeId, weekStart);
  return { requester, addressee, ...decide(requester, addressee, finalised) };
}

export { isRunSport };
