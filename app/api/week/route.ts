import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { blockFor } from "@/lib/block-db";
import { challengeScores, metricForWeek, METRICS, streakFor, weekStart } from "@/lib/scoring";
import { route } from "@/lib/http";
import { addDays, mondayOf, today } from "@/lib/dates";
import { isDateString } from "@/lib/plan";
import { classifySegments, type LapRow } from "@/lib/analysis";
import { prescribedPace } from "@/lib/signals";

/** Everything one week's screen needs, in a single round trip. */
export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
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
           a.avg_hr, a.distance_m, a.moving_seconds, a.name as activity_name,
           -- lets the sheet offer the detail view, and only when there is one
           s.activity_id,
           -- what makes the day worth arriving fresh for, and which half of it
           s.significance, s.slot
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
           a.avg_hr, a.distance_m, a.id as activity_id
    from activities a
    where a.local_date >= ${ws} and a.local_date < ${end}
      and not exists (select 1 from planned_sessions p where p.activity_id = a.id)
  `;

  /**
   * How many work reps this week landed more than 5 s/km off prescription.
   *
   * The plan is explicit that this — not average pace — is the number that
   * matters: "how many reps were more than 5 s/km off? That number is the
   * metric." Counted off the work laps of every completed session that states a
   * pace, so a session with no laps contributes nothing rather than a zero.
   */
  /*
   * One query for every session's laps, not one per session.
   *
   * This ran inside the loop, so a full week of completed sessions meant up to
   * ten sequential round trips to build one number — and every one of them was
   * crossing the Atlantic until the region was fixed. Fetched together and
   * grouped in memory: the rows are small and there are at most a few hundred.
   */
  const wanted = sessions
    .filter((s) => prescribedPace(String(s.title ?? "")) && s.activity_id
      && ["done", "adjusted"].includes(String(s.status)))
    .map((s) => String(s.activity_id));

  const lapsByActivity = new Map<string, LapRow[]>();
  if (wanted.length > 0) {
    const rows = await sql<(LapRow & { activity_id: string })[]>`
      select activity_id, lap_index, name, distance_m, moving_seconds, elapsed_seconds,
             avg_speed_ms, max_speed_ms, avg_hr, max_hr
        from activity_laps
       where activity_id = any(${wanted})
       order by activity_id, lap_index
    `;
    for (const r of rows) {
      const list = lapsByActivity.get(r.activity_id) ?? [];
      list.push(r);
      lapsByActivity.set(r.activity_id, list);
    }
  }

  let repsOff = 0;
  for (const s of sessions) {
    const pace = prescribedPace(String(s.title ?? ""));
    if (!pace || !s.activity_id || !["done", "adjusted"].includes(String(s.status))) continue;
    const laps = lapsByActivity.get(String(s.activity_id)) ?? [];
    if (laps.length === 0) continue;
    const n = (v: unknown) => (v == null ? null : Number(v));
    const { segments } = classifySegments(laps.map((l) => ({
      ...l,
      distance_m: n(l.distance_m), moving_seconds: n(l.moving_seconds),
      elapsed_seconds: n(l.elapsed_seconds), avg_speed_ms: n(l.avg_speed_ms),
      max_speed_ms: n(l.max_speed_ms), avg_hr: n(l.avg_hr), max_hr: n(l.max_hr),
    })));
    for (const seg of segments) {
      if (seg.role !== "work" || !seg.avg_speed_ms) continue;
      if (Math.abs(1000 / Number(seg.avg_speed_ms) - pace) > 5) repsOff++;
    }
  }

  const metric = metricForWeek(ws);
  const scores = await challengeScores(ws, metric);
  const streaks = Object.fromEntries(
    await Promise.all(users.map(async (u) => [u.id, await streakFor(u.id)])),
  );

  // THIS athlete's block, not the app's.
  //
  // Its start, race, goal, volume table and phase narrative used to be module
  // constants in lib/coach.ts, so every screen that read them showed the same
  // block to whoever was signed in — the second athlete saw the first's race and
  // target as hers. Same mistake as the HR zones, which were one athlete's
  // measured maximum applied to both. Null when she has no plan, and the screens
  // have to say so rather than fall back to someone else's.
  const block = await blockFor(me.id);

  return NextResponse.json({
    week_start: ws,
    block,
    users,
    sessions,
    unplanned,
    streaks,
    reps_off: repsOff,
    challenge: { metric, label: METRICS[metric], scores },
  });
});
