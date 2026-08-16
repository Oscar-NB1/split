import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { codeFrom, expiresAt, since } from "@/lib/connect";

/**
 * Training partners: the invite you hand out, and every request either way.
 *
 * One screen reads from one endpoint. Splitting it into invite/incoming/outgoing
 * would mean three round trips before anything renders, and a moment where the
 * screen shows a code but not the request that code already produced.
 */

type Row = {
  id: string; status: string;
  requester_id: string; addressee_id: string;
  created_at: string; responded_at: string | null;
  other_id: string; other_name: string; other_avatar: string | null;
};

export const GET = route(async () => {
  const me = await requireUser();
  const now = new Date();

  /*
   * The invite is minted on read when there is none.
   *
   * A write inside a GET, deliberately: the screen's whole purpose is to hand a
   * code over, and a code that appears only after a tap is a code the athlete has
   * to be told to ask for. The unique partial index makes it at most one.
   */
  let [invite] = await sql<{ code: string; expires_at: string; created_at: string }[]>`
    select code, expires_at, created_at from connection_invites
     where inviter_id = ${me.id} and used_at is null and revoked_at is null
       and expires_at > now()
     order by created_at desc limit 1
  `;
  if (!invite) {
    // An expired code still holds the partial index, so it is retired first.
    await sql`
      update connection_invites set revoked_at = now()
       where inviter_id = ${me.id} and used_at is null and revoked_at is null
    `;
    [invite] = await sql<{ code: string; expires_at: string; created_at: string }[]>`
      insert into connection_invites (code, inviter_id, expires_at)
      values (${codeFrom(randomBytes(8))}, ${me.id}, ${expiresAt(now).toISOString()})
      returning code, expires_at, created_at
    `;
  }

  const rows = await sql<Row[]>`
    select c.id, c.status, c.requester_id, c.addressee_id,
           c.created_at, c.responded_at,
           u.id as other_id, u.display_name as other_name, u.avatar_url as other_avatar
      from connections c
      join users u on u.id = case when c.requester_id = ${me.id}
                                  then c.addressee_id else c.requester_id end
     where (c.requester_id = ${me.id} or c.addressee_id = ${me.id})
       and c.status in ('pending', 'accepted')
     order by c.created_at desc
  `;

  const shape = (r: Row) => ({
    id: r.id,
    athlete: { id: r.other_id, display_name: r.other_name, avatar_url: r.other_avatar },
    since: since(r.status === "accepted" ? (r.responded_at ?? r.created_at) : r.created_at, now),
  });

  return NextResponse.json({
    invite: {
      code: invite.code,
      url: `${process.env.APP_URL ?? ""}/invite/${invite.code}`,
      expires_at: invite.expires_at,
    },
    /** they entered your code and are waiting on you */
    incoming: rows.filter((r) => r.status === "pending" && r.addressee_id === me.id).map(shape),
    /** you entered theirs and are waiting on them */
    outgoing: rows.filter((r) => r.status === "pending" && r.requester_id === me.id).map(shape),
    connected: rows.filter((r) => r.status === "accepted").map(shape),
  });
});

/** A new code, retiring the old one — for a link sent to the wrong person. */
export const POST = route(async () => {
  const me = await requireUser();
  await sql`
    update connection_invites set revoked_at = now()
     where inviter_id = ${me.id} and used_at is null and revoked_at is null
  `;
  const [invite] = await sql<{ code: string; expires_at: string }[]>`
    insert into connection_invites (code, inviter_id, expires_at)
    values (${codeFrom(randomBytes(8))}, ${me.id},
            ${expiresAt(new Date()).toISOString()})
    returning code, expires_at
  `;
  return NextResponse.json({
    invite: {
      code: invite.code,
      url: `${process.env.APP_URL ?? ""}/invite/${invite.code}`,
      expires_at: invite.expires_at,
    },
  });
});
