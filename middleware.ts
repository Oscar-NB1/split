import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, MAX_AGE, REFRESH_AFTER, reissue, secondsSinceIssue } from "./lib/session-token";

/**
 * Keeps a signed-in session signed in.
 *
 * The cookie already lasted 180 days, but it was fixed at sign-in: it counted
 * down whether or not you used the app, so someone who opened it every morning
 * was still logged out six months later for no reason they could see. The token
 * is now re-signed whenever it is more than a week old, which makes an active
 * session indefinite. Sign out is the only thing that ends it.
 *
 * This runs here rather than in `currentUser()` because a server component
 * cannot set a cookie during render — the write has to happen on a response,
 * and middleware is the one place every request passes through. It only
 * verifies and re-signs the JWT: the Edge runtime has no database, and asking
 * it for one would put a query in front of every static asset.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.next();

  const age = await secondsSinceIssue(token);
  if (age === null || age < REFRESH_AFTER) return NextResponse.next();

  const fresh = await reissue(token);
  if (!fresh) return NextResponse.next();

  const res = NextResponse.next();
  res.cookies.set(COOKIE, fresh, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: MAX_AGE,
  });
  return res;
}

export const config = {
  // Everything a person navigates to, and nothing a build step emits.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest).*)"],
};
