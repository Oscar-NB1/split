import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { syncRunna } from "@/lib/runna";
import { materialiseAll } from "@/lib/templates";
import { pushUpcoming } from "@/lib/intervals";

/**
 * Hourly housekeeping. Wired in vercel.json.
 * Everything here is idempotent and failure-tolerant: one broken feed must
 * not stop the others.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const log: Record<string, unknown> = {};

  const users = await sql<{ id: string; email: string; runna_feed: string | null }[]>`
    select u.id, u.email,
           (select access_token from oauth_accounts o
            where o.user_id = u.id and o.provider = 'runna') as runna_feed
    from users u
  `;

  for (const u of users) {
    if (u.runna_feed) {
      await syncRunna(u.id, u.runna_feed)
        .then((n) => (log[`runna:${u.email}`] = n))
        .catch((e) => (log[`runna:${u.email}`] = String(e)));
    }
    await pushUpcoming(u.id)
      .then((n) => (log[`intervals:${u.email}`] = n))
      .catch((e) => (log[`intervals:${u.email}`] = String(e)));
  }

  await materialiseAll()
    .then((n) => (log.templates = n))
    .catch((e) => (log.templates = String(e)));

  return NextResponse.json(log);
}
