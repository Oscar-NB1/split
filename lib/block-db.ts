import { sql } from "./db";
import { type Block, type Row, toBlock } from "./block";

/**
 * Loading an athlete's block.
 *
 * Split from lib/block.ts because that file is imported by client components — the
 * Week, Plan and Program screens all ask it which plan week a date falls in — and
 * a `sql` import there compiles postgres into the browser bundle.
 */

const SELECT = sql`
  select id, name, start_date::text as start_date, race_date::text as race_date,
         race_name, goal_label, goal_seconds, volume, intents, weeks
`;

/** The athlete's active block, or null if they have none. */
export async function blockFor(userId: string): Promise<Block | null> {
  const [row] = await sql<Row[]>`
    ${SELECT} from plan_templates
     where athlete_id = ${userId} and active
     order by start_date desc limit 1
  `;
  return row ? toBlock(row) : null;
}

/** Every athlete's block at once, keyed by user id — for the head-to-head. */
export async function blocksForAll(): Promise<Record<string, Block>> {
  const rows = await sql<(Row & { athlete_id: string })[]>`
    select t.id, t.athlete_id, t.name, t.start_date::text as start_date,
           t.race_date::text as race_date, t.race_name, t.goal_label,
           t.goal_seconds, t.volume, t.intents, t.weeks
      from plan_templates t where t.active order by t.start_date desc
  `;
  const out: Record<string, Block> = {};
  // ordered newest first, so the first row per athlete wins
  for (const r of rows) if (!out[r.athlete_id]) out[r.athlete_id] = toBlock(r);
  return out;
}

