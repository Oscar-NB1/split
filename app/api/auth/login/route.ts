import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { issueSession } from "@/lib/session";
import { identitiesFor } from "@/lib/auth";

/**
 * The bootstrap, and only the bootstrap.
 *
 * Sign-in is Google or Strava. These two accounts predate that: they were made
 * by an access code, they hold a training history, and neither provider can
 * reach them — one email is an iCloud address Google will never match, and
 * Strava carries no email at all, so signing in with it would create a second
 * account rather than find the first.
 *
 * So the code still works, exactly until it is not needed. The moment an account
 * has a way of signing in of its own, the code stops opening it: whoever holds a
 * shared secret should not keep a key to an account that has since got a real
 * one. It retires itself per person, which means nobody has to remember to
 * remove it.
 */
export async function POST(req: NextRequest) {
  const { code } = await req.json();

  const people = [
    { code: process.env.USER_A_CODE, email: process.env.USER_A_EMAIL, name: process.env.USER_A_NAME },
    { code: process.env.USER_B_CODE, email: process.env.USER_B_EMAIL, name: process.env.USER_B_NAME },
  ];
  const match = people.find((p) => p.code && code && p.code === code);
  if (!match) {
    // no hint about which half was wrong
    return NextResponse.json({ error: "That code doesn't match." }, { status: 401 });
  }

  const [user] = await sql<{ id: string }[]>`
    insert into users (email, display_name)
    values (${match.email!.toLowerCase()}, ${match.name!})
    on conflict (email) do update set display_name = excluded.display_name
    returning id
  `;

  if ((await identitiesFor(user.id)).length > 0) {
    return NextResponse.json({
      error: "This account signs in with Google or Strava now.",
    }, { status: 410 });
  }

  await issueSession(user.id);
  return NextResponse.json({ ok: true, bootstrap: true });
}
