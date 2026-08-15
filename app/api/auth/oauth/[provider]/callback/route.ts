import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { issueSession } from "@/lib/session";
import { saveTokens } from "@/lib/strava";
import {
  PROVIDERS, type Provider, exchange, fillProfileGaps, link, readState, resolveIdentity,
} from "@/lib/oauth";

/**
 * Coming back from Google, Apple or Strava.
 *
 * Apple posts the callback rather than redirecting it, so both verbs land here.
 */
const back = (to: string, outcome: string) =>
  NextResponse.redirect(`${process.env.APP_URL}${to}?auth=${outcome}`, { status: 303 });

async function handle(req: NextRequest, provider: string, params: URLSearchParams) {
  const p = provider as Provider;
  if (!PROVIDERS.includes(p)) return back("/login", "unavailable");

  const state = await readState(params.get("state"));
  if (!state) return back("/login", "state");
  if (params.get("error") || !params.get("code")) return back("/login", "cancelled");

  const linkTo = (state.link as string | null) ?? null;

  try {
    const profile = await exchange(p, params.get("code")!);

    // Signing in with Strava also connects it: we have just been handed the
    // tokens, and asking again on the next screen would be asking twice for
    // permission already granted.
    if (profile.strava) {
      const outcome = linkTo
        ? ({ kind: "linked", userId: linkTo } as const)
        : await resolveIdentity(profile);
      // Strava carries no email, so it can never reach the conflict case — but
      // the check stays, because a provider that starts returning one should not
      // silently start joining accounts on an unverified address.
      if (outcome.kind === "conflict") return back("/login", "email-in-use");

      await link(profile, outcome.userId);
      await fillProfileGaps(outcome.userId, profile);
      await saveTokens(outcome.userId, {
        access_token: profile.strava.access_token,
        refresh_token: profile.strava.refresh_token,
        expires_at: profile.strava.expires_at,
        athlete: { id: Number(profile.strava.athleteId) },
      });
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
    if (outcome.kind === "conflict") return back("/login", "email-in-use");
    await fillProfileGaps(outcome.userId, profile);
    await issueSession(outcome.userId);
    return back("/", outcome.kind === "created" ? "created" : "signed-in");
  } catch (e) {
    console.error("oauth callback", p, e);
    return back("/login", "failed");
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return handle(req, provider, new URL(req.url).searchParams);
}

/** Apple's `response_mode=form_post` arrives as a POST body. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const form = await req.formData();
  const params = new URLSearchParams();
  form.forEach((v, k) => params.set(k, String(v)));
  return handle(req, provider, params);
}
