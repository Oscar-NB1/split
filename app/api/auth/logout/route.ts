import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Clears the session and returns to the login screen.
 *
 * A GET because the sign-out control is a link the browser navigates to; there
 * is nothing to protect against here beyond ending your own session, and a
 * fetch+redirect dance would only add a failure mode.
 */
export async function GET(req: Request) {
  (await cookies()).delete("split_session");
  return NextResponse.redirect(new URL("/login", req.url));
}
