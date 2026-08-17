import { sql } from "./db";
import { deltaFrom, type Feel } from "./strength-feel";
import { rememberDay } from "./replan";
import { MAX_STEPS, STEP } from "./plan/volume-dial";

/**
 * The weekly volume dial, moved by what the athlete says about their runs.
 *
 * "Too short" and "too long" were read only by the strength session, where they add or
 * remove an accessory movement. A runner who finds week 3 easy had no way to say so at
 * all: the volume dial is answered once at intake — Progressive or Aggressive — and never
 * revisited for the next fifteen weeks.
 *
 * So the same rule is pointed at the weekly curve. Two consecutive reports in the same
 * direction move the dial one step; one does not, because a single run that felt short is
 * a good day. Deliberately reusing `deltaFrom`: the argument for two-in-a-row and for
 * clamping is identical whether the thing being adjusted is a set of calf raises or a
 * fortnight of running, and two copies of that reasoning would drift apart.
 */

export { MAX_STEPS, STEP, dialFor } from "./plan/volume-dial";

/**
 * Recompute the dial from every run report, and rebuild if it moved.
 *
 * Runs only. A strength session's length is about how many movements are in it and is
 * already handled; mixing the two would let a long gym session shorten somebody's
 * Sunday.
 */
export async function applyRunFeel(userId: string): Promise<string | null> {
  const [tpl] = await sql<{ id: string; volume_feel_delta: number }[]>`
    select id, volume_feel_delta from plan_templates
     where athlete_id = ${userId} and active order by start_date desc limit 1
  `;
  if (!tpl) return null;

  const rows = await sql<{ length_feel: Feel }[]>`
    select f.length_feel
      from session_feedback f
      join planned_sessions p on p.id = f.session_id
     where p.user_id = ${userId} and f.length_feel is not null
       and p.kind in ('easy_run', 'long_run', 'quality_run', 'run_easy', 'run_long',
                      'run_intervals')
     order by p.planned_date
  `;
  const before = tpl.volume_feel_delta;
  const after = Math.max(-MAX_STEPS, Math.min(MAX_STEPS,
    deltaFrom(rows.map((r) => r.length_feel))));

  if (after === before) {
    return "Noted. One run is a good or a bad day; two in a row and the plan moves your weekly volume.";
  }
  await sql`update plan_templates set volume_feel_delta = ${after} where id = ${tpl.id}`;

  /*
   * Rebuilt through the same guarded path as a day preference.
   *
   * `rememberDay` regenerates from the stored answers and refuses to write a block
   * smaller than the live one, which is the guard that exists because a bad regeneration
   * once deleted a plan. A volume nudge is not worth risking that.
   */
  await rememberDay(userId);

  const pct = Math.round(Math.abs(after) * STEP * 100);
  if (after === 0) {
    return "Back to the volume your answers implied — the plan will stop adjusting from here.";
  }
  return after > before
    ? `Weekly volume up about ${pct}% from here. Tell me again in a fortnight and it goes up once more.`
    : `Weekly volume down about ${pct}% from here. Better a week you finish than one you abandon.`;
}
