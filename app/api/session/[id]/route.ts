import { NextResponse, after, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { isUuid } from "@/lib/plan";
import { parseSteps, parseStrength, repCount } from "@/lib/prescription";

type Ctx = { params: Promise<{ id: string }> };

type Row = {
  id: string; user_id: string; planned_date: string; title: string; kind: string;
  planned_minutes: number | null; target: string | null; coach_note: string | null;
  status: string; actual_minutes: number | null; skip_reason: string | null;
  effort_points: number | null; source: string; significance: string | null;
  slot: string | null; activity_id: string | null; display_name: string;
};

/**
 * One planned session, with everything the Brief and Strength screens need.
 *
 * Sets are seeded from the prescription the first time a strength session is
 * opened, rather than at materialise time. Two reasons: a session that is never
 * opened leaves no rows behind, and re-reading the prescription at open time
 * means editing the plan is reflected in any session not yet started.
 */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) throw notFound("No such session.");

  const [s] = await sql<Row[]>`
    select p.id, p.user_id, p.planned_date::text as planned_date, p.title, p.kind,
           p.planned_minutes, p.target, p.coach_note, p.status, p.actual_minutes,
           p.skip_reason, p.effort_points, p.source, p.significance, p.slot,
           p.activity_id, u.display_name
      from planned_sessions p join users u on u.id = p.user_id
     where p.id = ${id} limit 1
  `;
  if (!s) throw notFound("No such session.");

  const isStrength = s.kind === "strength";
  const lifts = isStrength ? parseStrength(s.target) : [];

  /*
   * What this athlete last lifted, per exercise.
   *
   * The plan does not prescribe loads — a number nobody has earned is worse than an
   * instruction to work to a hard set — but an empty box every week is worse still:
   * the athlete already knows what they squatted last Tuesday and the app is the
   * thing that recorded it. Pre-filled from their own last logged set, so it starts
   * where they left off and they only touch it when it changes.
   */
  const lastLoads = isStrength && lifts.length > 0
    ? await sql<{ exercise: string; load_kg: number }[]>`
        select distinct on (lower(st.exercise))
               st.exercise, st.load_kg
          from session_sets st
          join planned_sessions p on p.id = st.session_id
         where p.user_id = ${s.user_id} and st.load_kg is not null and st.done
           and lower(st.exercise) = any(${lifts.map((l) => l.name.toLowerCase())})
         order by lower(st.exercise), p.planned_date desc, st.set_no desc
      `
    : [];
  const lastFor = (name: string) =>
    lastLoads.find((r) => r.exercise.toLowerCase() === name.toLowerCase())?.load_kg ?? null;

  if (isStrength && lifts.length > 0) {
    // seed one row per prescribed set, once. `on conflict do nothing` is what
    // makes re-opening the screen harmless.
    for (const [ord, lift] of lifts.entries()) {
      const seed = lift.load ?? lastFor(lift.name);
      for (let n = 1; n <= Math.max(1, lift.sets); n++) {
        await sql`
          insert into session_sets
            (session_id, exercise, ord, set_no, prescribed_load, prescribed_reps, load_kg, reps)
          values (${id}, ${lift.name}, ${ord}, ${n}, ${lift.load}, ${lift.reps || null},
                  ${seed}, ${lift.reps || null})
          on conflict (session_id, ord, set_no) do nothing
        `;
      }
    }
  }

  const [sets, feedback, comments, activity] = await Promise.all([
    sql`
      select id, exercise, ord, set_no, prescribed_load, prescribed_reps,
             load_kg, reps, done, note
        from session_sets where session_id = ${id} order by ord, set_no
    `,
    sql`select rpe, length_feel, note from session_feedback where session_id = ${id}`,
    sql`
      select c.id, c.body, c.created_at, c.author_id, u.display_name
        from session_comments c join users u on u.id = c.author_id
       where c.session_id = ${id} order by c.created_at
    `,
    s.activity_id
      ? sql`select id, name, moving_seconds, distance_m, avg_hr from activities where id = ${s.activity_id}`
      : Promise.resolve([]),
  ]);

  const steps = isStrength ? [] : parseSteps(s.target);

  return NextResponse.json({
    session: s,
    steps,
    reps: repCount(steps),
    lifts,
    sets: sets.map((r) => ({
      ...r,
      prescribed_load: r.prescribed_load == null ? null : Number(r.prescribed_load),
      load_kg: r.load_kg == null ? null : Number(r.load_kg),
    })),
    feedback: feedback[0] ?? null,
    comments,
    activity: activity[0] ?? null,
  });
});

