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
  // the private-activities toggle on the connect screen rides along in the URL
  const wantsPrivate = new URL(req.url).searchParams.get("private") === "1";
  return NextResponse.redirect(authorizeUrl(await oauthState(user.id), wantsPrivate));
});
