import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { materialise } from "@/lib/templates";
import {
  EQUIPMENT, EXPERIENCE, GOAL_KIND, GYM_ACCESS,
  type Equipment, type Intake, generate, validate,
} from "@/lib/intake";

/**
 * The intake: what the athlete says about themselves, and the block it builds.
 *
 * Submitting it writes three things in one go — the answers, a plan row derived
 * from them, and the first weeks of sessions — because a form that stores answers
 * and produces nothing visible is indistinguishable from a form that did nothing.
 */

export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await sql<(Intake & { completed_at: string })[]>`
    select experience, current_km_week::float8 as current_km_week,
           longest_run_km::float8 as longest_run_km, recent_5k_seconds,
           goal_kind, goal_race_name, goal_date::text as goal_date, goal_time_seconds,
           days_per_week, preferred_days, long_run_day, gym_access, equipment,
           injuries, constraints_note, completed_at::text as completed_at
      from athlete_intake where user_id = ${me.id}
  `;
  const [plan] = await sql<{ id: string; name: string }[]>`
    select id, name from plan_templates where athlete_id = ${me.id} and active limit 1
  `;
  return NextResponse.json({
    intake: row ?? null,
    plan: plan ?? null,
    options: {
      experience: EXPERIENCE, goal_kind: GOAL_KIND,
      gym_access: GYM_ACCESS, equipment: EQUIPMENT,
    },
  });
});

/** Read a submitted form into the shape the generator takes. Nothing is guessed. */
function parse(body: Record<string, unknown>): Intake {
  const int = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const str = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
  };
  const days = Array.isArray(body.preferred_days)
    ? body.preferred_days.map(int).filter((d): d is number => d != null && d >= 0 && d <= 6)
    : [];
  const kit = Array.isArray(body.equipment)
    ? body.equipment.filter((e): e is Equipment => EQUIPMENT.includes(e as Equipment))
    : [];

  return {
    experience: body.experience as Intake["experience"],
    current_km_week: num(body.current_km_week),
    longest_run_km: num(body.longest_run_km),
    recent_5k_seconds: int(body.recent_5k_seconds),
    goal_kind: body.goal_kind as Intake["goal_kind"],
    goal_race_name: str(body.goal_race_name),
    goal_date: str(body.goal_date),
    goal_time_seconds: int(body.goal_time_seconds),
    days_per_week: int(body.days_per_week) ?? 0,
    preferred_days: [...new Set(days)],
    long_run_day: int(body.long_run_day),
    gym_access: body.gym_access as Intake["gym_access"],
    equipment: [...new Set(kit)],
    injuries: str(body.injuries),
    constraints_note: str(body.constraints_note),
  };
}

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const intake = parse(await req.json());

  const problems = validate(intake);
  if (problems.length > 0) {
    // the whole list, not the first: a form that reveals one problem per submit
    // is a form people abandon
    return NextResponse.json({ problems }, { status: 400 });
  }

  const plan = generate(intake);
  if (plan.weeks < 2) throw badRequest("That leaves too little time to build a block.");

  await sql`
    insert into athlete_intake (
      user_id, experience, current_km_week, longest_run_km, recent_5k_seconds,
      goal_kind, goal_race_name, goal_date, goal_time_seconds,
      days_per_week, preferred_days, long_run_day, gym_access, equipment,
      injuries, constraints_note, updated_at
    ) values (
      ${me.id}, ${intake.experience}, ${intake.current_km_week}, ${intake.longest_run_km},
      ${intake.recent_5k_seconds}, ${intake.goal_kind}, ${intake.goal_race_name},
      ${intake.goal_date}, ${intake.goal_time_seconds}, ${intake.days_per_week},
      ${intake.preferred_days}, ${intake.long_run_day}, ${intake.gym_access},
      ${intake.equipment}, ${intake.injuries}, ${intake.constraints_note}, now()
    )
    on conflict (user_id) do update set
      experience = excluded.experience, current_km_week = excluded.current_km_week,
      longest_run_km = excluded.longest_run_km, recent_5k_seconds = excluded.recent_5k_seconds,
      goal_kind = excluded.goal_kind, goal_race_name = excluded.goal_race_name,
      goal_date = excluded.goal_date, goal_time_seconds = excluded.goal_time_seconds,
      days_per_week = excluded.days_per_week, preferred_days = excluded.preferred_days,
      long_run_day = excluded.long_run_day, gym_access = excluded.gym_access,
      equipment = excluded.equipment, injuries = excluded.injuries,
      constraints_note = excluded.constraints_note, updated_at = now()
  `;

  // Retaking the intake replaces the block rather than adding a second one. Only
  // sessions still untouched go: anything logged, moved or commented on is a
  // record of what happened and survives a change of plan.
  const old = await sql<{ id: string }[]>`
    select id from plan_templates where athlete_id = ${me.id} and active
  `;
  for (const t of old) {
    await sql`
      delete from planned_sessions
       where user_id = ${me.id} and source = 'template'
         and source_ref like ${t.id + "%"}
         and status = 'planned' and activity_id is null
         and planned_date >= current_date
         and not exists (select 1 from session_comments c where c.session_id = planned_sessions.id)
         and not exists (select 1 from session_sets s where s.session_id = planned_sessions.id)
    `;
    await sql`update plan_templates set active = false where id = ${t.id}`;
  }

  const [tpl] = await sql<{ id: string }[]>`
    insert into plan_templates (
      athlete_id, author_id, name, start_date, weeks, rules, horizon, active,
      race_date, race_name, goal_label, goal_seconds, volume, intents
    ) values (
      ${me.id}, ${me.id}, ${plan.name}, ${plan.start},
      ${sql.json(plan.shapes as never)}, ${sql.json(plan.rules as never)}, 3, true,
      ${plan.race_date}, ${plan.race_name}, ${plan.goal_label}, ${plan.goal_seconds},
      ${sql.json(plan.volume as never)}, ${sql.json(plan.intents as never)}
    )
    on conflict (athlete_id, name) do update set
      start_date = excluded.start_date, weeks = excluded.weeks, rules = excluded.rules,
      active = true, race_date = excluded.race_date, race_name = excluded.race_name,
      goal_label = excluded.goal_label, goal_seconds = excluded.goal_seconds,
      volume = excluded.volume, intents = excluded.intents
    returning id
  `;
  const { created } = await materialise(tpl.id);

  return NextResponse.json({
    ok: true,
    plan: {
      id: tpl.id, name: plan.name, weeks: plan.weeks, start: plan.start,
      race_date: plan.race_date, total_km: plan.volume.reduce((n, v) => n + v.km, 0),
    },
    sessions_created: created,
  });
});
