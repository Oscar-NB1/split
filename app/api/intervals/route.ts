import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { pushUpcoming, resolveAthleteId, verifyIntervals } from "@/lib/intervals";
import { badRequest, route } from "@/lib/http";

/**
 * Whether it is connected, and what has reached the watch.
 *
 * The screen that offers to connect had no way of knowing whether it already was, because there
 * was no screen: the push route told people to "add your API key in Settings" and Settings only
 * ever showed Strava. Names only — an API key never comes back out of an endpoint.
 */
export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await sql<{ athlete_id: string; since: string }[]>`
    select provider_user_id as athlete_id, updated_at::text as since
      from oauth_accounts where user_id = ${me.id} and provider = 'intervals'
  `;
  const [{ pushed }] = await sql<{ pushed: number }[]>`
    select count(*)::int as pushed from planned_sessions
     where user_id = ${me.id} and intervals_event_id is not null
  `;
  const [{ due }] = await sql<{ due: number }[]>`
    select count(*)::int as due from planned_sessions
     where user_id = ${me.id} and status = 'planned' and target is not null
       and planned_date >= current_date and planned_date < current_date + 10
       and (kind like '%\_run' or kind like 'run\_%' or kind = 'benchmark')
  `;
  return NextResponse.json({
    connected: Boolean(row), athlete_id: row?.athlete_id ?? null,
    since: row?.since ?? null, pushed, due,
  });
});

/** Store an intervals.icu API key + athlete id, then push the next 10 days. */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json();
  const api_key = String(body?.api_key ?? "").trim();
  if (!api_key) throw badRequest("The API key is needed.");

  /*
   * The athlete id is optional now, and looked up from the key when it is not given.
   *
   * It is in every path this API uses, so it is genuinely required — but it is buried in a URL
   * and in a settings page, and asking somebody to find it when the key can answer for them is
   * asking for a wrong number. Whatever they do paste is tolerated: a bare number, an i-prefixed
   * one, or the whole URL they copied it out of.
   */
  const typed = String(body?.athlete_id ?? "").trim();
  const fromTyped = /i?(\d{3,})/.exec(typed)?.[1];
  const athlete_id = fromTyped
    ? `i${fromTyped}`
    : await resolveAthleteId(api_key);

  if (!athlete_id) {
    throw badRequest(
      "That key works, but intervals.icu did not say which athlete it belongs to. Open "
      + "intervals.icu, and the i-number in the page URL is your athlete ID — paste it in.",
    );
  }

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
