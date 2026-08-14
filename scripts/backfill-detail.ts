/**
 * Backfills per-km splits and HR/pace streams for activities already imported.
 *
 *   npx tsx scripts/backfill-detail.ts                 # 2025-01-01 onwards
 *   npx tsx scripts/backfill-detail.ts 2024-01-01
 *   npx tsx scripts/backfill-detail.ts 2025-01-01 50   # cap the activity count
 *
 * Why a date default: HR only exists from 2025 on this account (2020-2024 runs
 * were recorded without a strap), and streams are the expensive part, so there
 * is nothing to gain from paying for the earlier years.
 *
 * Rate limits: Strava allows 100 read requests per 15 minutes and 1000 per day.
 * Each activity costs up to two (detail for splits, streams). This paces itself
 * at ~40/min of request budget and stops cleanly if Strava starts refusing, so
 * a rejected run can simply be re-run — every write is idempotent.
 */
import { sql } from "../lib/db";
import { detailGaps, fillDetail } from "../lib/detail";

const since = process.argv[2] ?? "2025-01-01";
const cap = process.argv[3] ? Number(process.argv[3]) : Infinity;

// Strava allows 100 read requests per 15 minutes = 6.67/min. An activity costs
// up to 2 (detail + streams), so the sustainable rate is ~3.3 activities/min,
// i.e. one every ~18s. Anything faster earns a 429 within the first minute —
// which is exactly what a 1.6s pause did on the first version of this script.
const REQUESTS_PER_15_MIN = 100;
const REQUESTS_PER_ACTIVITY = 2;
const PAUSE_MS = Math.ceil((15 * 60 * 1000) / (REQUESTS_PER_15_MIN / REQUESTS_PER_ACTIVITY)); // 18_000
const DAILY_BUDGET = 900; // leave headroom under 1000 for the app itself

async function main() {
  const gaps = await detailGaps(100000, since);
  const todo = gaps.slice(0, cap === Infinity ? gaps.length : cap);
  const estimate = todo.reduce((n, g) => n + (g.needs_detail ? 1 : 0) + (g.needs_streams ? 1 : 0), 0);

  console.log(`${todo.length} activities need detail since ${since}`);
  console.log(`  estimated Strava requests: ${estimate}` +
    (estimate > DAILY_BUDGET ? `  !! over the ${DAILY_BUDGET} daily budget — run again tomorrow to finish` : ""));

  let requests = 0, splits = 0, laps = 0, points = 0, done = 0, failed = 0;
  for (const gap of todo) {
    if (requests >= DAILY_BUDGET) {
      console.log(`\nstopping at the daily budget (${requests} requests). Re-run to continue.`);
      break;
    }
    try {
      const r = await fillDetail(gap);
      requests += r.requests; splits += r.splits; laps += r.laps; points += r.points; done++;
      if (done % 10 === 0 || done === todo.length) {
        console.log(`  ${done}/${todo.length}  requests=${requests}  splits=${splits}  laps=${laps}  stream points=${points}`);
      }
    } catch (e) {
      failed++;
      const msg = String(e);
      console.error(`  ! ${gap.provider_activity_id}: ${msg.slice(0, 120)}`);
      // 429 means the 15-minute window is exhausted. Wait it out rather than
      // abandoning the run — every write is idempotent, so nothing is lost, but
      // finishing in one pass beats asking the operator to come back.
      if (msg.includes("429") || /rate limit/i.test(msg)) {
        console.error("  rate limited — waiting 15 minutes for the window to reset");
        await new Promise((r) => setTimeout(r, 15 * 60 * 1000 + 5000));
      }
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(`\ndone — ${done} activities, ${requests} requests, ${splits} split rows, ` +
    `${laps} lap rows, ${points.toLocaleString()} stream points, ${failed} failed`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
