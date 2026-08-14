import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/strava";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const userId = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const scope = url.searchParams.get("scope") ?? "";

  if (error || !code || !userId) {
    return NextResponse.redirect(`${process.env.APP_URL}/settings?strava=denied`);
  }
  // Strava lets people uncheck permissions on the consent screen.
  if (!scope.includes("activity:read_all")) {
    return NextResponse.redirect(`${process.env.APP_URL}/settings?strava=scope`);
  }

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(userId, tokens);
    return NextResponse.redirect(`${process.env.APP_URL}/settings?strava=connected`);
  } catch (e) {
    console.error("strava callback", e);
    return NextResponse.redirect(`${process.env.APP_URL}/settings?strava=failed`);
  }
}
