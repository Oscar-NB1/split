import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { recentFor } from "@/lib/recent";

/**
 * What we already know about someone's recent running, at intake time.
 *
 * Its own route rather than part of GET /api/intake because the answer changes
 * mid-flow: connect Strava on one step and this is worth asking again on the
 * next. Folding it into the intake payload would mean reloading the whole draft
 * to refresh one number.
 */
export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await sql<{ connected: boolean }[]>`
    select exists (
      select 1 from oauth_accounts where user_id = ${me.id} and provider = 'strava'
    ) as connected
  `;
  const connected = row?.connected ?? false;
  const { recent, from } = await recentFor(me.id, connected);

  return NextResponse.json({
    connected,
    /** "app" | "strava" | "none" — the screen says which, because a number read
     *  off their watch and a number they typed are different claims */
    from,
    recent,
  });
});
