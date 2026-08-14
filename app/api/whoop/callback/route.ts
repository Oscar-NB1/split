import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, saveTokens, syncWellness } from "@/lib/whoop";

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const code = p.get("code");
  const userId = p.get("state");
  if (!code || !userId) {
    return NextResponse.redirect(`${process.env.APP_URL}/settings?whoop=denied`);
  }
  try {
    const tokens = await exchangeCode(code);
    await saveTokens(userId, tokens);
    // backfill whatever Whoop still holds
    const since = new Date(Date.now() - 180 * 864e5).toISOString();
    await syncWellness(userId, since).catch(() => {});
    return NextResponse.redirect(`${process.env.APP_URL}/settings?whoop=connected`);
  } catch (e) {
    console.error("whoop callback", e);
    return NextResponse.redirect(`${process.env.APP_URL}/settings?whoop=failed`);
  }
}
