import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { identitiesFor } from "@/lib/auth";
import { PROVIDERS, type Provider, availableProviders } from "@/lib/oauth";

/** How this account can be signed into, and what else it could add. */
export const GET = route(async () => {
  const me = await requireUser();
  const linked = await identitiesFor(me.id);
  return NextResponse.json({
    identities: linked,
    available: availableProviders(),
    /** what could still be added — the screen offers these, not the linked ones */
    addable: availableProviders().filter((p) => !linked.some((l) => l.provider === p)),
  });
});

/**
 * Remove a way of signing in.
 *
 * Never the last one. An account with no identities left cannot be signed into
 * by anyone, including its owner — there is no password to fall back on and no
 * email to send a link to, which is the trade this app made when it dropped
 * passwords.
 */
export const DELETE = route(async (req: NextRequest) => {
  const me = await requireUser();
  const provider = new URL(req.url).searchParams.get("provider") as Provider | null;
  if (!provider || !PROVIDERS.includes(provider)) throw badRequest("Which sign-in?");

  const linked = await identitiesFor(me.id);
  if (!linked.some((l) => l.provider === provider)) {
    throw badRequest(`${provider} is not linked to this account.`);
  }
  if (linked.length <= 1) {
    throw badRequest(
      "That is the only way into this account. Add another sign-in before removing this one.",
    );
  }
  await sql`delete from identities where user_id = ${me.id} and provider = ${provider}`;
  return NextResponse.json({ ok: true, identities: await identitiesFor(me.id) });
});
