import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, readOauthState, saveTokens } from "@/lib/strava";
import { ONBOARD_DAYS, discoverFor } from "@/lib/discover";

/**
 * Coming back from Strava.
 *
 * Returns into the app itself rather than a settings page, so a home-screen PWA
 * lands back where it started. It writes only to the database — never to the
 * session cookie — which is what lets the round trip survive iOS sending the
 * consent screen through Safari and back: the connection is saved against the
 * athlete in the signed state, and the app sees it on its next fetch whichever
 * browser context finishes the flow.
 */
const back = (outcome: string) =>
  NextResponse.redirect(`${process.env.APP_URL}/?strava=${outcome}`);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope") ?? "";

  // Signed, so a crafted callback cannot bind a Strava account to someone else.
  const userId = await readOauthState(url.searchParams.get("state"));
  if (!userId) return back("state");
  if (url.searchParams.get("error") || !code) return back("denied");

  // Strava lets people uncheck permissions on the consent screen. Reading
  // activities is the one the app cannot work without; private activities are
  // optional and their absence is a choice, not a failure.
  if (!scope.includes("activity:read")) return back("scope");

  try {
    await saveTokens(userId, await exchangeCode(code));

    /*
     * Pull eight weeks before returning, rather than leaving it to the hourly
     * sweep. Connecting and then being shown "0 activities" is an app that
     * looks broken at the exact moment it should look like magic — and the
     * window matters beyond first impressions: the peak week and longest run
     * that week 1 is built from both come out of it.
     *
     * Awaited on purpose. Serverless kills unawaited work, so fire-and-forget
     * here would import nothing at all.
     */
    try {
      const got = await discoverFor(userId, ONBOARD_DAYS);
      console.log("strava onboard import", userId, got.inserted, "of", got.seen);
    } catch (e) {
      // A rate limit or a slow page must not undo a connection that worked.
      // The hourly sweep picks up whatever is missing.
      console.error("strava onboard import failed", e);
    }
    return back("connected");
  } catch (e) {
    console.error("strava callback", e);
    return back("failed");
  }
}
