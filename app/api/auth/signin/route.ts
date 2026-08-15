import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/http";
import { issueSession } from "@/lib/session";
import {
  LOCK_MINUTES, byEmail, hashPassword, isLocked, noteFailure, noteSuccess, verifyPassword,
} from "@/lib/auth";

/**
 * Sign in with an email and a password.
 *
 * Two things this deliberately does not do. It does not say whether the address
 * exists — "email or password" covers both, so the form cannot be used to find
 * out who has an account. And it does not return early when the address is
 * unknown: it hashes anyway, so the time taken does not answer the question the
 * message refuses to.
 */
const WRONG = { error: "That email and password do not match." };

export const POST = route(async (req: NextRequest) => {
  const body = await req.json();
  const email = String(body.email ?? "");
  const password = String(body.password ?? "");

  const account = await byEmail(email);
  if (!account) {
    // same work as a real attempt, so the timing says nothing
    await hashPassword(password);
    return NextResponse.json(WRONG, { status: 401 });
  }
  if (isLocked(account)) {
    return NextResponse.json({
      error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`,
    }, { status: 429 });
  }
  if (!(await verifyPassword(password, account.password_hash))) {
    await noteFailure(account.id);
    return NextResponse.json(WRONG, { status: 401 });
  }
  await noteSuccess(account.id);
  await issueSession(account.id);
  return NextResponse.json({ ok: true });
});
