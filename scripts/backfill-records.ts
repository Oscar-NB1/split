/**
 * Sets the personal-best bar from history, silently.
 *
 * `recordsFor()` is called on the live webhook path, where a new best is worth a
 * notification. It was never run over the 499 activities already imported — so
 * the records table was empty, and the first run of the block would have
 * announced a "personal best" for anything better than nothing.
 *
 * This walks the history oldest-first and stores each new best without
 * announcing, which is exactly the behaviour the design asks for: history
 * establishes the bar in silence.
 *
 *   npx tsx scripts/backfill-records.ts            # dry run
 *   npx tsx scripts/backfill-records.ts --apply
 */
import { sql } from "../lib/db";
import { candidates, describe, METRICS, beats, type Metric } from "../lib/records";

const apply = process.argv.includes("--apply");

async function main() {
  const acts = await sql<{ id: string; user_id: string; name: string; local_date: string }[]>`
    select id, user_id, name, local_date::text as local_date
      from activities
     where detail_fetched_at is not null
     order by start_time asc
  `;
  console.log(`walking ${acts.length} activities with detail, oldest first`);

  // held in memory so a dry run reports exactly what an --apply would store
  const best = new Map<string, number>();
  const improvements: { on: string; what: string }[] = [];

  for (const a of acts) {
    for (const { metric, value } of await candidates(a.id)) {
      const key = `${a.user_id}:${metric}`;
      const previous = best.has(key) ? best.get(key)! : null;
      if (!beats(metric, value, previous)) continue;
      best.set(key, value);
      improvements.push({
        on: a.local_date,
        what: `${METRICS[metric].label}: ${METRICS[metric].format(value)}` +
          (previous == null ? " (first)" : ` from ${METRICS[metric].format(previous)}`),
      });
      if (apply) {
        await sql`
          insert into records (user_id, metric, value, activity_id, achieved_on, previous)
          values (${a.user_id}, ${metric}, ${value}, ${a.id}, ${a.local_date}, ${previous})
          on conflict (user_id, metric) do update set
            value = excluded.value, activity_id = excluded.activity_id,
            achieved_on = excluded.achieved_on, previous = excluded.previous
        `;
      }
    }
  }

  console.log(`\n${improvements.length} improvements over the history:`);
  for (const i of improvements.slice(-14)) console.log(`  ${i.on}  ${i.what}`);
  if (improvements.length > 14) console.log(`  … and ${improvements.length - 14} earlier`);

  console.log("\nthe bar, as it now stands:");
  for (const [key, v] of best) {
    const metric = key.split(":")[1] as Metric;
    console.log(`  ${METRICS[metric].label.padEnd(42)} ${METRICS[metric].format(v)}`);
  }
  if (!apply) console.log("\ndry run — pass --apply to store it");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
