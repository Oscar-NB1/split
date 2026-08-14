import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { challengeScores, metricForWeek, METRICS, streakFor, weekStart } from "@/lib/scoring";
import { route } from "@/lib/http";
import { addDays, mondayOf, today } from "@/lib/dates";
import { isDateString } from "@/lib/plan";

/** Everything one week's screen needs, in a single round trip. */
export const GET = route(async (req: NextRequest) => {
  await requireUser();
  // snapped to a Monday: a mid-week date used to give this week's challenge
  // metric over a Wednesday-to-Wednesday scoring window
  const asked = new URL(req.url).searchParams.get("week");
  const ws = mondayOf(isDateString(asked) ? asked! : today());
  const end = addDays(ws, 7);

  const users = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users order by created_at
  `;

  const sessions = await sql`
    select s.id, s.user_id, s.planned_date::text as planned_date, s.title, s.kind,
           s.planned_minutes, s.target, s.coach_note, s.status, s.actual_minutes,
           s.skip_reason, s.effort_points, s.source,
           a.avg_hr, a.distance_m, a.moving_seconds, a.name as activity_name
    from planned_sessions s
    left join activities a on a.id = s.activity_id
    where s.planned_date >= ${ws} and s.planned_date < ${end} and s.status <> 'moved'
    order by s.planned_date, s.created_at
  `;

  // Activities with nothing planned against them - still worth showing.
  // status and source are set explicitly: the UI folds these into the same
  // list as planned sessions, and undefined columns made an unplanned run
  // render as an unstarted plan with an empty rail.
  const unplanned = await sql`
    select a.id, a.user_id, a.local_date::text as planned_date, a.name as title,
           a.sport_type as kind, (a.moving_seconds/60)::int as actual_minutes,
           'unplanned' as status, 'strava' as source, null::int as planned_minutes,
           a.avg_hr, a.distance_m
    from activities a
    where a.local_date >= ${ws} and a.local_date < ${end}
      and not exists (select 1 from planned_sessions p where p.activity_id = a.id)
  `;

  const metric = metricForWeek(ws);
  const scores = await challengeScores(ws, metric);
  const streaks = Object.fromEntries(
    await Promise.all(users.map(async (u) => [u.id, await streakFor(u.id)])),
  );

  const wellness = await sql`
    select user_id, local_date::text as local_date, recovery, strain, sleep_hours
    from wellness where local_date >= ${ws} and local_date < ${end}
  `;

  return NextResponse.json({
    week_start: ws,
    users,
    sessions,
    unplanned,
    wellness,
    streaks,
    challenge: { metric, label: METRICS[metric], scores },
  });
});
