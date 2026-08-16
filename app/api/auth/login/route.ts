import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { issueSession } from "@/lib/session";
import { identitiesFor } from "@/lib/auth";

/**
 * The bootstrap, off unless switched on.
 *
 * This existed because the first two accounts predated OAuth and no provider
 * could reach them. Registration now creates a new athlete for any sign-in the
 * app has not seen, so the bootstrap has no job: it can only ever open those two
 * legacy accounts, and it would have stayed open forever because they will never
 * acquire an identity of their own.
 *
 * A shared code that grants a 180-day session on a public URL is the kind of
 * thing that survives by being forgotten, so it is now off by default and has to
 * be asked for. Set ALLOW_CODE_LOGIN=1 to reach the old accounts and their
 * training history; leave it unset in production.
 */
export async function POST(req: NextRequest) {
  if (process.env.ALLOW_CODE_LOGIN !== "1") {
    // Deliberately the same answer as a wrong code: whether a disabled door
    // exists is not something a public endpoint should confirm.
    return NextResponse.json({ error: "That code doesn't match." }, { status: 401 });
  }

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

  /*
   * Look up, then insert. This used to upsert on the email unique constraint,
   * which no longer exists — email stopped being identity when registration
   * started creating a new athlete per provider subject, and two accounts may
   * now share an address.
   */
  const [found] = await sql<{ id: string }[]>`
    select id from users where lower(email) = ${match.email!.toLowerCase()}
     order by created_at limit 1
  `;
  const user = found ?? (await sql<{ id: string }[]>`
    insert into users (email, display_name)
    values (${match.email!.toLowerCase()}, ${match.name!})
    returning id
  `)[0];

  if ((await identitiesFor(user.id)).length > 0) {
    return NextResponse.json({
      error: "This account signs in with Google or Strava now.",
    }, { status: 410 });
  }

  await issueSession(user.id);
  return NextResponse.json({ ok: true, bootstrap: true });
}
