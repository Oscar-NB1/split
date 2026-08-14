import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { issueSession } from "@/lib/session";

/**
 * v0 auth: two people, two access codes from the environment.
 * Good enough for a household tool. Swap for magic links when you care.
 */
export async function POST(req: NextRequest) {
  const { code } = await req.json();

  const people = [
    { code: process.env.USER_A_CODE, email: process.env.USER_A_EMAIL, name: process.env.USER_A_NAME },
    { code: process.env.USER_B_CODE, email: process.env.USER_B_EMAIL, name: process.env.USER_B_NAME },
  ];
  const match = people.find((p) => p.code && code && p.code === code);
  if (!match) {
    // constant-ish response, no hint about which half was wrong
    return NextResponse.json({ error: "That code doesn't match." }, { status: 401 });
  }

  const rows = await sql<{ id: string }[]>`
    insert into users (email, display_name)
    values (${match.email!}, ${match.name!})
    on conflict (email) do update set display_name = excluded.display_name
    returning id
  `;
  await issueSession(rows[0].id);
  return NextResponse.json({ ok: true });
}
