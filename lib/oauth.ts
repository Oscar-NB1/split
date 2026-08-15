import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from "jose";
import { sql } from "./db";
import { normaliseEmail } from "./auth";

/**
 * Signing in with Google, Apple or Strava.
 *
 * One shape for three providers that are genuinely different: Google and Apple
 * are OpenID Connect and hand back a signed id_token; Strava is plain OAuth2 and
 * hands back an athlete. What they have in common is a stable subject, and that
 * is what an identity is keyed on — never the email, which people change.
 */

export const PROVIDERS = ["google", "apple", "strava"] as const;
export type Provider = (typeof PROVIDERS)[number];

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET!);

/** Where the provider sends them back to. Must match what is registered there. */
export const callbackUrl = (p: Provider) => `${process.env.APP_URL}/api/auth/oauth/${p}/callback`;

/**
 * The `state` round trip, signed rather than stored.
 *
 * A cookie nonce is the usual answer and it is the wrong one here: on iOS a
 * sign-in can leave a standalone PWA, run through Safari and come back, and
 * Safari has its own cookie jar. A signed token survives that; a cookie does not.
 */
export const signState = (payload: Record<string, unknown>) =>
  new SignJWT({ ...payload, use: "oauth-signin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());

export async function readState(token: string | null): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.use === "oauth-signin" ? payload : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ profiles

export type Profile = {
  provider: Provider;
  /** the provider's own id. Stable across email changes; the only safe key. */
  subject: string;
  email: string | null;
  /** whether the PROVIDER says the address is confirmed, not whether it looks fine */
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
  /** Kilograms, where the provider knows it. Strava does; Google does not. */
  weightKg: number | null;
  /** Strava only: signing in with Strava also connects it. */
  strava?: { access_token: string; refresh_token: string; expires_at: number; athleteId: string };
};

type Config = {
  authorize: string; token: string; scope: string;
  /** Apple posts the callback instead of redirecting it. */
  responseMode?: string;
  extra?: Record<string, string>;
};

const CONFIG: Record<Provider, Config> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    extra: { access_type: "online", prompt: "select_account" },
  },
  apple: {
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    scope: "name email",
    // Apple only returns name and email as a form POST, and only the first time
    responseMode: "form_post",
  },
  strava: {
    authorize: "https://www.strava.com/oauth/authorize",
    token: "https://www.strava.com/oauth/token",
    // the same scope the data connection uses: signing in with Strava connects it
    scope: "read,activity:read_all",
    extra: { approval_prompt: "auto" },
  },
};

const clientId = (p: Provider) =>
  p === "strava" ? process.env.STRAVA_CLIENT_ID : process.env[`${p.toUpperCase()}_CLIENT_ID`];

/** Is this provider actually set up? Screens ask so they can hide what cannot work. */
export function configured(p: Provider): boolean {
  if (!clientId(p) || !process.env.APP_URL) return false;
  if (p === "apple") {
    return !!(process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);
  }
  if (p === "strava") return !!process.env.STRAVA_CLIENT_SECRET;
  return !!process.env.GOOGLE_CLIENT_SECRET;
}

export const availableProviders = () => PROVIDERS.filter(configured);

export async function authorizeUrl(p: Provider, state: string): Promise<string> {
  const c = CONFIG[p];
  const params = new URLSearchParams({
    client_id: clientId(p)!,
    redirect_uri: callbackUrl(p),
    response_type: "code",
    scope: c.scope,
    state,
    ...(c.responseMode ? { response_mode: c.responseMode } : {}),
    ...(c.extra ?? {}),
  });
  return `${c.authorize}?${params}`;
}

/**
 * Apple's client secret is a short-lived ES256 JWT signed with a key you
 * download once, rather than a string you store. It has to be minted per
 * request, which is the only reason this function is async.
 */
async function clientSecret(p: Provider): Promise<string> {
  if (p !== "apple") {
    return (p === "strava" ? process.env.STRAVA_CLIENT_SECRET : process.env.GOOGLE_CLIENT_SECRET)!;
  }
  // the .p8 arrives with literal \n when it is pasted into an environment
  const pem = process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const key = await importPKCS8(pem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_KEY_ID! })
    .setIssuer(process.env.APPLE_TEAM_ID!)
    .setAudience("https://appleid.apple.com")
    .setSubject(process.env.APPLE_CLIENT_ID!)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

/** Read an OIDC id_token, verifying the signature rather than decoding it. */
async function readIdToken(p: Provider, token: string) {
  const { payload } = await jwtVerify(token, p === "google" ? GOOGLE_JWKS : APPLE_JWKS, {
    issuer: p === "google" ? "https://accounts.google.com" : "https://appleid.apple.com",
    audience: clientId(p)!,
  });
  return payload as {
    sub: string; email?: string; email_verified?: boolean | string;
    name?: string; picture?: string;
  };
}

