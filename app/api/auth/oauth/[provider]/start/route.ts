import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { PROVIDERS, type Provider, authorizeUrl, configured, signState } from "@/lib/oauth";

/**
 * Send them to Google, Apple or Strava.
 *
 * The state carries the signed-in user when there is one, which is what turns
 * the same route into "link this to my account" rather than "sign me in".
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const home = process.env.APP_URL ?? "";
  try {
    const { provider } = await ctx.params;
    const p = provider as Provider;
    if (!PROVIDERS.includes(p) || !configured(p)) {
      return NextResponse.redirect(`${home}/login?auth=unavailable`);
    }
    const me = await currentUser();
    return NextResponse.redirect(await authorizeUrl(p, await signState({ link: me?.id ?? null })));
  } catch (e) {
    console.error("oauth start", e);
    return NextResponse.redirect(`${home}/login?auth=failed`);
  }
}
