import webpush from "web-push";
import { sql } from "./db";

/**
 * Web push delivery. No third-party service — the app is the sender.
 *
 * On iOS this only works once the app is on the Home Screen: in a Safari tab the
 * Push API is absent, not denied. The client detects that and says so; this file
 * assumes a subscription already exists.
 *
 *   npx web-push generate-vapid-keys
 */
let configured = false;

function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? `mailto:${process.env.USER_A_EMAIL ?? "nobody@example.com"}`,
    publicKey,
    privateKey,
  );
  configured = true;
  return true;
}

export const pushConfigured = () => configure();

export type Payload = { title: string; body: string; url?: string; tag?: string };

/**
 * Send to every device this person has registered. Returns how many landed.
 *
 * 404 and 410 mean the subscription is dead — reinstalled browser, app removed
 * from the Home Screen, endpoint rotated. Those rows are deleted rather than
 * retried, or they accumulate and every send waits on a timeout.
 */
export async function sendTo(userId: string, payload: Payload): Promise<number> {
  if (!configure()) return 0;

  const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
    select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}
  `;
  let delivered = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 12 * 60 * 60 }, // a session reminder is worthless tomorrow
      );
      await sql`update push_subscriptions set last_ok_at = now() where id = ${s.id}`;
      delivered++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await sql`delete from push_subscriptions where id = ${s.id}`;
      } else {
        console.error("push: send failed", status, e);
      }
    }
  }
  return delivered;
}
