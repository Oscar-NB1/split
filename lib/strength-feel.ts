/**
 * What "too short" and "too long" do to the next strength session.
 *
 * Both were being stored on `session_feedback` and read by nobody. An athlete could
 * report the same session too long for six weeks and be handed it again every week —
 * which teaches them the question is decoration, and once they believe that they
 * stop answering it, and the app loses the only signal it has about a session a
 * watch cannot measure.
 *
 * Only the accessories move. The four heavy compounds are the session; trimming one
 * of those to save eight minutes removes the reason the athlete went to the gym.
 */

/** How the athlete described the length of a session. */
export type Feel = "short" | "right" | "long";

/** Never more than two either way: past that it is a different session. */
export const MAX_DELTA = 2;

/**
 * The new accessory delta, from the reports in order.
 *
 * Two consecutive reports in the same direction move it by one. One does not: a
 * single session that ran long is a bad Tuesday — traffic, a late start, a phone
 * call — and a plan that re-writes itself off one data point is a plan that never
 * settles. "About right" clears the run, because it is the athlete saying the
 * current length is the correct one.
 */
export function deltaFrom(reports: Feel[], current = 0): number {
  let delta = current;
  let run = 0;
  let side: Feel | null = null;

  for (const r of reports) {
    if (r === "right") { run = 0; side = null; continue; }
    if (r === side) run += 1;
    else { side = r; run = 1; }

    if (run >= 2) {
      delta += r === "short" ? 1 : -1;
      // the run resets after it has been acted on, so three "too long" reports
      // move the dial once, not twice
      run = 0; side = null;
    }
  }
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta));
}

/**
 * What to tell the athlete, so the answer visibly did something.
 *
 * The point of saying it out loud is that a question with no visible consequence
 * stops being answered. This is the sentence the session screen shows once the
 * report has been recorded.
 */
export function sayDelta(before: number, after: number): string | null {
  if (after === before) {
    return "Noted. One report is a bad day; two in a row and the plan changes the session.";
  }
  const added = after > before;
  if (Math.abs(after) === MAX_DELTA) {
    return added
      ? "Two extra movements added to your strength sessions from here — that is as long as they get. The four heavy lifts stay as they are."
      : "Your strength sessions are down to the four heavy lifts and nothing else. That is as short as they go, because those four are the session.";
  }
  return added
    ? "A movement added to your next strength session. Tell me again and it grows once more."
    : "A movement dropped from your next strength session. The four heavy lifts are untouched — they are what the session is for.";
}
