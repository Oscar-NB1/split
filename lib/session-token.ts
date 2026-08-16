import { SignJWT, jwtVerify } from "jose";

/**
 * The session token on its own, with no database and no `next/headers`.
 *
 * Split out so the middleware can import it: middleware runs on the Edge
 * runtime, where `postgres` will not load, and importing `lib/session.ts` there
 * would drag the whole database client in behind it.
 */

/**
 * Deliberately still `split_session` after the rename to Hyrox Coaching App.
 *
 * The cookie name is not a product name, it is a key: renaming it would sign
 * out everyone holding the old one, which is precisely the thing the rolling
 * refresh exists to prevent. Same reasoning for the `split-` prefixed
 * localStorage keys — renaming those resets the theme someone chose.
 */
export const COOKIE = "split_session";
export const MAX_AGE = 60 * 60 * 24 * 180;
/** Re-sign a token once it is a week old. Rare enough to be free, frequent
 *  enough that any session used within six months never lapses. */
export const REFRESH_AFTER = 60 * 60 * 24 * 7;

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET!);

export const sign = (userId: string) =>
  new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(secret());

/** Seconds since the token was issued, or null if it does not verify. */
export async function secondsSinceIssue(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.iat) return null;
    return Math.floor(Date.now() / 1000) - payload.iat;
  } catch {
    return null;
  }
}

/** A new token for the same subject, or null if the old one is not valid. */
export async function reissue(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.sub ? await sign(payload.sub) : null;
  } catch {
    return null;
  }
}
