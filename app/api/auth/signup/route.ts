import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/http";
import { issueSession } from "@/lib/session";
import { createAccount } from "@/lib/auth";
import { availableProviders } from "@/lib/oauth";

/** Create an account, and sign in as it. */
export const POST = route(async (req: NextRequest) => {
  const body = await req.json();
  const made = await createAccount({
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    password: String(body.password ?? ""),
  });
  if (!made.ok) return NextResponse.json({ problems: made.problems }, { status: 400 });
  await issueSession(made.userId);
  return NextResponse.json({ ok: true });
});

/** What the sign-up screen can offer: the password form, plus whatever is set up. */
export const GET = route(async () =>
  NextResponse.json({ providers: availableProviders() }));
