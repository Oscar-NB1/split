import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { flush, type Kind } from "@/lib/notify";

const KINDS: Kind[] = [
  "partner_trained", "session_paired", "record", "upcoming",
  "missed", "race", "weekly", "comment",
];

/**
 * Register this device. The endpoint is the identity — one row per device per
 * person, so two of you on two phones is two rows, and reinstalling replaces
 * rather than duplicates.
 */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { subscription, user_agent } = await req.json();
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw badRequest("That isn't a push subscription.");

  await sql`
    insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_ok_at)
    values (${me.id}, ${endpoint}, ${p256dh}, ${auth}, ${user_agent ?? null}, now())
    on conflict (endpoint) do update set
      user_id = excluded.user_id, p256dh = excluded.p256dh,
      auth = excluded.auth, user_agent = excluded.user_agent
  `;
  return NextResponse.json({ ok: true });
});

/** Turn individual kinds on and off. */
export const PATCH = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { kind, on } = await req.json();
  if (!KINDS.includes(kind)) throw badRequest("Unknown notification kind.");
  await sql`
    update users set notify = notify || ${sql.json({ [kind]: Boolean(on) } as never)}
     where id = ${me.id}
  `;
  return NextResponse.json({ ok: true });
});

/** Unregister this device. */
export const DELETE = route(async (req: NextRequest) => {
  await requireUser();
  const { endpoint } = await req.json();
  if (endpoint) await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
  return NextResponse.json({ ok: true });
});

/** Send a test, so it can be proved before it is trusted. */
export const PUT = route(async () => {
  const me = await requireUser();
  await sql`
    insert into notifications (user_id, kind, dedupe_key, title, body, url)
    values (${me.id}, 'session_paired', ${`test:${Date.now()}`}, 'Split',
            'Notifications are working. This is the only one you asked for.', '/')
  `;
  const sent = await flush();
  return NextResponse.json({ ok: true, sent });
});
