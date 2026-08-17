import { parseSteps } from "../prescription";

/**
 * Changing a session that was written by hand, in the only ways it is allowed to change.
 *
 * An imported plan is the record. It is not recomputed from anything, so every adaptation has
 * to be an edit to one session's prescription rather than a rebuild of the block — and the
 * list of permitted edits is short and deliberate:
 *
 *   the long run's distance          reduce or increase it
 *   the long run's pace target       add one or take it away
 *   a quality session's paces        move them up or down (./prescription shiftPaces)
 *   a strength lift's load           progressive overload (./progression nextLoad)
 *
 * Nothing else. Not which sessions there are, not which days they fall on, not what a quality
 * session's reps are, not how many kilometres the week holds. Those are the plan, and the plan
 * came from a coach rather than from arithmetic.
 *
 * Two of the four already existed as text edits, because they had to work on a materialised
 * session even when the block was generated: `shiftPaces` moves a prescription's paces by a
 * number of seconds, and `nextLoad` decides a lift's weight from what was logged against it.
 * This module is the other two.
 *
 * Everything here is a pure string transform, tested against real prescriptions, and every
 * function returns the input unchanged rather than a broken prescription when it cannot do
 * the job. A session it declines to edit is a session the athlete still has.
 */

/** A long run is not a long run below this, so a reduction stops here. */
export const LONG_RUN_FLOOR_KM = 5;

const num = (s: string) => Number(s.replace(/[^\d.]/g, ""));

/** `- 13.5km Z2 @ 5:14-5:33/km` → the parts, or null where the line is not a distance step. */
const RUN = /^(-\s*)(\d+(?:\.\d+)?)(km)(\s+Z([1-5]))(.*)$/;

/**
 * The long run at a different distance.
 *
 * Only the easy portions move. A 17 km run with a 2.6 km threshold block inside it, reduced
 * to 15, is a 15 km run with the same 2.6 km block — the work is what the session is for, and
 * shrinking it would change the session rather than its length. So the easy steps absorb the
 * whole change, proportionally, and the block is left exactly as the coach wrote it.
 *
 * Returns the input untouched where there is nothing to scale, where the request is already
 * satisfied, or where the work alone is longer than the target: a 4 km run made of a 6 km
 * tempo cannot be honoured, and quietly rewriting the tempo would be the one thing this must
 * not do.
 */
export function resizeLongRun(target: string | null | undefined, wantKm: number): string {
  const text = target ?? "";
  if (!text.trim() || !Number.isFinite(wantKm)) return text;
  const want = Math.max(LONG_RUN_FLOOR_KM, Math.round(wantKm * 10) / 10);

  const lines = text.split("\n");
  let easy = 0, work = 0;
  const easyAt: number[] = [];
  lines.forEach((line, i) => {
    const m = RUN.exec(line.trim());
    if (!m) return;
    const km = num(m[2]), zone = Number(m[5]);
    /* Z1 and Z2 are the run's easy body; Z3 and above is the work inside it. */
    if (zone <= 2) { easy += km; easyAt.push(i); } else work += km;
  });
  if (easyAt.length === 0) return text;

  const wantEasy = Math.round((want - work) * 10) / 10;
  /* The work alone is already longer than asked for: decline rather than cut into it. */
  if (wantEasy < 1) return text;
  if (Math.abs(wantEasy - easy) < 0.15) return text;

  const scale = wantEasy / easy;
  /*
   * Distributed across the easy steps and then corrected on the last one, so a three-step
   * long run still totals what was asked for after rounding. Rounding each step independently
   * loses up to a tenth per step, which on a blocks long run is where "15.0 km" becomes 14.8.
   */
  let spent = 0;
  easyAt.forEach((i, n) => {
    const m = RUN.exec(lines[i].trim())!;
    const was = num(m[2]);
    const km = n === easyAt.length - 1
      ? Math.round((wantEasy - spent) * 10) / 10
      : Math.round(was * scale * 10) / 10;
    spent += km;
    lines[i] = lines[i].replace(RUN, (_a, dash: string, _n: string, unit: string,
      z: string, rest: string) => `${dash}${km}${unit}${z}${rest}`);
  });
  return lines.join("\n");
}

