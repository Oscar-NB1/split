import { sql } from "./db";
import { pushConfigured, sendTo, type Payload } from "./push";

/**
 * Queue first, send second.
 *
 * Everything is written to `notifications` before anything is delivered, which
 * buys three things:
 *
 *   - **De-duplication.** `dedupe_key` is unique per recipient, so the same
 *     event can be evaluated a hundred times and notify once. It has to be:
 *     Strava fires an update event for activities it already told us about, and
 *     the hourly cron re-checks tomorrow's session every hour until it stops
 *     being tomorrow.
 *   - **Quiet hours that defer rather than drop.** A record set at 22:40 arrives
 *     at breakfast instead of not at all.
 *   - **A log.** "I never got told" is answerable.
 */

export type Kind =
  | "partner_trained" | "session_paired" | "record"
  | "upcoming" | "missed" | "race" | "weekly" | "comment";

const DEFAULTS: Record<Kind, boolean> = {
  partner_trained: true, session_paired: true, record: true, upcoming: true,
  missed: true, race: true, weekly: true, comment: true,
};

export const QUIET_FROM = 21;
export const QUIET_TO = 7;

/** The window wraps midnight, so it is an OR. Getting this wrong inverts it. */
export function isQuiet(hour: number, from = QUIET_FROM, to = QUIET_TO): boolean {
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

/** The next moment it is polite to send. */
export function nextSendableAt(now: Date, from = QUIET_FROM, to = QUIET_TO): Date {
  if (!isQuiet(now.getHours(), from, to)) return now;
  const at = new Date(now);
  if (now.getHours() >= from) at.setDate(at.getDate() + 1); // late: wait for morning
  at.setHours(to, 0, 0, 0);
  return at;
}

async function wants(userId: string, kind: Kind): Promise<boolean> {
  const rows = await sql<{ notify: Record<string, boolean> }[]>`
    select notify from users where id = ${userId}
  `;
  return rows[0]?.notify?.[kind] ?? DEFAULTS[kind];
}

/**
 * Queue one. Returns false if it was a duplicate or switched off.
 * `dedupeKey` must be stable for the thing announced, not for the moment of
 * noticing.
 */
export async function queue(
  userId: string, kind: Kind, dedupeKey: string, payload: Payload,
): Promise<boolean> {
  if (!(await wants(userId, kind))) return false;
  const rows = await sql<{ id: string }[]>`
    insert into notifications (user_id, kind, dedupe_key, title, body, url, send_after)
    values (${userId}, ${kind}, ${dedupeKey}, ${payload.title}, ${payload.body},
            ${payload.url ?? null}, ${nextSendableAt(new Date())})
    on conflict (user_id, dedupe_key) do nothing
    returning id
  `;
  return rows.length > 0;
}

/** Older than this and it is not news. */
const STALE_HOURS = 24;

/**
 * Deliver everything due. Two guards:
 *
 *   - If push is not configured, nothing is marked sent. Otherwise deploying
 *     before setting the VAPID keys swallows the first week silently, and the
 *     log claims delivery.
 *   - Anything older than a day is retired unsent, so registering a phone for
 *     the first time does not deliver a fortnight of backlog at once.
 */
export async function flush(): Promise<number> {
  if (!pushConfigured()) {
    console.warn("push: VAPID keys not set — leaving the queue alone");
    return 0;
  }
  await sql`
    update notifications set sent_at = now()
     where sent_at is null and created_at < now() - make_interval(hours => ${STALE_HOURS})
  `;
  const due = await sql<{
    id: string; user_id: string; title: string; body: string; url: string | null; kind: string;
  }[]>`
    select id, user_id, title, body, url, kind from notifications
     where sent_at is null and send_after <= now()
     order by created_at limit 50
  `;
  let sent = 0;
  for (const n of due) {
    const delivered = await sendTo(n.user_id, {
      title: n.title, body: n.body, url: n.url ?? "/", tag: n.kind,
    });
    // marked sent either way: there is nowhere to retry to when nobody has
    // registered a phone, and a notification retried forever is worse than one
    // missed
    await sql`update notifications set sent_at = now() where id = ${n.id}`;
    if (delivered > 0) sent++;
  }
  return sent;
}

/** Queue and, unless it is the middle of the night, deliver now. */
export async function notify(
  userId: string, kind: Kind, dedupeKey: string, payload: Payload,
): Promise<boolean> {
  const queued = await queue(userId, kind, dedupeKey, payload);
  if (queued && !isQuiet(new Date().getHours())) await flush();
  return queued;
}

/** The other person. Two users, no privacy walls, by design. */
export async function partnerOf(userId: string) {
  const rows = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users where id <> ${userId} order by created_at limit 1
  `;
  return rows[0] ?? null;
}
