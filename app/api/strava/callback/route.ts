import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, readOauthState, saveTokens } from "@/lib/strava";

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

  // Strava lets people uncheck permissions on the consent screen.
  if (!scope.includes("activity:read_all")) return back("scope");

  try {
    await saveTokens(userId, await exchangeCode(code));
    return back("connected");
  } catch (e) {
    console.error("strava callback", e);
    return back("failed");
  }
}
