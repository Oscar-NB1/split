/**
 * Writes the Hyrox block into plan_templates, then materialises it.
 *
 *   npx tsx scripts/seed-plan.ts            # dry run: prints what it would write
 *   npx tsx scripts/seed-plan.ts --apply
 *
 * Re-runnable. The template row is upserted on (athlete, name), and
 * materialise() only inserts sessions that don't already exist for that date and
 * slot — so running it again after editing the plan adds what is new and never
 * touches a session already moved, scaled or completed.
 */
import { sql } from "../lib/db";
import { materialise } from "../lib/templates";
import { PLAN_NAME, PLAN_START, RULES, WEEK_SHAPES } from "../lib/plans/hyrox-nov-2026";

const apply = process.argv.includes("--apply");

async function main() {
  const [me] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users order by created_at limit 1
  `;
  if (!me) throw new Error("no users — run db:seed first");

  const sessions = WEEK_SHAPES.reduce((n, w) => n + w.length, 0);
  console.log(`plan: ${PLAN_NAME}`);
  console.log(`  athlete: ${me.display_name}`);
  console.log(`  starts:  ${PLAN_START}`);
  console.log(`  weeks:   ${WEEK_SHAPES.length}, ${sessions} sessions written across them`);
  WEEK_SHAPES.forEach((w, i) => {
    const notable = w.filter((d) => d.significance).map((d) => `${d.title}`);
    console.log(`   wk ${String(i + 1).padStart(2)}: ${w.length} sessions` +
      (notable.length ? `  · ${notable.join(", ")}` : ""));
  });

  if (!apply) {
    console.log("\ndry run — pass --apply to write it");
    await sql.end();
    return;
  }

  // A real upsert, which this only ever claimed to be. Without it a second run
  // wrote a second active template, and materialise() — keyed on a source_ref
  // that starts with the template id — duplicated every session in the block.
  const [tpl] = await sql<{ id: string }[]>`
    insert into plan_templates (athlete_id, author_id, name, start_date, weeks, rules, horizon, active)
    values (${me.id}, ${me.id}, ${PLAN_NAME}, ${PLAN_START},
            ${sql.json(WEEK_SHAPES as never)}, ${sql.json(RULES as never)}, 3, true)
    on conflict (athlete_id, name) do update set
      start_date = excluded.start_date, weeks = excluded.weeks,
      rules = excluded.rules, horizon = excluded.horizon, active = true
    returning id
  `;
  console.log(`\ntemplate ${tpl.id} written`);

  const { created } = await materialise(tpl.id);
  console.log(`materialised ${created} sessions (horizon 3 weeks — the rest stays derived)`);

  const rows = await sql<{ planned_date: string; title: string; kind: string }[]>`
    select planned_date::text as planned_date, title, kind from planned_sessions
     where user_id = ${me.id} and source = 'template'
     order by planned_date limit 12
  `;
  console.log("\nfirst sessions on the calendar:");
  for (const r of rows) console.log(`  ${r.planned_date}  ${r.kind.padEnd(14)} ${r.title}`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
