import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { accessTokenFor } from "@/lib/strava";
import { route } from "@/lib/http";
import { SCOPE_ROWS } from "@/lib/strava";

/**
 * The Strava connection, as the screen describes it.
 *
 * Recent imports are read rather than described: an honest connector shows the
 * unmatched case, and the only way to be sure it does is to show real rows. An
 * activity with no planned session against it is not a failure — it is a run
 * nobody planned — and saying so is the difference between a status screen and
 * a reassurance.
 */
export const GET = route(async () => {
  const me = await requireUser();

  const [conn] = await sql<{ scope: string | null; updated_at: string }[]>`
    select scope, updated_at::text as updated_at
      from oauth_accounts where user_id = ${me.id} and provider = 'strava'
  `;

  const recent = await sql<{
    id: string; name: string | null; local_date: string; sport_type: string | null;
    session: string | null;
  }[]>`
    select a.id, a.name, a.local_date::text as local_date, a.sport_type,
           p.title as session
      from activities a
      left join planned_sessions p on p.activity_id = a.id
     where a.user_id = ${me.id}
     order by a.start_time desc
     limit 3
  `;

  const [{ total }] = await sql<{ total: number }[]>`
    select count(*)::int as total from activities where user_id = ${me.id}
  `;

  return NextResponse.json({
    connected: !!conn,
    since: conn?.updated_at ?? null,
    granted: conn?.scope?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
    scopes: SCOPE_ROWS,
    total,
    /**
     * How many imported activities are still waiting on their detail.
     *
     * The connect flow pulls summaries; laps, splits and the heart-rate stream
     * come from the hourly sweep. Without this the screen shows a count of
     * activities whose breakdowns are all empty, and looks broken rather than
     * busy.
     */
    detail_pending: (await sql<{ n: number }[]>`
      select count(*)::int as n from activities
       where user_id = ${me.id} and detail_fetched_at is null
    `)[0]?.n ?? 0,
    recent: recent.map((r) => ({
      what: r.name ?? "Activity",
      when: r.local_date,
      sport: r.sport_type,
      matched: !!r.session,
      state: r.session ? `Matched · ${r.session}` : "No planned session",
    })),
  });
});

/**
 * Disconnect.
 *
 * The tokens go; the activities stay. They are a record of what the athlete
 * actually did, and disconnecting a source is not a request to delete history.
 */
export const DELETE = route(async (_req: NextRequest) => {
  const me = await requireUser();

  /*
   * Tell Strava, then forget the token.
   *
   * Deleting our row on its own left the authorisation standing on Strava's side:
   * the token kept working, the athlete kept counting against the app's connected
   * athlete quota, and "Disconnect" appeared to work while releasing nothing. On
   * a one-athlete quota that is the difference between a second person being able
   * to connect and not.
   *
   * Best effort on purpose. If Strava is down or the token has already expired,
   * the athlete still gets disconnected here — an app that refuses to let go
   * because a third party is unavailable is worse than one that lets go and
   * leaves a stale grant behind.
   */
  try {
    const token = await accessTokenFor(me.id);
    await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.error("strava deauthorize", me.id, e);
  }

  await sql`delete from oauth_accounts where user_id = ${me.id} and provider = 'strava'`;
  return NextResponse.json({ ok: true, kept: "activities" });
});
