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
  /** Why this session exists, in the plan's own words. Shown, never parsed. */
  coach_note?: string;
  /** null | key | benchmark | race — what makes the day worth arriving fresh for. */
  significance?: string;
  /** AM | PM, for the days that carry two sessions. */
  slot?: string;
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
  /*
   * Weeks run from the plan's own start day, not from a Monday.
   *
   * This used to snap both ends with mondayOf(), which quietly moved a plan that
   * began on a Wednesday back to the Monday before it — and then placed every
   * session by an offset from that Monday, so a "day 0" session landed two days
   * before the athlete had started. Weeks are seven days from wherever the block
   * begins.
   */
  const planStart = tpl.start_date;
  // Weeks run Monday to Sunday; the day indices in the shape are 0 = Monday. An
  // athlete who starts on a Wednesday gets a short first week, not a week whose
  // "Monday" session falls on a Wednesday.
  const anchor = mondayOf(planStart);
  const now = today();
  // How many whole weeks of the block are already behind us: materialising starts
  // from the current week rather than from week 1 of a plan begun in the past.
  const elapsedWeeks = Math.max(0, diffWeeks(mondayOf(now), anchor));
  let created = 0;
  /** Every ref this template should own from today on, for the sweep below. */
  const expected = new Set<string>();

  /*
   * Every remaining week of the block, not the next three.
   *
   * The rolling horizon meant an athlete with a fifteen-week plan could see weeks
   * 1–3 and nothing else — which reads as "no plan" rather than as "not written
   * yet". Writing all of it is only safe because the loop below refreshes the
   * future weeks it has already written, so a plan stays adaptive instead of being
   * frozen at the moment it was created.
   */
  const remaining = Math.max(0, tpl.weeks.length - elapsedWeeks);
  for (let w = 0; w < remaining; w++) {
    const weekStart = addDays(anchor, elapsedWeeks * 7 + w * 7);

    // which week of the plan is this? counted in days, so a DST weekend
    // can't round 4 weeks down to 3
    const planWeek = diffWeeks(weekStart, anchor);
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
      // Week 1 is short when the block begins mid-week: the days before the
      // athlete started are not sessions they skipped.
      if (date < planStart) continue;
      if (date < now) continue; // never write the past

      const minutes = minutesFor(d, planWeek, factor, rules);

      // Keyed on the date, not the plan week. The week number is derived, so
      // any change to how it's counted (this commit changed exactly that)
      // renumbers every ref and re-inserts a duplicate of every future session.
      // The date is the session's real identity, and it survives the athlete
      // moving the session: the ref stays the slot it was written for.
      // slot is part of the identity: Monday carries strength AM and kickboxing
      // PM, and Thursday an easy run AM and kickboxing PM. Keying on kind alone
      // silently drops the second session of any day that repeats a kind.
      const ref = `${tpl.id}:${date}:${d.kind}:${d.slot ?? "AM"}`;
      // The adaptation note is appended to the plan's own note, never
      // substituted for it: the day's note carries the pace guardrail, and
      // losing it on a deload week loses it exactly when it matters least to
      // lose and most to read.
      const adaptation =
        fatigued && !isDeload
          ? `Volume cut ${Math.round((1 - rules.fatigue_cut) * 100)}% — ${skips} sessions skipped last week for fatigue.`
          : isDeload
            ? "Deload week."
            : null;
      const note = [d.coach_note, adaptation].filter(Boolean).join("\n\n") || null;

      expected.add(ref);
      const rows = await sql<{ id: string }[]>`
        insert into planned_sessions
          (user_id, author_id, planned_date, title, kind, planned_minutes, target,
           coach_note, significance, slot, source, source_ref)
        select ${tpl.athlete_id}, ${tpl.author_id}, ${date}, ${d.title}, ${d.kind},
               ${minutes}, ${d.target ?? null}, ${note}, ${d.significance ?? null},
               ${d.slot ?? null}, 'template', ${ref}
        where not exists (
          select 1 from planned_sessions
          where user_id = ${tpl.athlete_id} and source = 'template' and source_ref = ${ref}
        )
        returning id
      `;
      created += rows.length;

      /*
       * A future week already written is brought up to date rather than left as it
       * was. This is what makes writing the whole block safe: the deload and
       * fatigue factors are re-applied every time the plan is materialised, so week
       * twelve reflects this week's news instead of the day it was created.
       *
       * Only sessions nobody has touched: anything logged, moved, commented on or
       * with sets against it is a record of what happened.
       */
      if (rows.length === 0 && date > now) {
        await sql`
          update planned_sessions set
            title = ${d.title}, kind = ${d.kind}, planned_minutes = ${minutes},
            target = ${d.target ?? null}, coach_note = ${note},
            significance = ${d.significance ?? null}
          where user_id = ${tpl.athlete_id} and source = 'template'
            and source_ref = ${ref}
            and status = 'planned' and activity_id is null
            and not exists (select 1 from session_comments c where c.session_id = planned_sessions.id)
            and not exists (select 1 from session_sets st where st.session_id = planned_sessions.id)
        `;
      }
    }
  }

  /*
   * Sessions this template no longer writes.
   *
   * The ref carries the date, so a session the generator moved to another day
   * leaves its old row behind — two sessions where the plan has one. Untouched
   * future rows that are no longer expected go; anything logged, moved or written
   * on stays, because it is a record of what happened rather than a plan.
   */
  const refs = [...expected];
  const stale = await sql<{ id: string }[]>`
    delete from planned_sessions
     where user_id = ${tpl.athlete_id} and source = 'template'
       and source_ref like ${tpl.id + "%"}
       and planned_date > ${now}
       and status = 'planned' and activity_id is null
       and not (source_ref = any(${refs}))
       and not exists (select 1 from session_comments c where c.session_id = planned_sessions.id)
       and not exists (select 1 from session_sets st where st.session_id = planned_sessions.id)
     returning id
  `;

  created += await materialiseRaces(tpl, planStart, rules, now);
  return { created, removed: stale.length };
}

