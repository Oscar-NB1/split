/**
 * One-time history import.
 *   npx tsx scripts/backfill-strava.ts <email> [afterISODate]
 *
 * Walks /athlete/activities backwards through every page. Strava's read
 * limits are 100 requests per 15 minutes, so this paces itself; a decade
 * of training is roughly 10-20 pages, well inside one window.
 */
import { sql } from "../lib/db";
import { stravaGet } from "../lib/strava";
import { upsertActivity, type StravaActivity } from "../lib/ingest";

const email = process.argv[2];
const after = process.argv[3] ? Date.parse(process.argv[3]) / 1000 : undefined;

async function main() {
  if (!email) throw new Error("usage: backfill-strava.ts <email> [afterISODate]");

  const rows = await sql<{ id: string }[]>`select id from users where email = ${email}`;
  const userId = rows[0]?.id;
  if (!userId) throw new Error(`no user with email ${email}`);

  let page = 1;
  let total = 0;

  for (;;) {
    const qs = new URLSearchParams({ per_page: "200", page: String(page) });
    if (after) qs.set("after", String(Math.floor(after)));

    const batch = await stravaGet<StravaActivity[]>(userId, `/athlete/activities?${qs}`);
    if (batch.length === 0) break;

    for (const a of batch) {
      await upsertActivity(userId, a);
      total++;
    }
    console.log(`page ${page}: ${batch.length} activities (${total} total)`);

    page++;
    await new Promise((r) => setTimeout(r, 1500)); // stay well under the limit
  }

  console.log(`\ndone - ${total} activities imported for ${email}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
