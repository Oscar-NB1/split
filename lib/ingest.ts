import { isRunSport } from "./bounds";
import { sql } from "./db";
import { isTreadmill, needsWorkReport, workShapeOf } from "./treadmill";
import { notify } from "./notify";

export type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  type: string;
  start_date: string;       // UTC
  start_date_local: string; // athlete's local wall clock
  moving_time: number;
  elapsed_time: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
};

/**
 * Map a Strava sport_type onto our planned-session kinds.
 *
 * Only used for effort points, so the mapping has to reflect what these two
 * actually record. Garmin's activity types arrive here renamed by Strava:
 *
 *   Garmin Strength  -> WeightTraining               -> strength
 *   Garmin HIIT      -> HighIntensityIntervalTraining \
 *   Garmin Cardio    -> Workout                       > hyrox (station work)
 *   Garmin Crossfit  -> Crossfit                     /
 *
 * The old version sent Workout to `strength` and everything unrecognised to
 * `hyrox`, which is backwards on both counts: a Hyrox session scored 0.75 -
 * less than an easy run - while a yoga class scored 1.7.
 */
export function kindFor(a: StravaActivity): string {
  const s = (a.sport_type || a.type || "").toLowerCase();
  if (s.includes("run")) {
    const km = a.distance / 1000;
    if (km >= 15) return "run_long";
    return "run_easy"; // intervals are detected by matching, not by distance
  }
  if (s.includes("weight")) return "strength";
  if (/crossfit|highintensity|hiit|workout|functional/.test(s)) return "hyrox";
  return "strength"; // unknown: score it conservatively, don't inflate it
}

/**
 * Effort points. Weighted by session type so that station work is not
 * undervalued against running, which raw duration would do.
 */
/**
 * What an hour of each kind of session is worth.
 *
 * Exported because a session's kind can be corrected after the fact — a Hyrox class that Strava
 * filed as WeightTraining is scored at 0.75 when it earned 1.7 — and the correction has to use
 * the same table as the original or the two disagree.
 */
export const EFFORT_WEIGHT: Record<string, number> = {
  run_long: 0.95,
  run_easy: 0.8,
  run_intervals: 1.6,
  hyrox: 1.7,
  strength: 0.75,
};

export function effortPoints(a: StravaActivity): number {
  const minutes = a.moving_time / 60;
  const w = EFFORT_WEIGHT[kindFor(a)] ?? 1;
  const hrBump = a.average_heartrate ? Math.max(0.8, a.average_heartrate / 150) : 1;
  return Math.round(minutes * w * hrBump);
}

/**
 * Upsert one Strava activity. Returns the internal activity id.
 *
 * Deliberately does NOT announce anything. Personal bests are computed from
 * kilometre splits, and splits are saved by the caller *after* this returns — so
 * announcing here would read an activity with no splits yet and find no records.
 * The webhook calls onActivity() once the detail is stored; the backfill never
 * calls it at all, which is what keeps years of history silent.
 */
export async function upsertActivity(userId: string, a: StravaActivity) {
  const localDate = a.start_date_local.slice(0, 10);
  const rows = await sql<{ id: string }[]>`
    insert into activities (
      user_id, provider, provider_activity_id, start_time, local_date,
      sport_type, name, moving_seconds, elapsed_seconds, distance_m,
      elevation_m, avg_hr, max_hr, avg_speed_ms, raw
    ) values (
      ${userId}, 'strava', ${String(a.id)}, ${a.start_date}, ${localDate},
      ${a.sport_type ?? a.type}, ${a.name}, ${a.moving_time}, ${a.elapsed_time},
      ${a.distance}, ${a.total_elevation_gain}, ${a.average_heartrate ?? null},
      ${a.max_heartrate ?? null}, ${a.average_speed ?? null}, ${sql.json(a as never)}
    )
    on conflict (provider, provider_activity_id) do update set
      name           = excluded.name,
      moving_seconds = excluded.moving_seconds,
      distance_m     = excluded.distance_m,
      avg_hr         = excluded.avg_hr,
      raw            = excluded.raw
    returning id
  `;
  const activityId = rows[0].id;
  await matchToPlan(userId, activityId, localDate, a);
  return activityId;
}

