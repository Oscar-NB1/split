import { sql } from "./db";
import { deltaFrom, type Feel } from "./strength-feel";
import { rememberDay } from "./replan";
import { MAX_STEPS, STEP } from "./plan/volume-dial";
import { longRunKm, readable, resizeLongRun } from "./plan/adapt";

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
   * A generated block is rebuilt; an authored one has its long runs resized in place.
   *
   * `rememberDay` regenerates from the stored answers and returns having done nothing when
   * the plan was imported — the weeks are the record there, and there is no form to recompute
   * them from. But the athlete still said their runs are too short, and a nudge that silently
   * does nothing is worse than no dial.
   *
   * So on an imported plan the change lands where the athlete's own spec allows it to land:
   * the long run, and only the long run. It is the session with room to give or take a couple
   * of kilometres without becoming a different session, and its distance is the one length in
   * the week that is genuinely a dial rather than a prescription.
   */
  const rebuilt = await rememberDay(userId);
  if (rebuilt === 0) await resizeLongRuns(userId, after - before);

  const pct = Math.round(Math.abs(after) * STEP * 100);
  if (after === 0) {
    return "Back to the volume your answers implied — the plan will stop adjusting from here.";
  }
  return after > before
    ? `Weekly volume up about ${pct}% from here. Tell me again in a fortnight and it goes up once more.`
    : `Weekly volume down about ${pct}% from here. Better a week you finish than one you abandon.`;
}

/**
 * Every future long run, one step longer or shorter.
 *
 * Future only, and never a session already logged against — the same boundary every other
 * write in this app respects. The work inside a long run is untouched: `resizeLongRun` scales
 * the easy body and leaves a coach's tempo block exactly as written.
 *
 * A session whose prescription would come back unreadable, or which cannot honour the request,
 * keeps the one it has. A dial that damages a session to obey itself is not a dial.
 */
async function resizeLongRuns(userId: string, steps: number): Promise<number> {
  if (!steps) return 0;
  const rows = await sql<{ id: string; target: string | null }[]>`
    select id, target from planned_sessions
     where user_id = ${userId} and kind = 'long_run'
       and planned_date >= current_date
       and status = 'planned' and activity_id is null
     order by planned_date
  `;
  let moved = 0;
  for (const r of rows) {
    const was = longRunKm(r.target);
    if (was <= 0) continue;
    const next = resizeLongRun(r.target, was * (1 + steps * STEP));
    if (next === r.target || !readable(next)) continue;
    await sql`
      update planned_sessions set target = ${next}, updated_at = now() where id = ${r.id}
    `;
    moved += 1;
  }
  return moved;
}
