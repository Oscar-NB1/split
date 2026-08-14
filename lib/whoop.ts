import { sql } from "./db";

const AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const API = "https://api.prod.whoop.com/developer";

// offline is what gets you a refresh token. Without it you re-auth every hour.
export const SCOPES =
  "read:recovery read:cycles read:sleep read:workout read:profile offline";

export function authorizeUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: `${process.env.APP_URL}/api/whoop/callback`,
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `${AUTH}?${p}`;
}

type Tokens = {
  access_token: string;
  // optional on purpose: a refresh response does not always return a new one,
  // and writing null over the old one bricked the connection until re-auth
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

async function post(body: Record<string, string>) {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`whoop token: ${res.status} ${await res.text()}`);
  return (await res.json()) as Tokens;
}

export const exchangeCode = (code: string) =>
  post({
    grant_type: "authorization_code",
    code,
    client_id: process.env.WHOOP_CLIENT_ID!,
    client_secret: process.env.WHOOP_CLIENT_SECRET!,
    redirect_uri: `${process.env.APP_URL}/api/whoop/callback`,
  });

export async function saveTokens(userId: string, t: Tokens, whoopUserId = "") {
  await sql`
    insert into oauth_accounts
      (user_id, provider, provider_user_id, access_token, refresh_token, expires_at, scope, updated_at)
    values (${userId}, 'whoop', ${whoopUserId}, ${t.access_token}, ${t.refresh_token ?? null},
            now() + make_interval(secs => ${t.expires_in}), ${t.scope ?? SCOPES}, now())
    on conflict (user_id, provider) do update set
      access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, oauth_accounts.refresh_token),
      expires_at = excluded.expires_at,
      updated_at = now()
  `;
}

export async function accessTokenFor(userId: string): Promise<string> {
  const rows = await sql<
    { access_token: string; refresh_token: string | null; expires_at: Date | null }[]
  >`
    select access_token, refresh_token, expires_at from oauth_accounts
    where user_id = ${userId} and provider = 'whoop'
  `;
  const row = rows[0];
  if (!row) throw new Error("whoop not connected");
  // a null expiry means we do not know, so treat it as expired rather than
  // dereferencing it and throwing
  if (row.expires_at && row.expires_at.getTime() - Date.now() > 5 * 60 * 1000) {
    return row.access_token;
  }
  if (!row.refresh_token) throw new Error("whoop needs reconnecting - no refresh token");

  const t = await post({
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    client_id: process.env.WHOOP_CLIENT_ID!,
    client_secret: process.env.WHOOP_CLIENT_SECRET!,
    scope: "offline",
  });
  await saveTokens(userId, t);
  return t.access_token;
}

async function get<T>(userId: string, path: string): Promise<T> {
  const token = await accessTokenFor(userId);
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`whoop ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

type Page<T> = { records: T[]; next_token?: string };

/**
 * Follows Whoop's pagination to the end.
 *
 * Whoop caps `limit` at 25 and returns a `next_token`. That token was ignored,
 * so the "six months backfills on connect" promise actually imported about
 * three weeks and then stopped.
 */
async function getAll<T>(userId: string, path: string, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;

  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = token ? `${path}${sep}nextToken=${encodeURIComponent(token)}` : path;
    const page = await get<Page<T>>(userId, url);
    out.push(...(page.records ?? []));
    if (!page.next_token) return out;
    token = page.next_token;
  }
  console.warn(`whoop ${path}: stopped at ${maxPages} pages`);
  return out;
}

/**
 * Pulls recovery, cycles and sleep for a date window and folds them into one
 * row per day in `wellness`. Whoop keys everything off physiological cycles,
 * not calendar days, so we bucket by the cycle start date.
 */
export async function syncWellness(userId: string, sinceISO: string) {
  const start = new Date(sinceISO).toISOString();

  const cycles = await getAll<{
    id: number; start: string; score?: { strain: number; average_heart_rate: number };
  }>(userId, `/v2/cycle?start=${start}&limit=25`);

  const recoveries = await getAll<{
    cycle_id: number;
    score?: { recovery_score: number; hrv_rmssd_milli: number; resting_heart_rate: number };
  }>(userId, `/v2/recovery?start=${start}&limit=25`);

  const sleeps = await getAll<{
    start: string; score?: { stage_summary?: { total_in_bed_time_milli: number } };
  }>(userId, `/v2/activity/sleep?start=${start}&limit=25`);

  const byCycle = new Map(recoveries.map((r) => [r.cycle_id, r]));
  const sleepByDate = new Map(
    sleeps.map((s) => [
      s.start.slice(0, 10),
      (s.score?.stage_summary?.total_in_bed_time_milli ?? 0) / 3_600_000,
    ]),
  );

  for (const c of cycles) {
    const date = c.start.slice(0, 10);
    const r = byCycle.get(c.id);
    await sql`
      insert into wellness (user_id, local_date, recovery, hrv, rhr, strain, sleep_hours)
      values (${userId}, ${date}, ${r?.score?.recovery_score ?? null},
              ${r?.score?.hrv_rmssd_milli ?? null}, ${r?.score?.resting_heart_rate ?? null},
              ${c.score?.strain ?? null}, ${sleepByDate.get(date) ?? null})
      on conflict (user_id, local_date) do update set
        recovery = coalesce(excluded.recovery, wellness.recovery),
        hrv = coalesce(excluded.hrv, wellness.hrv),
        rhr = coalesce(excluded.rhr, wellness.rhr),
        strain = coalesce(excluded.strain, wellness.strain),
        sleep_hours = coalesce(excluded.sleep_hours, wellness.sleep_hours)
    `;
  }
  return cycles.length;
}