/** What a long run's distance comes to, reading only its own steps. */
export function longRunKm(target: string | null | undefined): number {
  let km = 0;
  for (const line of (target ?? "").split("\n")) {
    const m = RUN.exec(line.trim());
    if (m) km += num(m[2]);
  }
  return Math.round(km * 10) / 10;
}

/**
 * Whether the long run carries a pace target, and putting one there or taking it away.
 *
 * "Paced" means the run has something to hold: a block at steady effort inside the easy
 * distance, which is where running under fatigue is actually trained. "Easy" means distance
 * and nothing else — no block, and no numbers beside the zone, because a pace printed next to
 * a run somebody has been told not to push is a target whether it was meant as one or not.
 *
 * The distance is preserved either way. Adding a block takes its kilometres out of the easy
 * body rather than lengthening the run, and removing one gives them back.
 */
export function longRunWork(
  target: string | null | undefined,
  mode: "easy" | "paced",
  steadyPaceS?: number,
): string {
  const text = target ?? "";
  if (!text.trim()) return text;
  const total = longRunKm(text);
  if (total <= 0) return text;

  if (mode === "easy") {
    /* Strip the work steps, then the paces, then put the distance back into the easy body. */
    const kept = text.split("\n").filter((line) => {
      const m = RUN.exec(line.trim());
      return !m || Number(m[5]) <= 2;
    });
    if (kept.length === 0) return text;
    const noPace = kept.map((line) => line.replace(/\s*@\s*[\d:]+(?:\s*[-–]\s*[\d:]+)?\s*\/?\s*km/g, ""));
    return resizeLongRun(noPace.join("\n"), total);
  }

  /* Already has work in it: leave the coach's own block alone. */
  if (text.split("\n").some((line) => {
    const m = RUN.exec(line.trim());
    return m && Number(m[5]) >= 3;
  })) return text;
  if (!steadyPaceS) return text;

  /*
   * A block of about a sixth of the run, capped at four kilometres, in the middle.
   *
   * The middle rather than the end: a fast finish is a different session, and it is one a
   * coach writes deliberately. A block with easy running either side is the neutral way to put
   * a target into a run that did not have one.
   */
  const block = Math.max(2, Math.min(4, Math.round(total / 6 * 10) / 10));
  if (total - block < 2) return text;
  const half = Math.round(((total - block) / 2) * 10) / 10;
  const easyLine = text.split("\n").find((line) => RUN.test(line.trim()))!;
  const shape = (km: number) => easyLine.replace(RUN, (_a, dash: string, _n: string,
    unit: string, z: string, rest: string) => `${dash}${km}${unit}${z}${rest}`);
  const pace = `@ ${Math.floor(steadyPaceS / 60)}:${String(steadyPaceS % 60).padStart(2, "0")}/km`;
  return [
    shape(half),
    `- ${Math.round((total - block - half) * 10) / 10 === 0 ? block : block}km Z3 ${pace}`,
    shape(Math.round((total - block - half) * 10) / 10),
  ].join("\n");
}

/** Whether a prescription has any pace target in it at all. */
export const hasPaceTarget = (target: string | null | undefined): boolean =>
  /\d{1,2}:[0-5]\d\s*(?:[-–]\s*\d{1,2}:[0-5]\d\s*)?\/?\s*km/.test(target ?? "");

/**
 * A last check before anything edited is written back.
 *
 * The app's own reader has to be able to read it. An edit that produces a prescription
 * `parseSteps` returns nothing for is a session screen with an empty body and a watch with
 * nothing to send — worse than the session as it was, so the caller keeps the original.
 */
export function readable(target: string): boolean {
  const groups = parseSteps(target);
  return groups.length > 0 && groups.some((g) => g.items.length > 0);
}
