import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { canCoach } from "@/lib/coaching";

/**
 * The conversation between a coach and an athlete.
 *
 * Both ends read and write the same thread, unlike /api/notes — which is why
 * the pair is resolved rather than passed: whoever is asking is one half of it,
 * and the other half is either their coach or their athlete. A user id in a
 * query string never decides who can read a message.
 */

type Row = {
  id: string; body: string; created_at: string; author_id: string; display_name: string;
};

/** The (coach, athlete) pair this request is about, from whichever end. */
async function pair(req: NextRequest, meId: string) {
  const withId = new URL(req.url).searchParams.get("with");
  if (!withId || withId === meId) throw badRequest("Whose thread?");
  if (await canCoach(meId, withId)) return { coach: meId, athlete: withId };
  if (await canCoach(withId, meId)) return { coach: withId, athlete: meId };
  throw badRequest("You two are not coach and athlete.");
}

const load = (coach: string, athlete: string) => sql<Row[]>`
  select m.id, m.body, m.created_at::text as created_at, m.author_id, u.display_name
    from messages m join users u on u.id = m.author_id
   where m.coach_id = ${coach} and m.athlete_id = ${athlete}
   order by m.created_at asc
   limit 200
`;

export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { coach, athlete } = await pair(req, me.id);
  // Opening the thread is reading it; there is no other meaning of open here.
  await sql`update messages set read_at = now()
    where coach_id = ${coach} and athlete_id = ${athlete}
      and author_id <> ${me.id} and read_at is null`;
  return NextResponse.json({ messages: await load(coach, athlete) });
});

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { coach, athlete } = await pair(req, me.id);
  const body = String((await req.json()).body ?? "").trim();
  if (!body) throw badRequest("Nothing to send.");
  if (body.length > 4000) throw badRequest("That is longer than a message.");
  await sql`insert into messages (coach_id, athlete_id, author_id, body)
    values (${coach}, ${athlete}, ${me.id}, ${body})`;
  return NextResponse.json({ messages: await load(coach, athlete) });
});
