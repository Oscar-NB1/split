import { sql } from "./db";
import { upsertActivity, type StravaActivity } from "./ingest";
import { stravaGet } from "./strava";

/**
 * Finding activities nobody told us about.
 *
 * Until now the only way an activity entered this database was the webhook. That
 * is fine while the webhook works and catastrophic when it does not: a missed
 * delivery, a deploy mid-upload, an expired subscription, or simply not having
 * created the subscription yet, and the run is absent forever. Nothing noticed,
 * because the hourly sweep only looked for activities *missing detail* — and an
 * activity that was never inserted has no row to be missing anything.
 *
 * So this sweeps the other direction: ask Strava what exists, and insert whatever
 * we do not have. The webhook stays the fast path — it delivers within seconds and
 * fetches the detailed payload — and this is the guarantee underneath it.
 *
 * Cost is one request per athlete per sweep. Strava allows 100 per 15 minutes.
 */

/** How far back to look. Long enough to cover a weekend of outage. */
const LOOKBACK_DAYS = 14;

/** Strava's page limit here; more than enough for two weeks of one athlete. */
const PER_PAGE = 50;

export type Discovered = {
  /** how many the summary list contained */
  seen: number;
  /** how many were not already stored */
  inserted: number;
  /** their Strava ids, for the cron log */
  ids: string[];
  requests: number;
};

/**
 * One athlete's recent activities, inserted if new.
 *
 * The summary payload is deliberately enough. It carries everything the activity
 * row needs, and pairs the session to the plan; what it lacks is `splits_metric`
 * and `laps`, so `detail_fetched_at` is left null and the existing detail sweep
 * picks it up on the same run. That ordering matters — inserting here and letting
 * that sweep fill the rest is what keeps this to a single request.
 */
export async function discoverFor(userId: string, days = LOOKBACK_DAYS): Promise<Discovered> {
  const after = Math.floor(Date.now() / 1000) - days * 86_400;
  const list = await stravaGet<StravaActivity[]>(
    userId,
    `/athlete/activities?after=${after}&per_page=${PER_PAGE}`,
  );
  const seen = Array.isArray(list) ? list : [];
  if (seen.length === 0) return { seen: 0, inserted: 0, ids: [], requests: 1 };

  // one query rather than one per activity: a fortnight is up to ~30 of them
  const known = await sql<{ provider_activity_id: string }[]>`
    select provider_activity_id from activities
     where provider = 'strava'
       and provider_activity_id = any(${seen.map((a) => String(a.id))})
  `;
  const have = new Set(known.map((k) => k.provider_activity_id));

  const ids: string[] = [];
  for (const a of seen) {
    if (have.has(String(a.id))) continue;
    // upsertActivity also pairs it to a planned session, so a run found this way
    // is as complete as one delivered by the webhook apart from its splits
    await upsertActivity(userId, a);
    ids.push(String(a.id));
  }
  return { seen: seen.length, inserted: ids.length, ids, requests: 1 };
}

/**
 * Every connected athlete. One failure must not stop the others — a revoked
 * Strava token for one of them is not a reason to stop finding the other's runs.
 */
export async function discoverAll(days = LOOKBACK_DAYS) {
  const users = await sql<{ id: string; email: string }[]>`
    select u.id, u.email from users u
     join oauth_accounts o on o.user_id = u.id and o.provider = 'strava'
     order by u.created_at
  `;
  const log: Record<string, unknown> = {};
  let requests = 0;
  for (const u of users) {
    try {
      const r = await discoverFor(u.id, days);
      requests += r.requests;
      log[u.email] = { seen: r.seen, inserted: r.inserted };
    } catch (e) {
      log[u.email] = String(e);
    }
  }
  return { log, requests };
}