/**
 * Anything completed under this share of the planned minutes is `adjusted`
 * rather than `done`. The streak survives; the record still tells the truth.
 */
export const ADJUSTED_THRESHOLD = 0.7;

export function statusFor(actualMinutes: number, plannedMinutes: number | null) {
  const planned = plannedMinutes ?? actualMinutes;
  return actualMinutes < planned * ADJUSTED_THRESHOLD ? "adjusted" : "done";
}

/**
 * Of the day's open sessions, the one closest in duration.
 *
 * Sessions with no planned duration rank last rather than scoring a perfect
 * zero: an untimed "Hyrox stations" used to beat the 40-minute easy run for a
 * 41-minute activity, because null was read as "exactly right".
 */
export function pickClosest<T extends { planned_minutes: number | null }>(
  candidates: T[],
  actualMinutes: number,
): T | undefined {
  const distance = (c: T) =>
    c.planned_minutes == null
      ? Number.POSITIVE_INFINITY
      : Math.abs(c.planned_minutes - actualMinutes);
  return [...candidates].sort((x, y) => distance(x) - distance(y))[0];
}

/**
 * Whether an activity could be this session at all.
 *
 * Duration is a weaker signal than the sport, and matching on duration alone produced two
 * confident wrong answers in one week: a 39-minute Strava "Workout" landed on a 40-minute
 * run/walk session because it was one minute closer than the 45-minute strength session it
 * plainly was, and the next day a 36-minute WeightTraining was logged as her key run and the
 * session marked done. Neither activity had a metre of distance on it.
 *
 * `bounds.ts` already refuses to take a running record from a ride — "only the sport is
 * wrong" — and this is the same rule applied one layer earlier, where it decides what the
 * session is rather than what the record is.
 *
 * Only the certain-no cases are ruled out. A Hyrox session gets logged as a Run, a Workout or
 * a Crossfit depending on the day, so nothing is claimed about those. Where the gate leaves no
 * candidate the activity stays unmatched, which is what already happens when nothing was
 * planned, and is the honest answer.
 */
export function couldBe(kind: string, sport: string | null | undefined): boolean {
  const run = isRunSport(sport);
  const ride = /ride|cycl|spin|handcycle/i.test(sport ?? "");
  if (kind === "quality_run" || kind === "easy_run" || kind === "long_run") return run;
  if (kind === "spin") return ride;
  if (kind === "strength") return !run && !ride;
  return true;
}

/**
 * Pair an activity with the session that was planned for that day.
 * Deliberately dumb: same athlete, same local date, still open, the sport has to be
 * possible, and then closest duration wins. A human can re-pair it in the UI; guessing
 * harder than this produces confident wrong answers.
 */
export async function matchToPlan(
  userId: string,
  activityId: string,
  localDate: string,
  a: StravaActivity,
) {
  /*
   * Never re-pair what a human has detached.
   *
   * Unpairing alone bought an hour: this runs on every sync, so the next cron put her weights
   * session straight back on the Hyrox class it had wrongly been paired with. A detachment is
   * a person saying this workout is not that session, and it outlives the sync that caused it.
   */
  const [rejected] = await sql<{ unpaired_at: Date | null }[]>`
    select unpaired_at from activities where id = ${activityId}
  `;
  if (rejected?.unpaired_at) return;
  const open = await sql<{ id: string; kind: string; planned_minutes: number | null }[]>`
    select id, kind, planned_minutes
    from planned_sessions
    where user_id = ${userId}
      and planned_date = ${localDate}
      /*
       * Marked done by hand counts as open, as long as nothing is attached.
       *
       * This read status in ('planned') only, so a session the athlete had already ticked off
       * was invisible to the matcher — and ticking it off is the first thing you do when
       * you finish, minutes before the watch syncs. The activity then had nowhere to go and
       * the session stayed a bare prescription: it happened to her twice in four days, once
       * on the 2 km time trial the whole block calibrates from. A session with no activity
       * behind it is waiting for one, whatever its status says.
       */
      and status in ('planned', 'done')
      and kind <> 'rest'
      and activity_id is null
  `;
  /*
   * The sport gate runs before the duration tiebreak, not after it: filtering afterwards
   * would still let the wrong session win and then discard the right one.
   */
  const candidates = open.filter((c) => couldBe(c.kind, a.sport_type ?? a.type));
  if (candidates.length === 0) return;

  const actual = Math.round(a.moving_time / 60);
  const best = pickClosest(candidates, actual)!;
  const status = statusFor(actual, best.planned_minutes);

  await sql`
    update planned_sessions set
      status         = ${status},
      activity_id    = ${activityId},
      actual_minutes = ${actual},
      effort_points  = ${effortPoints(a)},
      updated_at     = now()
    where id = ${best.id}
  `;
  await sql`
    insert into session_changes (session_id, actor_id, action, reason)
    values (${best.id}, ${userId}, 'completed', ${status === "adjusted" ? "short of plan" : null})
  `;

  /*
   * Ask her now, while she is still standing on the machine.
   *
   * A treadmill syncs one total distance and no structure, so the pace of the only part that
   * mattered — the time trial, the reps — is not in the file and never will be. She is the only
   * person who has that number, and she has it for about a minute. A card on the session screen
   * is no use to somebody who has already put their phone down, so this is a push.
   *
   * Only where there is a genuine gap: a session with stated work, paired with a run whose laps
   * cannot describe it. `needsWorkReport` decides, the same function the screen uses, so the
   * notification and the card can never disagree about whether there is anything to ask.
   */
  await askForWork(userId, best.id, activityId, a);
}

