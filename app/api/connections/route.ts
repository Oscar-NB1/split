import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";

/** Which providers this athlete has credentials stored for. */
export const GET = route(async () => {
  const me = await requireUser();
  const rows = await sql<{ provider: string }[]>`
    select provider from oauth_accounts where user_id = ${me.id}
  `;
  return NextResponse.json(Object.fromEntries(rows.map((r) => [r.provider, true])));
});
