import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { canCoach } from "@/lib/coaching";
import { CONTEXTS, messagesFor } from "@/lib/messages";

/**
 * The messages a coach writes for an athlete to read in their week.
 *
 * Only the coach reads or writes this route: the athlete sees the one message
 * their week resolved to, in their week, and never the list of everything
 * written for them. Seeing the rotation would spoil it, and seeing the taper
 * message in August would spoil that too.
 */

async function athleteOf(req: NextRequest, meId: string) {
  const id = new URL(req.url).searchParams.get("athlete");
  if (!id) throw badRequest("Which athlete?");
  if (id === meId) throw badRequest("These are messages for someone else to read.");
  if (!(await canCoach(meId, id))) throw badRequest("That is not your athlete.");
  return id;
}

export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const athlete = await athleteOf(req, me.id);
  const rows = await messagesFor(me.id, athlete);
  return NextResponse.json({
    contexts: CONTEXTS.map((c) => ({
      ...c, body: rows.find((r) => r.kind === "context" && r.context === c.key)?.body ?? "",
    })),
    warm: rows.filter((r) => r.kind === "warm").map((r) => ({ id: r.id, body: r.body })),
  });
});

export const PUT = route(async (req: NextRequest) => {
  const me = await requireUser();
  const athlete = await athleteOf(req, me.id);
  const body = await req.json();

  if (typeof body.context === "string") {
    if (!CONTEXTS.some((c) => c.key === body.context)) throw badRequest("Not a kind of week.");
    const text = String(body.body ?? "").trim();
    // Clearing one deletes it rather than storing an empty string, so "has the
    // coach written this?" stays a question the row's existence answers.
    if (!text) {
      await sql`delete from coach_messages
        where coach_id = ${me.id} and athlete_id = ${athlete}
          and kind = 'context' and context = ${body.context}`;
    } else {
      await sql`
        insert into coach_messages (coach_id, athlete_id, kind, context, body)
        values (${me.id}, ${athlete}, 'context', ${body.context}, ${text})
        on conflict (coach_id, athlete_id, context) where kind = 'context'
        do update set body = excluded.body, updated_at = now()
      `;
    }
  } else if (body.action === "add-warm") {
    const [{ next }] = await sql<{ next: number }[]>`
      select coalesce(max(position), -1) + 1 as next from coach_messages
       where coach_id = ${me.id} and athlete_id = ${athlete} and kind = 'warm'`;
    await sql`insert into coach_messages (coach_id, athlete_id, kind, body, position)
      values (${me.id}, ${athlete}, 'warm', '', ${next})`;
  } else if (typeof body.id === "string") {
    const text = String(body.body ?? "").trim();
    if (body.remove) {
      await sql`delete from coach_messages
        where id = ${body.id} and coach_id = ${me.id} and athlete_id = ${athlete}`;
    } else {
      await sql`update coach_messages set body = ${text}, updated_at = now()
        where id = ${body.id} and coach_id = ${me.id} and athlete_id = ${athlete}`;
    }
  } else {
    throw badRequest("Nothing to write.");
  }

  const rows = await messagesFor(me.id, athlete);
  return NextResponse.json({
    contexts: CONTEXTS.map((c) => ({
      ...c, body: rows.find((r) => r.kind === "context" && r.context === c.key)?.body ?? "",
    })),
    warm: rows.filter((r) => r.kind === "warm").map((r) => ({ id: r.id, body: r.body })),
  });
});
