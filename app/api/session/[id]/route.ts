import { NextResponse, after, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { applyLengthFeel } from "@/lib/strength-apply";
import { applyRunFeel } from "@/lib/volume-apply";

/** The kinds whose length is about weekly volume rather than exercise count. */
const RUN_KINDS = new Set([
  "easy_run", "long_run", "quality_run", "run_easy", "run_long", "run_intervals",
]);
import { isUuid } from "@/lib/plan";
import { parseSteps, parseStrength, repCount } from "@/lib/prescription";
import { describe, loadNote, startingLoad } from "@/lib/plan/exercises";
import { nextLoad } from "@/lib/plan/progression";
import { sayRpe } from "@/lib/plan/strength";
import { notify } from "@/lib/notify";
import { afterLine } from "@/lib/coach-copy";
import { effortPoints, statusFor, type StravaActivity } from "@/lib/ingest";

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
  /*
   * Every set of the most recent session that used each movement — not just its load.
   *
   * The load alone told us where they were and nothing about whether it was right. Reps
   * against prescription and the effort they reported are what decide whether next week
   * goes up, holds or comes down, so the whole session comes back.
   */
  const history = isStrength && lifts.length > 0
    ? await sql<{
      exercise: string; load_kg: number | null; reps: number | null;
      prescribed_reps: number | null; done: boolean; rpe: number | null;
    }[]>`
        with latest as (
          select lower(st.exercise) as key, max(p.planned_date) as on_date
            from session_sets st
            join planned_sessions p on p.id = st.session_id
           where p.user_id = ${s.user_id} and p.id <> ${id}
             and st.load_kg is not null and st.done
             and lower(st.exercise) = any(${lifts.map((l) => l.name.toLowerCase())})
           group by 1
        )
        select st.exercise, st.load_kg, st.reps, st.prescribed_reps, st.done, st.rpe
          from session_sets st
          join planned_sessions p on p.id = st.session_id
          join latest l on l.key = lower(st.exercise) and l.on_date = p.planned_date
         where p.user_id = ${s.user_id}
         order by lower(st.exercise), st.set_no
      `
    : [];
  const setsFor = (name: string) => history
    .filter((r) => r.exercise.toLowerCase() === name.toLowerCase())
    .map((r) => ({
      load_kg: r.load_kg == null ? null : Number(r.load_kg),
      reps: r.reps, prescribed_reps: r.prescribed_reps, done: r.done, rpe: r.rpe,
    }));
  /** Where last week got to, and where it should go next. */
  const stepFor = (name: string, rpe: number | null) => {
    const sets = setsFor(name);
    return sets.length ? nextLoad(sets, rpe ?? 7) : null;
  };
  const lastFor = (name: string, rpe: number | null) => stepFor(name, rpe)?.load ?? null;

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
      /*
       * Last week's load, progressed — then the bodyweight estimate, then nothing.
       *
       * The plan writes no load of its own on purpose: a number nobody has earned is
       * worse than an effort target. What it can do is remember what they lifted and
       * move it in the right direction.
       */
      const seed = lift.load
        ?? lastFor(lift.name, lift.rpe ?? null)
        ?? guessFor(lift.name, lift.reps);
      for (let n = 1; n <= Math.max(1, lift.sets); n++) {
        await sql`
          insert into session_sets
            (session_id, exercise, ord, set_no, prescribed_load, prescribed_reps, load_kg, reps)
          values (${id}, ${lift.name}, ${ord}, ${n}, ${lift.load}, ${lift.reps || null},
                  ${seed}, ${lift.reps || null})
          on conflict (session_id, ord, set_no) do nothing
        `;
        /*
         * And fill a box that is still empty.
         *
         * `do nothing` is what makes re-opening the screen harmless, and it is also why
         * nothing ever appeared: the rows were created the first time he opened the
         * session, before there was any estimate to seed them with, and every visit since
         * has inserted nothing and updated nothing. His bodyweight was on file the whole
         * time.
         *
         * Only untouched rows: no load logged, no reps changed from the prescription, not
         * ticked off. A number the athlete has entered is theirs.
         */
        if (seed != null) {
          await sql`
            update session_sets set load_kg = ${seed}
             where session_id = ${id} and ord = ${ord} and set_no = ${n}
               -- A zero is an empty box somebody tapped, not a load.
               and (load_kg is null or load_kg = 0) and not done
               and (reps is null or reps = prescribed_reps)
          `;
        }
      }
    }
  }

  const [sets, feedback, comments, activity, pairable] = await Promise.all([
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
    /*
     * What this session could be, when nothing is attached to it.
     *
     * The screen has always had a button here labelled "Link Strava" whose click handler
     * was `s.activity_id && openActivity(...)` — dead in exactly the case the label
     * described. Nothing in the app could attach a recorded workout to a session it had
     * missed, and a session marked done by hand before the watch synced stayed empty
     * forever. These are the athlete's own unattached activities either side of the day,
     * newest first; a day either way because a late-evening session syncs after midnight
     * and a morning one is sometimes yesterday's date on the watch.
     */
    s.activity_id
      ? Promise.resolve([])
      : sql`
          select a.id, a.name, a.sport_type, a.local_date::text as local_date,
                 a.moving_seconds, a.distance_m, a.avg_hr
            from activities a
           where a.user_id = ${s.user_id}
             and a.local_date between ${s.planned_date}::date - 1 and ${s.planned_date}::date + 1
             and not exists (select 1 from planned_sessions p where p.activity_id = a.id)
           order by a.start_time desc
      `,
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
    const step = stepFor(l.name, l.rpe ?? null);
    const estimate = step === null && l.load == null
      ? guessFor(l.name, l.reps) : null;
    return {
      name: l.name,
      what: ex?.what ?? null,
      how: ex?.how ?? null,
      /** the effort to take the set to, and what that means in reps left */
      rpe: l.rpe ?? null,
      rpe_means: l.rpe ? sayRpe(l.rpe) : null,
      /*
       * Where the number came from, said plainly. Three possible answers and they mean
       * very different things: their own last session, an estimate from their
       * bodyweight, or nothing at all.
       */
      source: step ? "your last session" : estimate ? "your bodyweight" : null,
      estimated_load: estimate,
      /** how last week moved it, so the change is explained rather than mysterious */
      progression: step && step.verdict !== "unknown"
        ? { verdict: step.verdict, why: step.why } : null,
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
    /** recorded workouts this session could be, for the pairing picker */
    pairable,
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

  const [s] = await sql<{
    id: string; user_id: string; kind: string;
    planned_minutes: number | null; activity_id: string | null;
  }[]>`
    select id, user_id, kind, planned_minutes, activity_id
      from planned_sessions where id = ${id}
  `;
  if (!s) throw notFound("No such session.");

  switch (body?.action) {
    /*
     * ------------------------------------------------- this workout was this session
     *
     * The matcher pairs on ingest and gets it right most days. What it cannot do is
     * reach a session that was already closed: it only considers sessions still open,
     * so tapping "Mark it done" before the watch syncs orphans the activity for good.
     * It happened to her twice in four days — a 2 km time trial and a Hyrox class, both
     * recorded, both showing an empty prescription.
     *
     * So the pairing is something an athlete can do by hand, from the session, choosing
     * from their own unattached workouts. Same fields the matcher writes, so a session
     * paired here is indistinguishable from one paired automatically — and the change log
     * says which it was.
     */
    case "pair": {
      const activityId = String(body.activity_id ?? "");
      if (!isUuid(activityId)) throw badRequest("Which workout?");
      if (s.activity_id) throw badRequest("Something is already attached to this session.");

      /*
       * Theirs, and not already spoken for. Both checks are the same check really — an
       * activity id is guessable, and pairing somebody else's run to your session would
       * write their minutes into your week.
       */
      const [a] = await sql<{
        id: string; moving_seconds: number | null; distance_m: number | null;
        avg_hr: number | null; sport_type: string | null; taken: boolean;
      }[]>`
        select a.id, a.moving_seconds, a.distance_m, a.avg_hr, a.sport_type,
               exists (select 1 from planned_sessions p where p.activity_id = a.id) as taken
          from activities a
         where a.id = ${activityId} and a.user_id = ${s.user_id}
      `;
      if (!a) throw notFound("No such workout.");
      if (a.taken) throw badRequest("That workout is already on another session.");

      const actual = Math.round(Number(a.moving_seconds ?? 0) / 60);
      /*
       * Scored by the same function the ingest uses, from the columns it scored on: the
       * sport decides the weighting, the duration the size, the heart rate the bump. A
       * second scoring rule here would drift from that one within a month.
       */
      const points = effortPoints({
        sport_type: a.sport_type ?? "",
        type: a.sport_type ?? "",
        distance: Number(a.distance_m ?? 0),
        moving_time: Number(a.moving_seconds ?? 0),
        average_heartrate: a.avg_hr == null ? undefined : Number(a.avg_hr),
      } as StravaActivity);

      await sql`
        update planned_sessions
           set status         = ${statusFor(actual, s.planned_minutes)},
               activity_id    = ${activityId},
               actual_minutes = ${actual},
               effort_points  = ${points},
               updated_at     = now()
         where id = ${id}
      `;
      await sql`
        insert into session_changes (session_id, actor_id, action, reason)
        values (${id}, ${me.id}, 'completed', 'paired by hand')
      `;
      return NextResponse.json({ ok: true });
    }

    /*
     * And the way back out, because a wrong pairing is worse than none: it leaves the
     * session looking finished and the real workout unattached. Everything the pairing
     * wrote comes off, including the status — a session with nothing behind it is not done.
     */
    case "unpair": {
      await sql`
        update planned_sessions
           set status         = 'planned',
               activity_id    = null,
               actual_minutes = null,
               effort_points  = null,
               updated_at     = now()
         where id = ${id}
      `;
      await sql`
        insert into session_changes (session_id, actor_id, action, reason)
        values (${id}, ${me.id}, 'unpaired', 'detached by hand')
      `;
      return NextResponse.json({ ok: true });
    }

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
      /*
       * And on a run, the same report moves the weekly volume.
       *
       * The dial was answered once at intake and never revisited, so an athlete finding
       * week 3 easy had no way to say it. Same two-in-a-row rule as the strength session's
       * length, pointed at the weekly curve instead of the accessory count.
       */
      else if (feel && RUN_KINDS.has(s.kind)) said = await applyRunFeel(me.id);

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
      /*
       * A key session finished earns a reward, once.
       *
       * Queued rather than shown, because she will be standing outside with a phone in a sweaty
       * hand and this is not the moment: the notification arrives, and the screen is waiting when
       * she opens the app. Only for an athlete who has a reward image set — the picture is hers,
       * and handing somebody else's in-joke to a different athlete is worse than no reward.
       *
       * `on conflict do nothing` on the session, so ticking a session off and on again does not
       * queue a second. The first time is the achievement.
       */
      if (done) {
        const [r] = await sql<{
          user_id: string; title: string; kind: string; significance: string | null;
          images: Record<string, string[]> | null;
        }[]>`
          select p.user_id, p.title, p.kind, p.significance, u.reward_images as images
            from planned_sessions p join users u on u.id = p.user_id
           where p.id = ${id}
        `;

        /*
         * Which kind of reward a session earns, if any.
         *
         * Three, because the pictures are about three different feelings: the run that hurt, the
         * gym session that hurt differently, and the one day of the block that happens once.
         * "First HYROX done" is not a reward for a Tuesday.
         */
        const rewardKind = r?.kind === "race" ? "race"
          : r?.kind === "strength" ? "strength"
          : (r?.significance === "key" || r?.kind === "quality_run" || r?.kind === "long_run")
            ? "key_session"
            : null;

        const set = (rewardKind && r?.images?.[rewardKind]) || [];
        if (r && rewardKind && set.length > 0) {
          /*
           * Rotated by how many of that kind she has already earned, counted per kind — a race must
           * not advance the weekly rotation and a lift must not burn a race picture. The same
           * picture every week stops being a reward by about the fourth one.
           */
          const [{ earned }] = await sql<{ earned: number }[]>`
            select count(*)::int as earned from rewards
             where user_id = ${r.user_id} and kind = ${rewardKind}
          `;
          const image = set[earned % set.length];
          const fresh = await sql<{ session_id: string }[]>`
            insert into rewards (session_id, user_id, kind, image)
            values (${id}, ${r.user_id}, ${rewardKind}, ${image})
            on conflict (session_id) do nothing
            returning session_id
          `;
          if (fresh.length > 0) {
            /*
             * In his words where she has them, counted so a line does not repeat until the pool is
             * used up. `earned` is the count before this reward, which makes the choice reproducible
             * rather than random — random sends the same line twice in a week often enough to be
             * noticed, and being noticed is the one thing this cannot survive.
             */
            const [{ voice }] = await sql<{ voice: boolean }[]>`
              select coalesce(coach_voice, false) as voice from users where id = ${r.user_id}
            `;
            await notify(r.user_id, "reward", `reward:${id}`, {
              title: voice
                ? (rewardKind === "race" ? "You did it amorzinho"
                  : rewardKind === "strength" ? "Leg day survived bebezinho"
                  : "That was a hard one bebezinho")
                : (rewardKind === "race" ? "You raced a Hyrox"
                  : rewardKind === "strength" ? "Leg day survived"
                  : "That is the hard one done"),
              body: voice ? afterLine(earned) : `${r.title} — logged. Open the app.`,
              url: "/?reward=1",
            });
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    default:
      throw badRequest("Unknown action.");
  }
});
