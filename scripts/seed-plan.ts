/**
 * Writes each athlete's block into plan_templates, then materialises it.
 *
 *   npx tsx scripts/seed-plan.ts                 # dry run: prints what it would write
 *   npx tsx scripts/seed-plan.ts --apply
 *   npx tsx scripts/seed-plan.ts --apply --only=opouw33@gmail.com
 *
 * Re-runnable. The template row is upserted on (athlete, name) — enforced by a
 * unique index, after a plain insert here let the block be seeded twice and
 * duplicated every session in it — and materialise() only inserts sessions that
 * do not already exist for that date and slot. So running it again after editing
 * a plan adds what is new and never touches a session already moved, scaled or
 * completed.
 *
 * The athlete-to-plan assignment lives in ASSIGNMENTS below, and only covers plans
 * that were written from a real plan document. Everyone else gets theirs from the
 * intake — see lib/intake.ts — which is the only honest way to produce a block for
 * an athlete whose training nobody here knows anything about.
 */
import { sql } from "../lib/db";
import { materialise, type Rules, type TemplateDay } from "../lib/templates";
import type { IntentRange } from "../lib/block";
import * as hyroxNov from "../lib/plans/hyrox-nov-2026";

type Plan = {
  PLAN_NAME: string; PLAN_START: string;
  RACE_DATE: string; RACE_NAME: string;
  GOAL_LABEL: string | null; GOAL_SECONDS: number | null;
  RULES: Rules;
  VOLUME: { km: number; note: string }[];
  INTENTS: IntentRange[];
  WEEK_SHAPES: TemplateDay[][];
};

/**
 * Who is training for what.
 *
 * Keyed on email rather than on the order rows happen to be in: seeding by
 * "first user" is how the second athlete ends up with the first one's race.
 */
const ASSIGNMENTS: { email: string; plan: Plan }[] = [
  { email: "opouw33@gmail.com", plan: hyroxNov as Plan },
];

const apply = process.argv.includes("--apply");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

async function seed(userId: string, name: string, plan: Plan) {
  const sessions = plan.WEEK_SHAPES.reduce((n, w) => n + w.length, 0);
  const km = plan.VOLUME.reduce((n, v) => n + v.km, 0);
  console.log(`\n${name} → ${plan.PLAN_NAME}`);
  console.log(`  starts: ${plan.PLAN_START}`);
  console.log(`  race:   ${plan.RACE_NAME} on ${plan.RACE_DATE}` +
    (plan.GOAL_LABEL ? `, target ${plan.GOAL_LABEL}` : ", no target time set"));
  console.log(`  weeks:  ${plan.WEEK_SHAPES.length}, ${sessions} sessions, ${km} km planned`);

  if (!apply) return;

  const [tpl] = await sql<{ id: string }[]>`
    insert into plan_templates (
      athlete_id, author_id, name, start_date, weeks, rules, horizon, active,
      race_date, race_name, goal_label, goal_seconds, volume, intents
    )
    values (${userId}, ${userId}, ${plan.PLAN_NAME}, ${plan.PLAN_START},
            ${sql.json(plan.WEEK_SHAPES as never)}, ${sql.json(plan.RULES as never)}, 3, true,
            ${plan.RACE_DATE}, ${plan.RACE_NAME}, ${plan.GOAL_LABEL}, ${plan.GOAL_SECONDS},
            ${sql.json(plan.VOLUME as never)}, ${sql.json(plan.INTENTS as never)})
    on conflict (athlete_id, name) do update set
      start_date = excluded.start_date, weeks = excluded.weeks,
      rules = excluded.rules, horizon = excluded.horizon, active = true,
      race_date = excluded.race_date, race_name = excluded.race_name,
      goal_label = excluded.goal_label, goal_seconds = excluded.goal_seconds,
      volume = excluded.volume, intents = excluded.intents
    returning id
  `;
  const { created } = await materialise(tpl.id);
  console.log(`  written ${tpl.id}, materialised ${created} sessions`);
}

async function main() {
  for (const a of ASSIGNMENTS) {
    if (only && only !== a.email) continue;
    const [u] = await sql<{ id: string; display_name: string }[]>`
      select id, display_name from users where email = ${a.email}
    `;
    if (!u) { console.error(`no user ${a.email} — skipped`); continue; }
    await seed(u.id, u.display_name, a.plan);
  }
  if (!apply) console.log("\ndry run — pass --apply to write it");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
