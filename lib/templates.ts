import { sql } from "./db";
import { addDays, diffWeeks, mondayOf, today } from "./dates";
import { FATIGUE_REASONS } from "./plan";

/**
 * Template engine.
 *
 * A plan is a week shape plus progression rules, not 12 weeks of fixed rows.
 * Only the next `horizon` weeks are materialised. Everything further out
 * stays derived, so changing a rule re-renders the future without rewriting
 * history. Past weeks are frozen the moment they pass.
 */
export type TemplateDay = {
  day: number;          // 0 = Monday
  kind: string;
  title: string;
  minutes: number;
  target?: string;
};

export type Rules = {
  /** minutes added to the long run each week of the plan */
  long_run_delta_min?: number;
  /** ceiling on the long run, so progression can't run away forever */
  long_run_max_min?: number;
  /** every Nth week is a deload */
  deload_every?: number;
  /** deload multiplier applied to every session that week */
  deload_factor?: number;
  /** this many fatigue-flavoured skips in a week triggers a deload next week */
  fatigue_skips_to_deload?: number;
  /** volume cut applied when that trigger fires */
  fatigue_cut?: number;
};

const DEFAULTS: Required<Rules> = {
  long_run_delta_min: 5,
  long_run_max_min: 150,
  deload_every: 4,
  deload_factor: 0.7,
  fatigue_skips_to_deload: 2,
  fatigue_cut: 0.85,
};

/** Fatigue signal: skips last week tagged tired/sore/sick. */
async function fatigueSkips(athleteId: string, weekStart: string) {
  const prev = addDays(weekStart, -7);
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from planned_sessions
    where user_id = ${athleteId}
      and status = 'skipped'
      and skip_reason = any(${FATIGUE_REASONS as unknown as string[]})
      and planned_date >= ${prev} and planned_date < ${weekStart}
  `;
  return rows[0]?.n ?? 0;
}

/**
 * How long a session is in a given plan week, after progression and any cut.
 * Exported so the rules can be tested without a database.
 *
 * Order matters: progression is applied to the long run first, then the deload
 * or fatigue factor scales whatever that week's real volume is. Doing it the
 * other way round (as this did) made a week-10 deload shorter than week 1,
 * because the accumulated progression was dropped rather than reduced.
 */
export function minutesFor(
  d: TemplateDay,
  planWeek: number,
  factor: number,
  rules: Required<Rules>,
): number {
  let minutes = d.minutes;
  if (d.kind === "run_long" && rules.long_run_delta_min) {
    minutes = Math.min(
      rules.long_run_max_min,
      minutes + rules.long_run_delta_min * planWeek,
    );
  }
  return Math.max(10, Math.round(minutes * factor));
}

/** Is this plan week a scheduled deload? Week numbers are 0-based. */
export function isDeloadWeek(planWeek: number, every: number): boolean {
  return every > 0 && (planWeek + 1) % every === 0;
}

/**
 * Writes the next `horizon` weeks for an active template.
 * Idempotent: only inserts where nothing template-generated exists yet for
 * that date and slot, so re-running never duplicates or overwrites a session
 * the athlete has already moved, scaled or completed.
 */
export async function materialise(templateId: string) {
  const [tpl] = await sql<{
    id: string; athlete_id: string; author_id: string; start_date: string;
    weeks: TemplateDay[][]; rules: Rules; horizon: number;
  }[]>`
    select id, athlete_id, author_id, start_date::text as start_date,
           weeks, rules, horizon
    from plan_templates where id = ${templateId} and active
  `;
  if (!tpl) return { created: 0 };
  if (!Array.isArray(tpl.weeks) || tpl.weeks.length === 0) return { created: 0 };

  const rules = { ...DEFAULTS, ...(tpl.rules ?? {}) };
  const planStart = mondayOf(tpl.start_date);
  const thisMonday = mondayOf();
  const now = today();
  let created = 0;

  for (let w = 0; w < tpl.horizon; w++) {
    const weekStart = addDays(thisMonday, w * 7);

    // which week of the plan is this? counted in days, so a DST weekend
    // can't round 4 weeks down to 3
    const planWeek = diffWeeks(weekStart, planStart);
    if (planWeek < 0) continue;

    const shape = tpl.weeks[planWeek % tpl.weeks.length];
    if (!shape) continue;

    // ---- adaptation ----
    let factor = 1;
    const isDeload = isDeloadWeek(planWeek, rules.deload_every);
    if (isDeload) factor *= rules.deload_factor;

    const skips = await fatigueSkips(tpl.athlete_id, weekStart);
    const fatigued = skips >= rules.fatigue_skips_to_deload;
    if (fatigued) factor *= rules.fatigue_cut;

    for (const d of shape) {
      const date = addDays(weekStart, d.day);
      if (date < now) continue; // never write the past

      const minutes = minutesFor(d, planWeek, factor, rules);

      // Keyed on the date, not the plan week. The week number is derived, so
      // any change to how it's counted (this commit changed exactly that)
      // renumbers every ref and re-inserts a duplicate of every future session.
      // The date is the session's real identity, and it survives the athlete
      // moving the session: the ref stays the slot it was written for.
      const ref = `${tpl.id}:${date}:${d.kind}`;
      const note =
        fatigued && !isDeload
          ? `Volume cut ${Math.round((1 - rules.fatigue_cut) * 100)}% - ${skips} sessions skipped last week for fatigue.`
          : isDeload
            ? "Deload week."
            : null;

      const rows = await sql<{ id: string }[]>`
        insert into planned_sessions
          (user_id, author_id, planned_date, title, kind, planned_minutes, target, coach_note, source, source_ref)
        select ${tpl.athlete_id}, ${tpl.author_id}, ${date}, ${d.title}, ${d.kind},
               ${minutes}, ${d.target ?? null}, ${note}, 'template', ${ref}
        where not exists (
          select 1 from planned_sessions
          where user_id = ${tpl.athlete_id} and source = 'template' and source_ref = ${ref}
        )
        returning id
      `;
      created += rows.length;
    }
  }
  return { created };
}

export async function materialiseAll() {
  const tpls = await sql<{ id: string }[]>`select id from plan_templates where active`;
  let total = 0;
  for (const t of tpls) total += (await materialise(t.id)).created;
  return total;
}