/**
 * Races, written for the whole plan rather than the horizon.
 *
 * The rolling horizon is right for training: a Tuesday interval session eight
 * weeks out is a derived intention, and materialising it early only freezes a
 * guess. A race is the opposite — a fixed, paid-for, travelled-to date that the
 * whole block is aimed at, and it belongs on the calendar from day one.
 *
 * It is also what the countdown depends on. `raceCountdown` reads race rows and
 * announces at 28, 14, 7 and 1 days out; with a three-week horizon the row did
 * not exist until roughly 21 days before, so the four-weeks-out notification
 * could never have fired — and nothing would have reported that it hadn't.
 *
 * No adaptation factor is applied. A deload cannot shorten a race.
 */
async function materialiseRaces(
  tpl: { id: string; athlete_id: string; author_id: string; weeks: TemplateDay[][] },
  planStart: string,
  rules: Required<Rules>,
  now: string,
) {
  let created = 0;
  for (let planWeek = 0; planWeek < tpl.weeks.length; planWeek++) {
    for (const d of tpl.weeks[planWeek]) {
      if (d.significance !== "race") continue;
      // Same Monday anchor as the training weeks, so a race sits on the day the
      // plan placed it rather than on that day plus however far into the week the
      // athlete happened to start.
      const date = addDays(addDays(mondayOf(planStart), planWeek * 7), d.day);
      if (date < now) continue;
      const ref = `${tpl.id}:${date}:${d.kind}:${d.slot ?? "AM"}`;
      const rows = await sql<{ id: string }[]>`
        insert into planned_sessions
          (user_id, author_id, planned_date, title, kind, planned_minutes, target,
           coach_note, significance, slot, source, source_ref)
        select ${tpl.athlete_id}, ${tpl.author_id}, ${date}, ${d.title}, ${d.kind},
               ${minutesFor(d, planWeek, 1, rules)}, ${d.target ?? null},
               ${d.coach_note ?? null}, ${d.significance}, ${d.slot ?? null},
               'template', ${ref}
        where not exists (
          select 1 from planned_sessions
          where user_id = ${tpl.athlete_id} and source = 'template' and source_ref = ${ref}
        )
        returning id
      `;
      created += rows.length;
    }
  }
  return created;
}

export async function materialiseAll() {
  const tpls = await sql<{ id: string }[]>`select id from plan_templates where active`;
  let total = 0;
  for (const t of tpls) total += (await materialise(t.id)).created;
  return total;
}
