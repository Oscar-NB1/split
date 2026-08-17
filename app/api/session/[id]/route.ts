import { NextResponse, after, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { applyLengthFeel } from "@/lib/strength-apply";
import { isUuid } from "@/lib/plan";
import { parseSteps, parseStrength, repCount } from "@/lib/prescription";
import { describe, loadNote, startingLoad } from "@/lib/plan/exercises";

type Ctx = { params: Promise<{ id: string }> };

type Row = {
  id: string; user_id: string; planned_date: string; title: string; kind: string;
  planned_minutes: number | null; target: string | null; coach_note: string | null;
  status: string; actual_minutes: number | null; skip_reason: string | null;
  effort_points: number | null; source: string; significance: string | null;
  slot: string | null; activity_id: string | null; display_name: string;
  author_name: string | null; author_avatar: string | null;
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
           p.activity_id, u.display_name,
           /*
            * Who wrote the session, for the note it carries.
            *
            * The "why this session matters" card is a message from whoever programmed
            * the week, and it should look like one — a name and a face rather than an
            * information icon. Left-joined because a session an athlete added
            * themselves has no author.
            */
           a.display_name as author_name, a.avatar_url as author_avatar
      from planned_sessions p
      join users u on u.id = p.user_id
      left join users a on a.id = p.author_id
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

  /*
   * And a starting number for anything they have never lifted here.
   *
   * History is best and there is none in a first block, so every set showed "—" and
   * the athlete guessed — which is the one part of a strength session a plan can
   * genuinely help with. Nobody can know a stranger's back squat, but a coach handed a
   * new athlete does not shrug: they look at bodyweight and training history, name a
   * number, and correct it after the first set.
   *
   * Bodyweight is required rather than assumed. Guessing it would make every number
   * downstream a guess about a guess, and the screen can ask for one instead.
   */
  const [body] = isStrength && lifts.length > 0
    ? await sql<{ weight_kg: number | null; general_training_age: string | null }[]>`
        select weight_kg, general_training_age from users where id = ${s.user_id}
      `
    : [];
  const guessFor = (name: string, reps: number) => startingLoad(
    name, reps, body?.weight_kg ? Number(body.weight_kg) : null,
    body?.general_training_age ?? "intermediate",
  );

  if (isStrength && lifts.length > 0) {
    // seed one row per prescribed set, once. `on conflict do nothing` is what
    // makes re-opening the screen harmless.
    for (const [ord, lift] of lifts.entries()) {
      // Their own history first, then the bodyweight estimate, then nothing.
      const seed = lift.load ?? lastFor(lift.name) ?? guessFor(lift.name, lift.reps);
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

  /*
   * What each movement is, sent with the session.
   *
   * "Rear-foot elevated split squat" is a sentence in a language somebody has to
   * already speak. The description travels with the lift so the screen can put it
   * behind a tap rather than shipping a glossary.
   */
  const guidance = lifts.map((l) => {
    const ex = describe(l.name);
    const estimate = lastFor(l.name) === null && l.load == null
      ? guessFor(l.name, l.reps) : null;
    return {
      name: l.name,
      what: ex?.what ?? null,
      how: ex?.how ?? null,
      /** set only where the number came from bodyweight rather than their own history */
      estimated_load: estimate,
      note: estimate ? loadNote(Boolean(ex?.perHand)) : null,
    };
  });

  return NextResponse.json({
    session: s,
    steps,
    reps: repCount(steps),
    lifts,
    guidance,
    /** so the screen can ask for a bodyweight rather than showing empty boxes */
    needs_bodyweight: isStrength && lifts.length > 0 && !body?.weight_kg,
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

  const [s] = await sql<{ id: string; user_id: string; kind: string }[]>`
    select id, user_id, kind from planned_sessions where id = ${id}
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
      /*
       * And on a strength session, the report changes the next one.
       *
       * This is the whole point of asking. Stored and never read, "too long" is a
       * question with no consequence, and an athlete works that out in about three
       * weeks and stops answering.
       */
      let said: string | null = null;
      if (feel && s.kind === "strength") said = await applyLengthFeel(me.id, feel);

      return NextResponse.json({ ok: true, said });
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
