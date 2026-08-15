import { NextResponse, after, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { pushSession, removeSession } from "@/lib/intervals";
import { badRequest, notFound, route } from "@/lib/http";
import { isDateString, isUuid, lighten, scaledTitle, SKIP_REASONS } from "@/lib/plan";
import { onSkip } from "@/lib/rules";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Session actions. Three outcomes, never a silent gap:
 *
 *   move   - same session, new date. Full adherence credit.
 *   scale  - a lighter version replaces it. Streak survives, points scale.
 *   skip   - gone, with a reason. NO debt: nothing rolls into next week.
 *            Fatigue reasons feed the template engine, which cuts next
 *            week's volume automatically.
 */
export const PATCH = route(async (req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  const { id } = await params;
  // Postgres rejects a malformed uuid as a 500; this is a 404 like any other
  // session that isn't there
  if (!isUuid(id)) throw notFound("That session no longer exists.");
  const body = await req.json();

  const [s] = await sql<{
    id: string; user_id: string; planned_date: string; planned_minutes: number | null;
    title: string; kind: string;
  }[]>`
    select id, user_id, planned_date::text as planned_date, planned_minutes, title, kind
    from planned_sessions where id = ${id}
  `;
  if (!s) throw notFound("That session no longer exists.");

  switch (body.action) {
    case "move": {
      // validated: an undefined to_date used to null out planned_date and 500
      if (!isDateString(body.to_date)) throw badRequest("to_date must be YYYY-MM-DD.");
      const warn = await adjacencyWarning(s.user_id, body.to_date, s.kind, s.id);
      await sql`
        update planned_sessions
        set planned_date = ${body.to_date}, updated_at = now()
        where id = ${id}
      `;
      await sql`
        insert into session_changes (session_id, actor_id, action, from_date, to_date, reason)
        values (${id}, ${me.id}, 'moved', ${s.planned_date}, ${body.to_date}, ${body.reason ?? null})
      `;
      // `after` and not a floating promise: on serverless the runtime is frozen
      // the moment the response goes out, and the push would never happen
      after(() => pushSession(id).catch((e) => console.error("watch push", e)));
      // a warning, never a block - she keeps agency, you keep visibility
      return NextResponse.json({ ok: true, warning: warn });
    }

    case "scale": {
      const lighter = lighten(s.kind, s.planned_minutes ?? 45);
      await sql`
        update planned_sessions set
          title = ${scaledTitle(s.kind, s.planned_minutes ?? 45, s.title)},
          kind = ${lighter.kind},
          planned_minutes = ${lighter.minutes},
          status = 'planned',
          coach_note = coalesce(coach_note,'') || ${"\nScaled down: " + (body.reason ?? "athlete's call")},
          updated_at = now()
        where id = ${id}
      `;
      await sql`
        insert into session_changes (session_id, actor_id, action, reason)
        values (${id}, ${me.id}, 'scaled', ${body.reason ?? null})
      `;
      after(() => pushSession(id).catch((e) => console.error("watch push", e)));
      return NextResponse.json({ ok: true, scaled_to: lighter });
    }

    case "skip": {
      const reason = SKIP_REASONS.includes(body.reason) ? body.reason : "other";
      await sql`
        update planned_sessions
        set status = 'skipped', skip_reason = ${reason}, updated_at = now()
        where id = ${id}
      `;
      await sql`
        insert into session_changes (session_id, actor_id, action, reason)
        values (${id}, ${me.id}, 'skipped', ${reason})
      `;
      // and take it off the watch, or she gets an alert for a session we agreed
      // she isn't doing
      after(() => removeSession(id).catch((e) => console.error("watch remove", e)));
      after(() => onSkip(s.user_id).catch((e) => console.error("notify: skip", e)));
      return NextResponse.json({ ok: true });
    }

    case "slot": {
      // AM/PM is part of the prescription on double days, and moving a session
      // between halves of a day is a different edit from moving it to another
      // day — it does not touch the date, the watch push or the change log.
      const slot = body.slot === "PM" ? "PM" : body.slot === "AM" ? "AM" : null;
      await sql`update planned_sessions set slot = ${slot}, updated_at = now() where id = ${id}`;
      return NextResponse.json({ ok: true });
    }

    case "note": {
      if (typeof body.coach_note !== "string") throw badRequest("coach_note must be text.");
      await sql`
        update planned_sessions set coach_note = ${body.coach_note}, updated_at = now()
        where id = ${id}
      `;
      after(() => pushSession(id).catch((e) => console.error("watch push", e)));
      return NextResponse.json({ ok: true });
    }

    default:
      throw badRequest("unknown action");
  }
});

/** Warn, don't block: two hard days back to back. */
async function adjacencyWarning(userId: string, date: string, kind: string, selfId: string) {
  const hard = ["run_intervals", "hyrox"];
  if (!hard.includes(kind)) return null;
  const rows = await sql<{ title: string }[]>`
    select title from planned_sessions
    where user_id = ${userId} and id <> ${selfId} and status <> 'moved'
      and kind = any(${hard})
      and planned_date between ${date}::date - 1 and ${date}::date + 1
  `;
  return rows.length
    ? `This puts two hard sessions back to back (${rows[0].title}). Fine if you mean it.`
    : null;
}
