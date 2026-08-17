import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { isUuid } from "@/lib/plan";

/**
 * A reward waiting to be seen, and marking it seen.
 *
 * GET is deliberately cheap and returns null almost always, because it runs on every app open —
 * the whole feature is that the screen is already there when she opens the app rather than
 * something she has to go and find.
 */

type Row = {
  session_id: string | null; title: string | null; kind: string | null; date: string | null;
  reward_kind: string; image: string | null; own_title: string | null;
};

export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await sql<Row[]>`
    select r.session_id, p.title, p.kind, p.planned_date::text as date,
           r.kind as reward_kind, r.title as own_title,
           /* The image she was actually given, recorded when it was earned — not recomputed now,
              so the set can grow without rewriting what an earlier session showed her. */
           r.image
      from rewards r
      /* Left, because a welcome belongs to no session and still has to arrive. */
      left join planned_sessions p on p.id = r.session_id
     where r.user_id = ${me.id} and r.seen_at is null
     order by r.created_at desc
     limit 1
  `;
  /*
   * No image, no reward. A row can outlive its picture — somebody may take theirs back out — and a
   * reward screen with nothing on it is worse than none.
   */
  if (!row?.image) return NextResponse.json({ reward: null });
  return NextResponse.json({
    reward: {
      session_id: row.session_id,
      /* The session's name where there is one, and the reward's own words where there is not. */
      title: row.own_title ?? row.title ?? "",
      kind: row.kind, reward_kind: row.reward_kind, date: row.date, image: row.image,
    },
  });
});

/**
 * Seen, and not shown again.
 *
 * Marked rather than deleted: a reward that has been seen is the record of a session that earned
 * one, and the row is how a later screen could count them.
 */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const id = String(body?.session_id ?? "");
  if (!isUuid(id)) throw badRequest("Which reward?");
  await sql`
    update rewards set seen_at = now()
     where session_id = ${id} and user_id = ${me.id} and seen_at is null
  `;
  return NextResponse.json({ ok: true });
});
