import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { materialise } from "@/lib/templates";
import { signalsFor } from "@/lib/calibration";
import { read, secs, MIN_STREAK, cleanSweep } from "@/lib/signals";

/**
 * Whether the plan's pace targets should move, and the athlete's answer.
 *
 * The engine has always been able to work this out — three key sessions on the same
 * side of a two-second band, capped at six seconds — and nothing consumed it. The
 * recommendation sat on a screen an athlete would only open if they already suspected
 * something.
 *
 * It is never applied automatically. A plan that quietly changes what it asks of you
 * is worse than a plan that is a few seconds wrong: the athlete stops being able to
 * tell whether they are improving or the target moved.
 */

export const GET = route(async () => {
  const me = await requireUser();
  const { signals, block } = await signalsFor(me.id);
  if (!block) return NextResponse.json({ pending: false });

  const v = read(signals, block.goal_seconds ?? 0);
  /*
   * Which rule justified the recommendation.
   *
   * A streak of three and a single session where every rep beat target are both
   * grounds to move, and the athlete should be told which one happened — the streak
   * message sent for a one-session verdict has them hunting for two sessions that do
   * not exist.
   */
  const last = v.points[v.points.length - 1];
  const swept = Boolean(last) && v.streak < MIN_STREAK && cleanSweep(last);

  const applied = block.pace_shift_s ?? 0;
  const declined = block.pace_shift_declined_s ?? null;

  /*
   * Only a shift the athlete has not already answered.
   *
   * `applied` is what their targets already carry, so a recommendation of the same
   * size is the engine agreeing with itself. `declined` is a no, and asking again
   * about the same number every time they open the app is nagging rather than
   * coaching.
   */
  const pending = v.shift !== 0 && v.shift !== applied && v.shift !== declined;

  return NextResponse.json({
    pending,
    shift: v.shift,
    applied,
    state: v.state,
    streak: v.streak,
    confidence: v.confidence,
    sessions: v.points.length,
    /*
     * What the card says, in one line — and it says which evidence fired.
     *
     * "Your last 3 key sessions" and "every rep of Tuesday's session" are different
     * claims about an athlete, and being told the wrong one is worse than being told
     * nothing: they go looking for the three sessions and find one.
     */
    headline: v.shift === 0 ? null
      : swept
        ? `Every rep of ${last?.label ?? "your last session"} came in ahead of target. That is a prescription you have outgrown — the plan can move ${secs(v.shift)}.`
        : v.shift < 0
          ? `Your last ${v.streak} key sessions came in ahead of prescription. The plan can move ${secs(v.shift)}.`
          : `Your last ${v.streak} key sessions came in behind prescription. The plan can ease ${secs(v.shift)}.`,
    /** which rule fired, so the Form screen can show the right sessions */
    basis: v.shift === 0 ? null : swept ? "single_session" : "streak",
  });
});

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json();
  const action = String(body?.action ?? "");
  if (action !== "accept" && action !== "decline") {
    throw badRequest("action must be accept or decline.");
  }

  const { signals, block } = await signalsFor(me.id);
  if (!block) throw badRequest("There is no plan to change.");
  const v = read(signals, block.goal_seconds ?? 0);
  if (v.shift === 0) throw badRequest("There is nothing to apply.");

  if (action === "decline") {
    await sql`
      update plan_templates set pace_shift_declined_s = ${v.shift}
       where id = ${block.id}
    `;
    return NextResponse.json({ ok: true, applied: block.pace_shift_s ?? 0 });
  }

  /*
   * Accepted: stored on the plan and written into every future session.
   *
   * Cumulative, because the engine's shift is measured against what the athlete was
   * asked to run — which already includes any shift they accepted before it.
   */
  const next = (block.pace_shift_s ?? 0) + v.shift;
  await sql`
    update plan_templates
       set pace_shift_s = ${next}, pace_shift_declined_s = null, pace_shift_at = now()
     where id = ${block.id}
  `;
  const { created } = await materialise(block.id);

  return NextResponse.json({ ok: true, applied: next, sessions_rewritten: created });
});
