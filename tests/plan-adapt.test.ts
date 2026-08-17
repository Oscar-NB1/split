import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LONG_RUN_FLOOR_KM, hasPaceTarget, longRunKm, longRunWork, readable, resizeLongRun,
} from "../lib/plan/adapt";
import { shiftPaces } from "../lib/prescription";

/**
 * The four things an imported plan is allowed to change.
 *
 * These are real prescriptions, copied from his live block. The point of every test here is
 * the same: the edit does exactly the one thing asked and leaves the rest of the coach's
 * session alone — and where it cannot, it returns the session untouched rather than a broken
 * one.
 */

const STEADY = "- 13.5km Z2 @ 5:14-5:33/km";
const BLOCKS = [
  "- 7.3km Z2 @ 5:13-5:32/km",
  "- 2.6km Z3 @ 4:40/km",
  "- 7.3km Z2 @ 5:13-5:32/km",
].join("\n");
const QUALITY = [
  "- 2km Z2 warm up @ 5:26-5:52/km",
  "- 3x",
  "- 8m Z3 @ 4:26/km",
  "- 150s Z1 jog @ 5:56/km",
  "- 1.6km Z1 cool down @ 5:56/km",
].join("\n");

test("a long run resizes, and the totals are what was asked for", () => {
  assert.equal(longRunKm(STEADY), 13.5);
  assert.equal(longRunKm(resizeLongRun(STEADY, 16)), 16);
  assert.equal(longRunKm(resizeLongRun(STEADY, 10)), 10);
  assert.ok(readable(resizeLongRun(STEADY, 16)));
});

test("the work inside a long run is never touched by a resize", () => {
  /*
   * A 17.2 km run with a 2.6 km threshold block, reduced to 15, is a 15 km run with the same
   * 2.6 km block. The block is what the session is for; shrinking it would change the session
   * rather than its length.
   */
  const smaller = resizeLongRun(BLOCKS, 15);
  assert.equal(longRunKm(smaller), 15);
  assert.match(smaller, /^- 2\.6km Z3 @ 4:40\/km$/m, "the coach's block, unchanged");
  const bigger = resizeLongRun(BLOCKS, 20);
  assert.equal(longRunKm(bigger), 20);
  assert.match(bigger, /^- 2\.6km Z3 @ 4:40\/km$/m);
});

test("a long run is not reduced below what a long run is", () => {
  assert.equal(longRunKm(resizeLongRun(STEADY, 2)), LONG_RUN_FLOOR_KM);
});

test("a request the session cannot honour leaves it alone", () => {
  /* 6 km of tempo cannot fit inside a 4 km run, and cutting the tempo is not the answer. */
  const tempoHeavy = "- 1km Z2 @ 5:20/km\n- 6km Z3 @ 4:40/km";
  assert.equal(resizeLongRun(tempoHeavy, 4), tempoHeavy);
  /* And nothing to scale means nothing to do. */
  assert.equal(resizeLongRun("- 25 reps Wall balls", 12), "- 25 reps Wall balls");
  assert.equal(resizeLongRun("", 12), "");
});

test("asking for the distance it already is changes nothing", () => {
  assert.equal(resizeLongRun(STEADY, 13.5), STEADY);
  assert.equal(resizeLongRun(BLOCKS, longRunKm(BLOCKS)), BLOCKS);
});

test("a pace target comes off a long run without shortening it", () => {
  const easy = longRunWork(BLOCKS, "easy");
  assert.equal(longRunKm(easy), longRunKm(BLOCKS), "the run is the same length");
  assert.doesNotMatch(easy, /Z3/, "and there is nothing left to hold");
  assert.equal(hasPaceTarget(easy), false,
    "a pace printed beside a run somebody was told not to push is a target anyway");
  assert.ok(readable(easy));
});

test("a pace target goes onto a long run without lengthening it", () => {
  const paced = longRunWork(STEADY, "paced", 280);
  assert.equal(longRunKm(paced), longRunKm(STEADY), "the run is the same length");
  assert.match(paced, /Z3 @ 4:40\/km/);
  /* Easy running either side: a fast finish is a different session, deliberately written. */
  const lines = paced.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Z2/);
  assert.match(lines[2], /Z2/);
  assert.ok(readable(paced));
});

test("a long run that already has the coach's own block keeps it", () => {
  assert.equal(longRunWork(BLOCKS, "paced", 280), BLOCKS,
    "the plan already says what to hold, and it was not this function's idea");
});

test("adding a target with no pace to add is declined", () => {
  assert.equal(longRunWork(STEADY, "paced"), STEADY);
});

test("quality paces move without touching the reps", () => {
  /* This one already existed; it is here because it is one of the four. */
  const quicker = shiftPaces(QUALITY, -6);
  assert.match(quicker, /- 8m Z3 @ 4:20\/km/);
  assert.match(quicker, /^- 3x$/m, "three reps before and three after");
  assert.match(quicker, /- 2km Z2 warm up @ 5:20-5:46\/km/);
  assert.ok(readable(quicker));
});

test("every edit leaves something the app can still read", () => {
  for (const t of [STEADY, BLOCKS, QUALITY]) {
    for (const out of [
      resizeLongRun(t, 12), resizeLongRun(t, 20),
      longRunWork(t, "easy"), longRunWork(t, "paced", 275), shiftPaces(t, 8),
    ]) {
      assert.ok(readable(out), `unreadable after an edit:\n${out}`);
    }
  }
});
