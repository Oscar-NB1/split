import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { HttpError, badRequest, notFound, route } from "@/lib/http";
import { isUuid } from "@/lib/plan";
import { actionFor } from "@/lib/connect";

type Ctx = { params: Promise<{ id: string }> };
type Row = {
  id: string; status: string; requester_id: string; addressee_id: string;
};

const mine = async (id: string, me: string): Promise<Row> => {
  if (!isUuid(id)) throw notFound("That request is no longer there.");
  const [c] = await sql<Row[]>`
    select id, status, requester_id, addressee_id from connections where id = ${id}
  `;
  if (!c || (c.requester_id !== me && c.addressee_id !== me)) {
    // Not "forbidden": a connection between two other people is not a thing
    // this athlete gets told exists.
    throw notFound("That request is no longer there.");
  }
  return c;
};

/**
 * Accepting a request.
 *
 * The rivalry is created here rather than at request time, because a rivalry with
 * one consenting side is not a rivalry. On a reconnect the existing one is left
 * alone — the weeks already won are the history the screen promises is kept.
 */
export const PATCH = route(async (req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  const { id } = await params;
  const c = await mine(id, me.id);
  const body = await req.json();

  const allowed = actionFor(c, me.id);
  if (body.action !== "accept" && body.action !== "decline") {
    throw badRequest("action must be accept or decline.");
  }
  if (allowed !== "accept") {
    throw new HttpError(409, c.status === "accepted"
      ? "You are already connected."
      : "That request is not yours to answer.");
  }

  if (body.action === "decline") {
    await sql`
      update connections set status = 'declined', responded_at = now()
       where id = ${id}
    `;
    return NextResponse.json({ ok: true, status: "declined" });
  }

  await sql`
    update connections set status = 'accepted', responded_at = now() where id = ${id}
  `;
  await sql`
    insert into rivalries (connection_id, timezone)
    values (${id}, ${String(body.timezone ?? "Europe/Berlin")})
    on conflict (connection_id) do nothing
  `;
  return NextResponse.json({ ok: true, status: "accepted" });
});

/**
 * Cancelling a request you sent, or disconnecting.
 *
 * Disconnecting sets a status rather than deleting the row: the rivalry hangs off
 * it, and the weeks won are kept for a reconnect. Deleting would cascade them
 * away and make "kept if you disconnect and reconnect" a lie.
 */
export const DELETE = route(async (_req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  const { id } = await params;
  const c = await mine(id, me.id);

  const action = actionFor(c, me.id);
  if (action !== "cancel" && action !== "disconnect") {
    throw new HttpError(409, "There is nothing to withdraw here.");
  }

  if (action === "cancel") {
    // A cancelled request leaves nothing behind — unlike a decline, which is an
    // answer and stays as one.
    await sql`delete from connections where id = ${id}`;
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  await sql`
    update connections set status = 'disconnected', responded_at = now()
     where id = ${id}
  `;
  return NextResponse.json({ ok: true, status: "disconnected" });
});
