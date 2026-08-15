import { sql } from "../db";
import { best, confidenceFrom, type Capability, type Source } from "./capability";
import { GENERATOR_VERSION, type Generated, type Params, generate } from "./generate";

/**
 * Persisting plans, and regenerating them without losing history.
 *
 * The generator is pure; everything that touches the database lives here. That
 * split is what lets a plan be reproduced six months later from its own stored
 * inputs rather than from whatever the tables happen to hold today.
 */

export type StoredPlan = {
  id: string; race_target_id: string; generated_at: string;
  generator_version: string; confidence: string;
  resolved_params: Params; weeks: Generated["weeks"];
  flags: Generated["flags"]; active: boolean; superseded_by: string | null;
};

/** Seed the quiz answers as capability at the lowest rank. */
export async function seedCapability(
  athleteId: string, values: Record<string, number>, source: Source = "reported_self",
) {
  for (const [field, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) continue;
    await sql`
      insert into capabilities (athlete_id, field, value, source)
      values (${athleteId}, ${field}, ${value}, ${source})
    `;
  }
}

export const capabilitiesFor = (athleteId: string) => sql<Capability[]>`
  select field, value, source, captured_at::text as captured_at
    from capabilities where athlete_id = ${athleteId}
   order by captured_at asc
`;

/**
 * Write a plan, retiring the one it replaces.
 *
 * The prior plan is kept and pointed at rather than deleted: a regeneration
 * that produces a worse plan has to be revertible, and "worse" is a judgement
 * only the athlete can make after seeing it.
 */
export async function persist(
  raceTargetId: string, params: Params, out: Generated, confidence: string,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into plans (
      race_target_id, generator_version, confidence, resolved_params, weeks, flags
    ) values (
      ${raceTargetId}, ${GENERATOR_VERSION}, ${confidence},
      ${sql.json(serialisable(params) as never)},
      ${sql.json(out.weeks as never)}, ${sql.json(out.flags as never)}
    ) returning id
  `;
  await sql`
    update plans set active = false, superseded_by = ${row.id}
     where race_target_id = ${raceTargetId} and id <> ${row.id} and active
  `;
  return row.id;
}

/** `week_start` is a function, and a function cannot be stored or replayed. */
function serialisable(p: Params) {
  const { week_start: _drop, ...rest } = p;
  return { ...rest, week_start_from: p.week_start(1) };
}

export const loadPlan = async (id: string): Promise<StoredPlan | null> => {
  const [row] = await sql<StoredPlan[]>`
    select id, race_target_id, generated_at::text as generated_at, generator_version,
           confidence, resolved_params, weeks, flags, active, superseded_by
      from plans where id = ${id}
  `;
  return row ?? null;
};

export const activePlan = async (raceTargetId: string): Promise<StoredPlan | null> => {
  const [row] = await sql<StoredPlan[]>`
    select id, race_target_id, generated_at::text as generated_at, generator_version,
           confidence, resolved_params, weeks, flags, active, superseded_by
      from plans where race_target_id = ${raceTargetId} and active
      order by generated_at desc limit 1
  `;
  return row ?? null;
};

// ------------------------------------------------------------- regeneration

export type Regeneration =
  { kind: "regenerated"; planId: string; weeks: Generated["weeks"]; flags: Generated["flags"] };

/**
 * Regenerate forward.
 *
 * Completed weeks are never rewritten — they are a record of what happened, and
 * a plan that edits its own past cannot be checked against reality. Everything
 * from the current week on is recalculated; the race date, the phase
 * boundaries, the locked commitments and the absences are carried through
 * unchanged because none of them are the generator's to change.
 */
export async function regenerate(
  athleteId: string, raceTargetId: string, params: Params, currentWeek: number,
): Promise<Regeneration> {
  const prior = await activePlan(raceTargetId);
  const fresh = generate(params);

  const kept = (prior?.weeks ?? []).filter((w) => w.n < currentWeek);
  const forward = fresh.weeks.filter((w) => w.n >= currentWeek);
  const weeks = [...kept, ...forward];

  const caps = await capabilitiesFor(athleteId);
  const planId = await persist(
    raceTargetId, params, { ...fresh, weeks }, confidenceFrom(caps),
  );
  return { kind: "regenerated", planId, weeks, flags: fresh.flags };
}

/** Everything we hold about an athlete, best source first. */
export async function resolvedFor(athleteId: string) {
  const caps = await capabilitiesFor(athleteId);
  return { capabilities: best(caps), confidence: confidenceFrom(caps) };
}