/**
 * Undo a pairing when the activity goes away (deleted in Strava or Garmin).
 *
 * The foreign key is `on delete set null`, so deleting the activity row on its
 * own left the session marked `done` with no activity behind it, a stale
 * actual_minutes and effort points for a run that no longer exists. Put the
 * session back to `planned` and let it be re-paired.
 */
export async function unpairActivity(provider: string, providerActivityId: string) {
  const rows = await sql<{ id: string }[]>`
    update planned_sessions s set
      status         = 'planned',
      activity_id    = null,
      actual_minutes = null,
      effort_points  = null,
      updated_at     = now()
    from activities a
    where a.id = s.activity_id
      and a.provider = ${provider}
      and a.provider_activity_id = ${providerActivityId}
    returning s.id
  `;
  return rows.length;
}

/**
 * The push that goes out when a paired workout cannot tell us what the work was.
 *
 * Best-effort by construction: a notification that fails must never cost the pairing that
 * caused it, so this swallows its own errors the way every other notify caller here does.
 */
async function askForWork(
  userId: string, sessionId: string, activityId: string, a: StravaActivity,
) {
  try {
    const [s] = await sql<{
      title: string; target: string | null; declined: string | null;
    }[]>`
      select title, target, work_report_declined_at as declined
        from planned_sessions where id = ${sessionId}
    `;
    if (!s) return;

    const [counts] = await sql<{ laps: string; lap_sum: string | null; reported: string }[]>`
      select (select count(*) from activity_laps l where l.activity_id = ${activityId}) as laps,
             (select sum(l.distance_m) from activity_laps l where l.activity_id = ${activityId}) as lap_sum,
             (select count(*) from session_work w where w.session_id = ${sessionId}) as reported
    `;

    const shape = workShapeOf(s.title, s.target);
    const ask = needsWorkReport({
      shape,
      treadmill: isTreadmill(a.sport_type ?? a.type, (a as { trainer?: unknown }).trainer),
      lapCount: Number(counts?.laps ?? 0),
      summaryM: a.distance,
      lapSumM: counts?.lap_sum == null ? null : Number(counts.lap_sum),
      alreadyReported: Number(counts?.reported ?? 0) > 0,
      declined: Boolean(s.declined),
    });
    if (!ask || !shape) return;

    const what = shape.kind === "single"
      ? `${shape.distanceM >= 1000 ? `${shape.distanceM / 1000} km` : `${shape.distanceM} m`} time trial`
      : `${shape.count} × ${shape.distanceM} m`;
    await notify(userId, "session_paired", `work:${sessionId}`, {
      title: "What did the clock say?",
      body: `We logged your run, but ${ask.why} — so we cannot see your ${what}. `
        + "Tap to tell us, while you remember.",
      url: `/?session=${sessionId}`,
      tag: `work-${sessionId}`,
    });
  } catch (e) {
    console.error("notify: work report", sessionId, e);
  }
}
