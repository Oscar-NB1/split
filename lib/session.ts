import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql, type User } from "./db";
import { unauthorized } from "./http";

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET!);
const COOKIE = "split_session";

export async function issueSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

/** Returns the signed-in user, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const rows = await sql<User[]>`
      select id, email, display_name from users where id = ${payload.sub as string}
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Guards a write route. Throws an HttpError, so wrapping the handler in
 * `route()` (or `redirectingRoute()`) turns a dead session into a 401 or a
 * trip to the login screen instead of a 500.
 */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw unauthorized();
  return u;
}