/**
 * Everything the two screens write: a set, the RPE, a comment.
 *
 * One route rather than three because they all belong to the same session and
 * all need the same lookup — and because a session screen that has to know
 * three endpoints is a session screen that will eventually call the wrong one.
 */
export const PATCH = route(async (req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) throw notFound("No such session.");
  const body = await req.json();

  const [s] = await sql<{ id: string; user_id: string }[]>`
    select id, user_id from planned_sessions where id = ${id}
  `;
  if (!s) throw notFound("No such session.");

  switch (body?.action) {
    // ---------------------------------------------------------------- a set
    case "set": {
      const { set_id, load_kg, reps, done } = body;
      if (!isUuid(set_id)) throw badRequest("Which set?");
      // Clamped rather than rejected: the stepper is a thumb on a phone, and an
      // accidental negative should stop at zero rather than throw a 400 at
      // someone mid-session.
      const load = load_kg == null ? null : Math.max(0, Math.min(500, Number(load_kg)));
      const r = reps == null ? null : Math.max(0, Math.min(200, Math.round(Number(reps))));
      await sql`
        update session_sets
           set load_kg = ${load}, reps = ${r},
               done = ${done === undefined ? sql`done` : Boolean(done)},
               updated_at = now()
         where id = ${set_id} and session_id = ${id}
      `;
      return NextResponse.json({ ok: true });
    }

    // --------------------------------------------------------- how it felt
    case "feedback": {
      const rpe = body.rpe == null ? null : Math.max(1, Math.min(10, Math.round(Number(body.rpe))));
      const feel = ["short", "right", "long"].includes(body.length_feel) ? body.length_feel : null;
      await sql`
        insert into session_feedback (session_id, rpe, length_feel, note, updated_at)
        values (${id}, ${rpe}, ${feel}, ${body.note ?? null}, now())
        on conflict (session_id) do update set
          rpe = coalesce(excluded.rpe, session_feedback.rpe),
          length_feel = coalesce(excluded.length_feel, session_feedback.length_feel),
          note = coalesce(excluded.note, session_feedback.note),
          updated_at = now()
      `;
      return NextResponse.json({ ok: true });
    }

    // ------------------------------------------------------------- a message
    case "comment": {
      const text = String(body.body ?? "").trim();
      if (!text) throw badRequest("Nothing to send.");
      if (text.length > 2000) throw badRequest("That's too long for a note.");
      const [c] = await sql<{ id: string; created_at: string }[]>`
        insert into session_comments (session_id, author_id, body)
        values (${id}, ${me.id}, ${text})
        returning id, created_at
      `;
      // the other athlete is told, unless they wrote it
      after(async () => {
        const { notifyComment } = await import("@/lib/rules");
        await notifyComment(id, me.id, text).catch((e) => console.error("notify: comment", e));
      });
      return NextResponse.json({ id: c.id, created_at: c.created_at });
    }

    // ------------------------------------------- mark it done by hand
    case "complete": {
      const done = body.done !== false;
      await sql`
        update planned_sessions
           set status = ${done ? "done" : "planned"}, updated_at = now()
         where id = ${id}
      `;
      return NextResponse.json({ ok: true });
    }

    default:
      throw badRequest("Unknown action.");
  }
});
