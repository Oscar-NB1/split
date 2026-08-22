import { SignJWT, jwtVerify } from "jose";
import { sql } from "./db";

const AUTH = "https://www.strava.com/oauth/authorize";
const TOKEN = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";

/**
 * What we ask Strava for, and what each one is in plain words.
 *
 * `activity:read_all` is off by default. It is the difference between an
 * athlete's public activities and everything they have ever recorded, and
 * asking for it up front — as this used to — is asking for more than the app
 * needs from someone who has not yet decided to trust it.
 */
export const SCOPE_ROWS = [
  { key: "read", label: "Your profile", sub: "Name and photo, so the app is yours.", required: true },
  {
    key: "activity:read", label: "Your activities", required: true,
    sub: "Every run, ride and session — matched to the day it was planned for.",
  },
  {
    key: "activity:read_all", label: "Private activities", required: false,
    sub: "Anything you have marked private. Off unless you turn it on.",
  },
] as const;

/** The default ask: everything required, nothing more. */
export const SCOPES = SCOPE_ROWS.filter((s) => s.required).map((s) => s.key).join(",");

/** The ask when someone has opted into private activities too. */
export const SCOPES_WITH_PRIVATE = SCOPE_ROWS.map((s) => s.key).join(",");

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET!);

/**
 * The `state` Strava hands back to us, signed.
 *
 * It used to be the raw user id, which meant the callback trusted whatever came
 * back in a query string: anyone who could get a signed-in athlete to load a
 * crafted callback URL could bind their own Strava account to that athlete's —
 * or bind the athlete's to someone else. The callback checks no session, so the
 * id in the URL was the only thing deciding whose account got written.
 *
 * Signed and short-lived instead. Deliberately a token rather than a cookie: on
 * iOS an OAuth round trip can leave a standalone PWA and come back through
 * Safari, which has its own cookie jar, and a cookie-based nonce would break
 * exactly the flow this exists to protect.
 */
export const oauthState = (userId: string) =>
  new SignJWT({ sub: userId, use: "strava-oauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());

/** The athlete a callback belongs to, or null if it was not one of ours. */
export async function readOauthState(token: string | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.use === "strava-oauth" ? (payload.sub as string) : null;
  } catch {
    return null;
  }
}

export function authorizeUrl(state: string, includePrivate = false) {
  const p = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: `${process.env.APP_URL}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: includePrivate ? SCOPES_WITH_PRIVATE : SCOPES,
    state,
  });
  return `${AUTH}?${p}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  scope?: string;
  athlete?: { id: number };
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`strava token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function saveTokens(userId: string, t: TokenResponse) {
  await sql`
    insert into oauth_accounts
      (user_id, provider, provider_user_id, access_token, refresh_token, expires_at, scope, updated_at)
    values
      (${userId}, 'strava', ${String(t.athlete?.id ?? "")}, ${t.access_token},
       ${t.refresh_token}, to_timestamp(${t.expires_at}), ${t.scope ?? SCOPES}, now())
    on conflict (user_id, provider) do update set
      access_token  = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at    = excluded.expires_at,
      scope         = excluded.scope,
      /*
       * Kept, not overwritten, when the new value is empty.
       *
       * Strava returns the athlete object on the initial authorization exchange and omits it
       * from every refresh — so this wrote the id once and then blanked it six hours later,
       * every time, for everybody. The webhook finds its owner by exactly this column, so the
       * fast path was dead within a day of each athlete signing in and nothing said so: the
       * hourly sweep kept finding the activities eventually, up to an hour late, and looked
       * like the system working.
       */
      provider_user_id = coalesce(
        nullif(excluded.provider_user_id, ''), oauth_accounts.provider_user_id),
      updated_at    = now()
  `;
}

/**
 * Returns a valid access token for this user, refreshing if it expires
 * within the next 5 minutes. Strava access tokens live 6 hours.
 */
export async function accessTokenFor(userId: string): Promise<string> {
  const rows = await sql<
    { access_token: string; refresh_token: string; expires_at: Date }[]
  >`
    select access_token, refresh_token, expires_at
    from oauth_accounts where user_id = ${userId} and provider = 'strava'
  `;
  const row = rows[0];
  if (!row) throw new Error("strava not connected for this user");

  const stillValid = row.expires_at.getTime() - Date.now() > 5 * 60 * 1000;
  if (stillValid) return row.access_token;

  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`strava refresh failed: ${await res.text()}`);
  const t: TokenResponse = await res.json();
  await saveTokens(userId, t);
  return t.access_token;
}

/**
 * A failed Strava call, carrying its status code.
 *
 * The status is a property rather than only part of the message because callers
 * need to branch on it: a 404 from the streams endpoint means "this activity has
 * no time series", which is a normal answer to record, while a 401 or 500 means
 * try again later. String-matching a message to tell those apart is how a
 * permanent condition ends up being retried hourly forever.
 */
export class StravaHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "StravaHttpError";
  }
}

/** Authenticated GET against the Strava API. Path starts with a slash. */
export async function stravaGet<T>(userId: string, path: string): Promise<T> {
  const token = await accessTokenFor(userId);
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    throw new StravaHttpError(429, "strava rate limit hit - back off 15 minutes");
  }
  if (!res.ok) {
    // status first: paths here are ~110 characters, so any log that truncates
    // the message would otherwise cut off the one part worth reading
    throw new StravaHttpError(res.status, `strava ${res.status} on ${path} -> ${await res.text()}`);
  }
  return res.json();
}
