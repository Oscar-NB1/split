import { sql } from "./db";
import { addDays, diffWeeks, mondayOf, today } from "./dates";
import { FATIGUE_REASONS } from "./plan";
import { shiftPaces } from "./prescription";
import { resizeStrength } from "./plan/strength";

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
  /**
   * What the session is for, as the headline above the prescription.
   *
   * `title` stays the prescription because it is parsed — the pace target is read out of
   * it — so this is a second name rather than a rename.
   */
  purpose?: string;
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

/*
 * Defaults for a template that carries no rules of its own — which now means every
 * template, because this generator writes all fifteen weeks explicitly.
 *
 * `deload_every: 0`, deliberately. It was 4, and it was second-guessing a generator
 * that already decides which weeks are down weeks and sizes them accordingly. The two
 * cycles did not even align, and the visible result was a session that disagreed with
 * itself: week 4's long run said "17.3 km @ 4:58/km" — 86 minutes of running — with
 * "60 min" printed beside it, because the factor scaled the minutes and left the
 * prescription alone.
 *
 * A plan that writes its own deloads does not want a second opinion applied on a
 * four-week timer. Any template that genuinely wants one can still set it.
 */
const DEFAULTS: Required<Rules> = {
  long_run_delta_min: 5,
  long_run_max_min: 150,
  deload_every: 0,
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
  /*
   * A written prescription keeps its own duration.
   *
   * Scaling the minutes of a session whose target says "17.1 km @ 5:23/km" produces a
   * card that contradicts itself, and the athlete believes the prescription — so the
   * number beside it is simply wrong. Where a session has a target, its duration is
   * whatever that target costs; where it has none (a class, a commitment), the factor
   * is the only lever there is and it still applies.
   *
   * The adaptation itself is not lost: the day's note says the week has been cut, and
   * the athlete decides what to drop.
   */
  if (d.target && factor !== 1) return Math.max(10, Math.round(minutes));
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
    weeks: TemplateDay[][]; rules: Rules; horizon: number; pace_shift_s: number;
    strength_accessories_delta: number;
  }[]>`
    select id, athlete_id, author_id, start_date::text as start_date,
           weeks, rules, horizon, pace_shift_s, strength_accessories_delta
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

  /*
   * Clear the future first, then write it.
   *
   * Matching the rows that should still exist against the rows that do turned out
   * to be unreliable — a session whose slot or kind moved kept its old row and got
   * a new one beside it, so a day showed the same session twice, once with paces
   * and once without. Deleting what has not been touched and writing it again is
   * deterministic, and the guards are the same ones the rebuild uses: anything
   * logged, moved, commented on or with sets against it is a record of what
   * happened and survives.
   */
  /*
   * Not scoped to this template's id.
   *
   * A rebuild that produced a new template left the previous one's sessions behind —
   * they no longer matched the id being written, so the day showed the same session
   * twice, once with paces and once without. An athlete has one active plan; a
   * future session written by a template that is no longer active is stale whatever
   * wrote it.
   */
  await sql`
    delete from planned_sessions
     where user_id = ${tpl.athlete_id} and source = 'template'
       and planned_date > ${now}
       and status = 'planned' and activity_id is null
       and not exists (select 1 from session_comments c where c.session_id = planned_sessions.id)
       and not exists (
             select 1 from session_sets st
              where st.session_id = planned_sessions.id
                -- A prescribed set is not a record of anything.
                --
                -- Loads are pre-filled, so opening a strength session creates a row
                -- per set with the prescribed load and reps already in it. Treating
                -- the row's existence as evidence the athlete trained meant every
                -- strength session they had ever looked at became permanent: a
                -- rebuild could not replace it, and the day showed the session twice,
                -- once from the old template and once from the new. What makes a set
                -- theirs is ticking it off, or entering something other than what was
                -- asked for.
                --
                -- The load cannot be the test. It is seeded from the last time the
                -- athlete lifted that movement, so a pre-filled 60 kg against a
                -- prescribed NULL looks like input and protected the row anyway.
                -- Reps are seeded from the prescription, so a differing rep count is
                -- genuinely theirs — and ticking a set off is the act of logging one.
                and (st.done
                     or st.note is not null
                     or st.reps is distinct from st.prescribed_reps)
           )
  `;

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
      /*
       * The calibration shift, applied where the athlete accepted one.
       *
       * The template holds the paces the plan was built with; the shift is what the
       * athlete's own key sessions have since said about them. Applied here rather
       * than baked into the template so the original prescription is never lost and
       * a shift can be reversed by setting it back to zero.
       */
      /*
       * And the strength session's length, where the athlete has said something
       * about it.
       *
       * Trimmed or extended here for the same reason the paces are shifted here:
       * the template holds what the plan prescribed, and this holds what the
       * athlete has since told it. Both are reversible by setting the number back
       * to zero.
       */
      const target = d.kind === "strength"
        ? resizeStrength(d.target, tpl.strength_accessories_delta)
        : shiftPaces(d.target, tpl.pace_shift_s) || null;

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

      const rows = await sql<{ id: string }[]>`
        insert into planned_sessions
          (user_id, author_id, planned_date, title, kind, planned_minutes, target,
           coach_note, significance, slot, purpose, source, source_ref)
        select ${tpl.athlete_id}, ${tpl.author_id}, ${date}, ${d.title}, ${d.kind},
               ${minutes}, ${target}, ${note}, ${d.significance ?? null},
               ${d.slot ?? null}, ${d.purpose ?? null}, 'template', ${ref}
        where not exists (
          select 1 from planned_sessions
          where user_id = ${tpl.athlete_id} and source = 'template' and source_ref = ${ref}
        )
        returning id
      `;
      created += rows.length;

      /*
       * This week's untouched sessions are refreshed in place: the delete above only
       * clears the future, because a session dated today may already have been
       * started.
       */
      if (rows.length === 0 && date >= now) {
        await sql`
          update planned_sessions set
            title = ${d.title}, kind = ${d.kind}, planned_minutes = ${minutes},
            purpose = ${d.purpose ?? null},
            target = ${target}, coach_note = ${note},
            significance = ${d.significance ?? null}
          where user_id = ${tpl.athlete_id} and source = 'template'
            and source_ref = ${ref}
            and status = 'planned' and activity_id is null
            and not exists (select 1 from session_comments c where c.session_id = planned_sessions.id)
            and not exists (
             select 1 from session_sets st
              where st.session_id = planned_sessions.id
                -- A prescribed set is not a record of anything.
                --
                -- Loads are pre-filled, so opening a strength session creates a row
                -- per set with the prescribed load and reps already in it. Treating
                -- the row's existence as evidence the athlete trained meant every
                -- strength session they had ever looked at became permanent: a
                -- rebuild could not replace it, and the day showed the session twice,
                -- once from the old template and once from the new. What makes a set
                -- theirs is ticking it off, or entering something other than what was
                -- asked for.
                and (st.done
                     or st.note is not null
                     or st.reps is distinct from st.prescribed_reps)
           )
        `;
      }
    }
  }

  created += await materialiseRaces(tpl, planStart, rules, now);
  return { created };
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
           coach_note, significance, slot, purpose, source, source_ref)
        select ${tpl.athlete_id}, ${tpl.author_id}, ${date}, ${d.title}, ${d.kind},
               ${minutesFor(d, planWeek, 1, rules)}, ${d.target ?? null},
               ${d.coach_note ?? null}, ${d.significance}, ${d.slot ?? null},
               ${d.purpose ?? null}, 'template', ${ref}
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
