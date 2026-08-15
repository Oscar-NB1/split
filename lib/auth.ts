import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./db";

/**
 * Accounts: creating one, and proving you own it.
 *
 * Everything in this app hangs off a user id — activities, plans, zones,
 * records, the coaching relationship — so this is the one place where a mistake
 * hands somebody another athlete's training history.
 *
 * Passwords are hashed with scrypt from Node's own crypto, deliberately without
 * a dependency: bcrypt and argon2 are native modules that have to be rebuilt for
 * whatever runtime this deploys onto, and a password hash is not the place to
 * discover a build problem.
 */

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** ~16 MB and ~100 ms per hash. Slow enough to matter, fast enough to sign in. */
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

/** `scrypt$N$r$p$salt$hash`, so the cost can be raised later without a migration. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p,
    salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * Constant-time verify.
 *
 * Returns false rather than throwing on a malformed stored value: a row that
 * cannot be parsed is a row nobody can sign in with, which is the safe answer.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  try {
    const expected = Buffer.from(hash, "base64");
    const got = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64"),
      expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------- emails

/**
 * One spelling of an address.
 *
 * Lowercased and trimmed, because "Sarah@Example.com" and "sarah@example.com"
 * are the same mailbox and letting both exist means two accounts holding half a
 * training history each. Dots and plus-tags are left alone: they are only
 * equivalent at some providers, and silently merging them would be wrong at the
 * others.
 */
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const looksLikeEmail = (email: string) => EMAIL.test(normaliseEmail(email));

// ----------------------------------------------------------------- passwords

/** The shortest password worth having, and the reason it is not shorter. */
export const MIN_PASSWORD = 10;

/**
 * What is wrong with this password, in words the person can act on.
 *
 * Length only, plus a check against the obvious. Composition rules — a digit, a
 * symbol, a capital — push people towards "Password1!" and buy nothing; length
 * is what actually costs an attacker.
 */
export function passwordProblems(password: string, context: string[] = []): string[] {
  const out: string[] = [];
  const pw = password.normalize("NFKC");
  if (pw.length < MIN_PASSWORD) out.push(`At least ${MIN_PASSWORD} characters.`);
  if (pw.length > 200) out.push("That is longer than we can store.");
  const low = pw.toLowerCase();
  if (COMMON.has(low)) out.push("That is one of the most guessed passwords there is.");
  for (const c of context) {
    const bit = c.trim().toLowerCase();
    if (bit.length > 3 && low.includes(bit)) {
      out.push("Do not put your name or email in your password.");
      break;
    }
  }
  return out;
}

/** Not a dictionary — the handful that appear at the top of every breach list. */
const COMMON = new Set([
  "password", "password1", "password123", "123456789", "1234567890",
  "qwertyuiop", "letmein123", "iloveyou1", "adminadmin", "welcome123",
]);

// ------------------------------------------------------------------ lockout

/** Attempts before an account stops answering, and for how long. */
export const MAX_ATTEMPTS = 8;
export const LOCK_MINUTES = 15;

export type Account = {
  id: string; email: string | null; display_name: string;
  password_hash: string | null; failed_logins: number; locked_until: string | null;
};

export const byEmail = async (email: string): Promise<Account | null> => {
  const [row] = await sql<Account[]>`
    select id, email, display_name, password_hash, failed_logins,
           locked_until::text as locked_until
      from users where lower(email) = ${normaliseEmail(email)}
  `;
  return row ?? null;
};

export const isLocked = (a: Account, now = new Date()) =>
  !!a.locked_until && new Date(a.locked_until) > now;

/**
 * Record a failed attempt, locking the account once there have been too many.
 *
 * Per account rather than per address in a rate limiter, because the thing worth
 * protecting is one person's history and the attacker chooses the address.
 */
export async function noteFailure(id: string) {
  await sql`
    update users
       set failed_logins = failed_logins + 1,
           locked_until = case when failed_logins + 1 >= ${MAX_ATTEMPTS}
             then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
     where id = ${id}
  `;
}

export const noteSuccess = (id: string) => sql`
  update users set failed_logins = 0, locked_until = null where id = ${id}
`;

// ------------------------------------------------------------------ creating

export type SignUp = { name: string; email: string; password: string };

export type Created =
  | { ok: true; userId: string }
  | { ok: false; problems: { field: string; why: string }[] };

/**
 * Create an account.
 *
 * The email is taken as a claim, not as proof: `email_verified` stays false
 * until something confirms it, and nothing links an OAuth identity to an
 * unverified address — otherwise anyone could claim someone else's account by
 * signing up with their email first.
 */
export async function createAccount(input: SignUp): Promise<Created> {
  const problems: { field: string; why: string }[] = [];
  const name = input.name?.trim() ?? "";
  const email = normaliseEmail(input.email ?? "");
  const password = input.password ?? "";

  if (name.length < 2) problems.push({ field: "name", why: "What should we call you?" });
  if (name.length > 80) problems.push({ field: "name", why: "That is a very long name." });
  if (!looksLikeEmail(email)) problems.push({ field: "email", why: "That does not look like an email address." });
  for (const why of passwordProblems(password, [name, email.split("@")[0]])) {
    problems.push({ field: "password", why });
  }
  if (problems.length) return { ok: false, problems };

  const password_hash = await hashPassword(password);
  const [row] = await sql<{ id: string }[]>`
    insert into users (email, display_name, password_hash)
    values (${email}, ${name}, ${password_hash})
    on conflict do nothing
    returning id
  `;
  if (!row) {
    return { ok: false, problems: [{ field: "email", why: "There is already an account with that email." }] };
  }
  return { ok: true, userId: row.id };
}

/**
 * Adopt an account that exists but has no password yet.
 *
 * The two athletes here were created by an access code and by a Strava sign-in,
 * so they have rows and no way to sign in with a password. Setting one is not a
 * reset: it is refused the moment a password already exists, so it can never be
 * used to take an account over.
 */
export async function setInitialPassword(email: string, password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  const rows = await sql`
    update users set password_hash = ${hash}
     where lower(email) = ${normaliseEmail(email)} and password_hash is null
     returning id
  `;
  return rows.length > 0;
}
