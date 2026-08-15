import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { pushUpcoming, verifyIntervals } from "@/lib/intervals";
import { badRequest, route } from "@/lib/http";

/** Store an intervals.icu API key + athlete id, then push the next 10 days. */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { athlete_id, api_key } = await req.json();
  if (!athlete_id || !api_key) throw badRequest("Athlete ID and API key are both needed.");

  // Verified before anything is written. Storing first and pushing second meant a
  // mistyped key was saved and reported as connected — the push that would have
  // caught it is wrapped in a catch, because a working connection with nothing to
  // send is also 0 pushed.
  const check = await verifyIntervals(String(athlete_id).trim(), String(api_key).trim());
  if (!check.ok) throw badRequest(check.why);

  // Event ids belong to one intervals.icu athlete. Pointing at a different one
  // makes every stored id meaningless, and pushUpcoming skips anything already
  // pushed - so reconnecting used to report "0 pushed" and send nothing.
  await sql`
    update planned_sessions set intervals_event_id = null, intervals_pushed_at = null
    where user_id = ${me.id}
      and intervals_event_id is not null
      and exists (
        select 1 from oauth_accounts o
        where o.user_id = ${me.id} and o.provider = 'intervals'
          and o.provider_user_id <> ${athlete_id}
      )
  `;
  await sql`
    insert into oauth_accounts (user_id, provider, provider_user_id, access_token, updated_at)
    values (${me.id}, 'intervals', ${athlete_id}, ${api_key}, now())
    on conflict (user_id, provider) do update set
      provider_user_id = excluded.provider_user_id,
      access_token = excluded.access_token, updated_at = now()
  `;
  const pushed = await pushUpcoming(me.id).catch(() => 0);
  return NextResponse.json({ ok: true, pushed });
});

/** Store a Runna calendar feed URL (kept in the same table for simplicity). */
export const PUT = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { feed_url } = await req.json();
  // a webcal:// URL is the one people paste; fetch() can't open it
  if (typeof feed_url !== "string" || !/^https?:\/\//.test(feed_url)) {
    throw badRequest("That doesn't look like a feed URL. Swap webcal:// for https://.");
  }
  await sql`
    insert into oauth_accounts (user_id, provider, provider_user_id, access_token, updated_at)
    values (${me.id}, 'runna', 'ical', ${feed_url}, now())
    on conflict (user_id, provider) do update set
      access_token = excluded.access_token, updated_at = now()
  `;
  return NextResponse.json({ ok: true });
});
