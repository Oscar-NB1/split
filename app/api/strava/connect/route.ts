import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { redirectingRoute } from "@/lib/http";
import { authorizeUrl, oauthState } from "@/lib/strava";

/**
 * Start the Strava connection.
 *
 * The athlete never sees a key: the client id and secret belong to this app, not
 * to her. One tap, Strava's own consent screen, and back.
 */
export const GET = redirectingRoute(async (req: Request) => {
  const user = await requireUser();

  /*
   * Refuse rather than build a URL with an empty client_id.
   *
   * Without this the athlete taps Connect, gets handed to Strava, and lands on
   * a raw JSON error from Strava's API saying the application is invalid — a
   * dead end that looks like their fault and reads like the app is broken. The
   * sign-in screen already hides providers that are not configured; this path
   * did not, so it was the one place a missing key became someone else's
   * problem.
   */
  if (!process.env.STRAVA_CLIENT_ID || !process.env.APP_URL) {
    return NextResponse.redirect(`${process.env.APP_URL ?? ""}/?strava=unavailable`, 303);
  }
  // the private-activities toggle on the connect screen rides along in the URL
  const wantsPrivate = new URL(req.url).searchParams.get("private") === "1";
  return NextResponse.redirect(authorizeUrl(await oauthState(user.id), wantsPrivate));
});
