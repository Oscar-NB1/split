import { sql } from "./db";
import { materialise } from "./templates";
import { deltaFrom, sayDelta, type Feel } from "./strength-feel";

/**
 * Reading every length report an athlete has given, and re-writing the sessions.
 *
 * Kept apart from the pure rule in `strength-feel.ts` so the rule can be tested
 * without a database and this can be the only place that touches one.
 *
 * Recomputed from the whole history rather than nudged by the latest answer. The
 * history is the truth: an athlete who changes an old answer, or a plan rebuilt from
 * the intake, should land on the same number as one who answered in order — and a
 * counter that is only ever incremented drifts the moment anything is edited.
 */
export async function applyLengthFeel(userId: string, latest: Feel): Promise<string | null> {
  const [tpl] = await sql<{ id: string; strength_accessories_delta: number }[]>`
    select id, strength_accessories_delta
      from plan_templates where athlete_id = ${userId} and active
     order by start_date desc limit 1
  `;
  // No block, nothing to re-write. The report is still stored — it will be read the
  // moment they have a plan.
  if (!tpl) return null;

  const rows = await sql<{ length_feel: Feel }[]>`
    select f.length_feel
      from session_feedback f
      join planned_sessions p on p.id = f.session_id
     where p.user_id = ${userId} and p.kind = 'strength' and f.length_feel is not null
     order by p.planned_date
  `;
  const before = tpl.strength_accessories_delta;
  const after = deltaFrom(rows.map((r) => r.length_feel));
  if (after === before) return sayDelta(before, after);

  await sql`
    update plan_templates set strength_accessories_delta = ${after} where id = ${tpl.id}
  `;
  /*
   * Re-written immediately, so the change is on next week's session rather than on
   * whichever one happens to be generated next.
   *
   * Only untouched future sessions move — the same rule the pace shift uses. A
   * session an athlete has already logged sets against is theirs.
   */
  await materialise(tpl.id);
  return sayDelta(before, after);
}

/** The delta to build a session with, for whoever is generating one. */
export async function accessoriesFor(userId: string): Promise<number> {
  const [row] = await sql<{ strength_accessories_delta: number }[]>`
    select strength_accessories_delta from plan_templates
     where athlete_id = ${userId} and active order by start_date desc limit 1
  `;
  return row?.strength_accessories_delta ?? 0;
}
