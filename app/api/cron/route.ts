import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { syncRunna } from "@/lib/runna";
import { materialiseAll } from "@/lib/templates";
import { pushUpcoming } from "@/lib/intervals";
import { detailGaps, fillDetail } from "@/lib/detail";
import { scheduled } from "@/lib/rules";
import { flush } from "@/lib/notify";

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

  // Backstop for splits/streams. The webhook fetches them as a run lands, but a
  // missed webhook, a Strava blip or a rate-limit rejection would otherwise
  // leave a permanent hole. Bounded per run: Strava allows 100 requests per 15
  // minutes and each gap costs up to two, so 30 keeps an hourly sweep well
  // clear even when the same window is doing token refreshes.
  const gaps = await detailGaps(30).catch(() => []);
  let requests = 0;
  const filled: string[] = [];
  for (const gap of gaps) {
    if (requests >= 60) break;
    try {
      const r = await fillDetail(gap);
      requests += r.requests;
      filled.push(gap.provider_activity_id);
    } catch (e) {
      log[`detail:${gap.provider_activity_id}`] = String(e);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  log.detail = { pending: gaps.length, filled: filled.length, requests };

  // look forward, then deliver — including anything queued overnight while it
  // would have been rude to send it
  await scheduled().then(() => (log.scheduled = "ok")).catch((e) => (log.scheduled = String(e)));
  await flush().then((n) => (log.notifications = n)).catch((e) => (log.notifications = String(e)));

  return NextResponse.json(log);
}
