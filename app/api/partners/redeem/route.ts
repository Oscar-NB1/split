import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { canRedeem, normaliseCode, pairOf, REFUSAL, type Invite } from "@/lib/connect";

/**
 * Entering someone's code.
 *
 * This sends a request rather than connecting outright. A link travels — into a
 * group chat, a screenshot, a forwarded message — and the person who created it
 * should be the one who decides that the athlete who turned up is the athlete they
 * meant. The code is single-use, which limits the damage; the accept step removes
 * it. It also gives the design's "waiting for you" row something real to hold.
 */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json();

  const code = normaliseCode(String(body.code ?? ""));
  if (!code) throw badRequest("That is not a code. They look like 7K2M-P4XQ.");

  const [invite] = await sql<Invite[]>`
    select code, inviter_id, expires_at, used_at from connection_invites
     where code = ${code} and revoked_at is null
  `;

  const { low, high } = invite
    ? pairOf(me.id, invite.inviter_id)
    : { low: me.id, high: me.id };
  const [existing] = invite ? await sql<{ status: string; requester_id: string }[]>`
    select status, requester_id from connections
     where low_id = ${low} and high_id = ${high}
  ` : [];

  const verdict = canRedeem(invite ?? null, me.id, existing ?? null, new Date());
  if (!verdict.ok) {
    // 409 rather than 400 for the states that are about the relationship rather
    // than the code: the client tells them apart to decide what to offer next.
    const status = verdict.why === "unknown" || verdict.why === "own" ? 400 : 409;
    return NextResponse.json({ error: REFUSAL[verdict.why], why: verdict.why }, { status });
  }

  /*
   * Spending the code is the guard against two requests arriving together: the
   * update only matches while used_at is still null, so the second one gets no
   * row back and stops here rather than creating a second connection.
   */
  const spent = await sql<{ code: string }[]>`
    update connection_invites set used_by = ${me.id}, used_at = now()
     where code = ${code} and used_at is null and revoked_at is null
     returning code
  `;
  if (spent.length === 0) {
    return NextResponse.json({ error: REFUSAL.used, why: "used" }, { status: 409 });
  }

  const inviter = invite!.inviter_id;
  const [row] = await sql<{ id: string }[]>`
    insert into connections (
      low_id, high_id, requester_id, addressee_id, status, invite_code
    ) values (
      ${low}, ${high}, ${me.id}, ${inviter}, 'pending', ${code}
    )
    on conflict (low_id, high_id) do update
      set status = 'pending', requester_id = ${me.id}, addressee_id = ${inviter},
          invite_code = ${code}, created_at = now(), responded_at = null
    returning id
  `;

  const [them] = await sql<{ display_name: string }[]>`
    select display_name from users where id = ${inviter}
  `;

  return NextResponse.json({
    ok: true, id: row.id,
    athlete: { id: inviter, display_name: them?.display_name ?? "They" },
    /** what happens next, said plainly rather than left to the screen */
    note: `${them?.display_name ?? "They"} has to accept before the head-to-head starts.`,
  });
});
