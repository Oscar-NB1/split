import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { issueSession } from "@/lib/session";
import { saveTokens } from "@/lib/strava";
import { ONBOARD_DAYS, discoverFor } from "@/lib/discover";
import {
  PROVIDERS, type Provider, exchange, fillProfileGaps, link, readState, resolveIdentity,
} from "@/lib/oauth";

/**
 * Eight weeks of history, before the athlete lands.
 *
 * Signing up with Strava and arriving at an empty app is the worst possible
 * first impression, and the window is what week 1 of the plan is built from.
 * Failures are swallowed: a rate limit must not undo a sign-in that worked, and
 * the hourly sweep collects whatever is missing.
 */
async function importWindow(userId: string) {
  try {
    const got = await discoverFor(userId, ONBOARD_DAYS);
    console.log("strava onboard import", userId, got.inserted, "of", got.seen);
  } catch (e) {
    console.error("strava onboard import failed", userId, e);
  }
}

/** Coming back from Google or Strava. */
const back = (to: string, outcome: string) =>
  NextResponse.redirect(`${process.env.APP_URL}${to}?auth=${outcome}`, { status: 303 });

async function handle(req: NextRequest, provider: string, params: URLSearchParams) {
  const p = provider as Provider;
  if (!PROVIDERS.includes(p)) return back("/", "unavailable");

  const state = await readState(params.get("state"));
  if (!state) return back("/", "state");
  if (params.get("error") || !params.get("code")) return back("/", "cancelled");

  const linkTo = (state.link as string | null) ?? null;

  /**
   * Which step failed, carried back in the URL.
   *
   * "That did not complete, worth trying again" was the answer to every
   * exception here, which is useless when the cause is permanent — three
   * different failures were indistinguishable from the outside, and diagnosing
   * one meant digging through server logs. The stage is not sensitive: it names
   * a step in a published OAuth flow, not why it failed.
   */
  let stage = "exchange";

  try {
    const profile = await exchange(p, params.get("code")!);
    stage = "store";

    // Signing in with Strava also connects it: we have just been handed the
    // tokens, and asking again on the next screen would be asking twice for
    // permission already granted.
    if (profile.strava) {
      const outcome = linkTo
        ? ({ kind: "linked", userId: linkTo } as const)
        : await resolveIdentity(profile);
      await link(profile, outcome.userId);
      await fillProfileGaps(outcome.userId, profile);
      await saveTokens(outcome.userId, {
        access_token: profile.strava.access_token,
        refresh_token: profile.strava.refresh_token,
        expires_at: profile.strava.expires_at,
        athlete: { id: Number(profile.strava.athleteId) },
      });
      // After the tokens, because the import needs them.
      await importWindow(outcome.userId);
      if (linkTo) return back("/", "linked");
      await issueSession(outcome.userId);
      return back("/", outcome.kind === "created" ? "created" : "signed-in");
    }

    // Already signed in: this is "add a way to sign in", not "sign me in".
    if (linkTo) {
      const [taken] = await sql<{ user_id: string }[]>`
        select user_id from identities
         where provider = ${p} and subject = ${profile.subject}
      `;
      if (taken && taken.user_id !== linkTo) return back("/", "already-linked");
      await link(profile, linkTo);
      await fillProfileGaps(linkTo, profile);
      return back("/", "linked");
    }

    const outcome = await resolveIdentity(profile);
    await fillProfileGaps(outcome.userId, profile);
    await issueSession(outcome.userId);
    return back("/", outcome.kind === "created" ? "created" : "signed-in");
  } catch (e) {
    console.error("oauth callback", p, stage, e);
    return back("/", `failed-${stage}`);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return handle(req, provider, new URL(req.url).searchParams);
}
