import { NextResponse, after, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { stravaGet } from "@/lib/strava";
import { unpairActivity, upsertActivity, type StravaActivity } from "@/lib/ingest";
import { fetchStreams, saveSplits } from "@/lib/detail";

/**
 * Strava calls this once with GET to verify the subscription, then with
 * POST for every activity event. Both must answer fast - Strava expects a
 * 200 within 2 seconds and retries otherwise.
 */
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  if (
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === process.env.STRAVA_VERIFY_TOKEN
  ) {
    return NextResponse.json({ "hub.challenge": p.get("hub.challenge") });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type Event = {
  aspect_type: "create" | "update" | "delete";
  object_type: "activity" | "athlete";
  object_id: number;
  owner_id: number;
};

export async function POST(req: NextRequest) {
  const event: Event = await req.json().catch(() => null);
  if (!event) return NextResponse.json({ ok: true }); // never make Strava retry

  // Acknowledge immediately, do the work afterwards: Strava wants a 200 inside
  // two seconds and retries anything slower. `after` is what keeps the runtime
  // alive for that work - a bare floating promise gets frozen the moment the
  // response is sent on serverless, which silently dropped runs.
  after(() => handle(event).catch((e) => console.error("webhook handler", e)));

  return NextResponse.json({ ok: true });
}

async function handle(event: Event) {
  if (event.object_type !== "activity") return;

  const rows = await sql<{ user_id: string }[]>`
    select user_id from oauth_accounts
    where provider = 'strava' and provider_user_id = ${String(event.owner_id)}
  `;
  const userId = rows[0]?.user_id;
  if (!userId) return; // an athlete we do not track

  if (event.aspect_type === "delete") {
    // unpair first: the FK is `on delete set null`, so deleting the row alone
    // left the session marked done with no activity and stale actual_minutes
    await unpairActivity("strava", String(event.object_id));
    await sql`
      delete from activities
      where provider = 'strava' and provider_activity_id = ${String(event.object_id)}
    `;
    return;
  }

  // This is the DETAILED activity, so it already carries splits_metric — the
  // splits below cost no extra request. Only the streams do.
  const activity = await stravaGet<StravaActivity>(
    userId,
    `/activities/${event.object_id}`,
  );
  const activityId = await upsertActivity(userId, activity);

  await saveSplits(activityId, activity).catch((e) =>
    console.error("splits", event.object_id, e),
  );
  // One extra request. Failing here must not lose the activity itself, which is
  // already stored and paired — the hourly sweep retries anything missing.
  await fetchStreams(userId, activityId, String(event.object_id)).catch((e) =>
    console.error("streams", event.object_id, e),
  );
}