/**
 * Trade the code for who they are.
 *
 * `emailVerified` is taken from the provider and never inferred. It decides
 * whether this identity may join an existing account, so treating an unverified
 * address as verified would let anyone claim an account by asserting its email.
 */
export async function exchange(p: Provider, code: string): Promise<Profile> {
  const res = await fetch(CONFIG[p].token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(p)!,
      client_secret: await clientSecret(p),
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(p),
    }),
  });
  if (!res.ok) throw new Error(`${p} refused the code (${res.status})`);
  const json = await res.json();

  if (p === "strava") {
    const a = json.athlete ?? {};
    return {
      provider: p,
      subject: String(a.id),
      // Strava's athlete object has not carried an email for years
      email: null,
      emailVerified: false,
      name: [a.firstname, a.lastname].filter(Boolean).join(" ") || null,
      avatar: a.profile ?? null,
      // Strava's athlete object carries a weight, which the app otherwise has to
      // ask for. Its `sex` field is deliberately ignored: division is asked, and
      // nothing here derives a training load from someone's sex.
      weightKg: typeof a.weight === "number" && a.weight > 20 && a.weight < 300
        ? a.weight : null,
      strava: {
        access_token: json.access_token, refresh_token: json.refresh_token,
        expires_at: json.expires_at, athleteId: String(a.id),
      },
    };
  }

  const id = await readIdToken(p, json.id_token);
  return {
    provider: p,
    subject: id.sub,
    email: id.email ? normaliseEmail(id.email) : null,
    emailVerified: id.email_verified === true || id.email_verified === "true",
    name: id.name ?? null,
    avatar: id.picture ?? null,
    weightKg: null,
  };
}

// ------------------------------------------------------- turning it into a user

export type Resolution =
  | { kind: "signed-in"; userId: string }
  | { kind: "created"; userId: string }
  | { kind: "linked"; userId: string }
  | { kind: "conflict"; email: string };

/**
 * Which account this identity belongs to.
 *
 * Three cases, and the third is where accounts get stolen if it is done loosely:
 *
 *   1. We have seen this (provider, subject) before — sign them in. The email
 *      may have changed since; the subject has not, which is why it is the key.
 *   2. Nobody has this subject, and no account has this email — create one.
 *   3. Nobody has this subject, but an account has this email. Join them ONLY if
 *      the provider states the address is verified. Otherwise refuse and say so:
 *      anyone can put someone else's address into an unverified profile, and
 *      linking on that alone hands over their training history.
 */
export async function resolveIdentity(profile: Profile): Promise<Resolution> {
  const [existing] = await sql<{ user_id: string }[]>`
    select user_id from identities
     where provider = ${profile.provider} and subject = ${profile.subject}
  `;
  if (existing) {
    await sql`
      update identities set last_used = now()
       where provider = ${profile.provider} and subject = ${profile.subject}
    `;
    return { kind: "signed-in", userId: existing.user_id };
  }

  if (profile.email) {
    const [byEmail] = await sql<{ id: string }[]>`
      select id from users where lower(email) = ${profile.email}
    `;
    if (byEmail) {
      if (!profile.emailVerified) return { kind: "conflict", email: profile.email };
      await link(profile, byEmail.id);
      return { kind: "linked", userId: byEmail.id };
    }
  }

  const [created] = await sql<{ id: string }[]>`
    insert into users (email, display_name, avatar_url, email_verified, weight_kg)
    values (${profile.email}, ${profile.name ?? "Athlete"}, ${profile.avatar},
            ${profile.emailVerified}, ${profile.weightKg})
    returning id
  `;
  await link(profile, created.id);
  return { kind: "created", userId: created.id };
}

/**
 * Fill in what the account is missing, and overwrite nothing.
 *
 * A provider knows a name, a photo and — for Strava — a weight, which saves
 * asking for any of it. But someone who has typed their own name or corrected
 * their weight has said something the provider has not, so this only ever writes
 * into a gap. `coalesce` in the other order would quietly undo an edit on every
 * sign-in, which is the kind of bug nobody reports and everybody notices.
 */
export async function fillProfileGaps(userId: string, profile: Profile) {
  await sql`
    update users set
      display_name = case when display_name in ('', 'Athlete')
        then coalesce(${profile.name}, display_name) else display_name end,
      avatar_url = coalesce(avatar_url, ${profile.avatar}),
      weight_kg  = coalesce(weight_kg, ${profile.weightKg}),
      email      = coalesce(email, ${profile.email}),
      email_verified = email_verified or (${profile.emailVerified} and email is null)
    where id = ${userId}
  `;
}

export async function link(profile: Profile, userId: string) {
  await sql`
    insert into identities (provider, subject, user_id, email, last_used)
    values (${profile.provider}, ${profile.subject}, ${userId}, ${profile.email}, now())
    on conflict (provider, subject) do update set last_used = now()
  `;
}
