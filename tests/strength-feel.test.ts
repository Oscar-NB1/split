import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DELTA, deltaFrom, sayDelta } from "../lib/strength-feel";
import { liftsFor, resizeStrength, strengthTarget } from "../lib/plan/strength";
import { warmupFor } from "../lib/warmup";
import { parseStrength } from "../lib/prescription";

const KIT = { barbell: true, kettlebells: true, rig: true, sled: true };

test("one report is a bad day; two in a row change the session", () => {
  /*
   * A plan that re-writes itself off one answer never settles: a session that ran
   * long once ran long because of traffic, a late start, or a phone call.
   */
  assert.equal(deltaFrom(["long"]), 0, "one report moves nothing");
  assert.equal(deltaFrom(["long", "long"]), -1, "two agree, so it shortens");
  assert.equal(deltaFrom(["short", "short"]), 1, "and the other way");
  assert.equal(deltaFrom(["long", "short"]), 0, "one each way is not a signal");
});

test("'about right' clears the run rather than counting for either side", () => {
  // It is the athlete saying the current length is correct, which is the one answer
  // that should stop the dial moving.
  assert.equal(deltaFrom(["long", "right", "long"]), 0);
  assert.equal(deltaFrom(["long", "long", "right"]), -1, "what it already earned stands");
});

test("three reports move it once, not twice", () => {
  // The run resets after being acted on, so an athlete answering honestly every week
  // does not walk the session off a cliff.
  assert.equal(deltaFrom(["long", "long", "long"]), -1);
  assert.equal(deltaFrom(["long", "long", "long", "long"]), -2);
});

test("it is clamped, because past two it is a different session", () => {
  assert.equal(deltaFrom(Array(20).fill("long")), -MAX_DELTA);
  assert.equal(deltaFrom(Array(20).fill("short")), MAX_DELTA);
});

test("the four heavy compounds survive every amount of shortening", () => {
  /*
   * This is the whole rule. An athlete who says the session ran long should lose the
   * calf raise, not the squat — taking a compound away to save eight minutes removes
   * the reason they went to the gym.
   */
  for (const delta of [0, -1, -2, -5]) {
    const lifts = liftsFor("build", 3, KIT, delta);
    assert.ok(lifts.length >= 4, `${lifts.length} lifts at delta ${delta}`);
    const heavy = lifts.slice(0, 4).map((l) => l.name);
    assert.deepEqual(heavy, liftsFor("build", 3, KIT, 0).slice(0, 4).map((l) => l.name),
      "the first four never change");
  }
});

test("saying it is too short adds work, and it is real work", () => {
  const normal = liftsFor("build", 3, KIT, 0);
  const longer = liftsFor("build", 3, KIT, 2);
  assert.ok(longer.length > normal.length, `${normal.length} → ${longer.length}`);
  for (const l of longer.slice(normal.length)) {
    assert.ok(l.sets > 0 && l.reps > 0 && l.rest > 0, `${l.name} is prescribed properly`);
  }
});

test("resizing the written session is idempotent", () => {
  /*
   * Materialisation writes the same block repeatedly. A session that grew a calf
   * raise every time it was written would have nine of them by November.
   */
  const target = strengthTarget("build", 3, KIT);
  const once = resizeStrength(target, 2)!;
  const twice = resizeStrength(once, 2)!;
  assert.equal(once, twice);

  const short = resizeStrength(target, -2)!;
  assert.ok(parseStrength(short).length >= 4, "and it never cuts into the compounds");
  assert.equal(resizeStrength(short, -2), short);
});

test("what the athlete is told changes with what actually happened", () => {
  assert.match(sayDelta(0, 0)!, /two in a row/i, "one report says why nothing moved");
  assert.match(sayDelta(0, -1)!, /dropped/i);
  assert.match(sayDelta(0, 1)!, /added/i);
  assert.match(sayDelta(-1, -2)!, /as short as they go/i, "the floor says it is the floor");
});

// --- the warm-up ---------------------------------------------------------------

test("a warm-up is for the session it sits under", () => {
  /*
   * There was one warm-up in the app and it was a runner's: eight minutes of easy
   * jogging, leg swings, A-skips, strides — prescribed before a back squat, where it
   * is eight minutes of the wrong thing followed by two drills that prepare a stride
   * length nobody is about to use.
   */
  const gym = warmupFor("strength");
  const text = gym.steps.map((s) => `${s.name} ${s.cue}`).join(" ");
  assert.doesNotMatch(text, /jog|stride|A-skip/i, "no running before a squat");
  assert.match(text, /squat|ankle|hip|bar/i, "joints through range, then the bar");

  const intervals = warmupFor("quality_run");
  assert.match(intervals.steps.map((s) => s.name).join(" "), /Strides/,
    "rehearse the pace, so rep one is not the fastest rep");
});

test("the long run is barely warmed up at all, on purpose", () => {
  const long = warmupFor("long_run");
  assert.ok(long.steps.length <= 3, `${long.steps.length} steps`);
  assert.match(long.purpose, /first two kilometres|almost nothing/i);
});

test("a Hyrox warm-up touches the machines and the patterns", () => {
  const h = warmupFor("hyrox");
  const text = h.steps.map((s) => `${s.name} ${s.cue}`).join(" ");
  assert.match(text, /row|ski/i);
  assert.match(text, /wall ball|squat/i);
});

test("the plan does not tell an athlete how to warm up for their own class", () => {
  const spin = warmupFor("commitment", "Spin class");
  assert.match(spin.purpose, /your session|your warm-up/i);
  assert.doesNotMatch(spin.steps.map((s) => s.name).join(" "), /Strides/);
});

test("legacy session kinds still get the right warm-up", () => {
  // Sessions written before the kinds were renamed must not fall back to generic.
  assert.deepEqual(warmupFor("run_intervals"), warmupFor("quality_run"));
  assert.deepEqual(warmupFor("run_long"), warmupFor("long_run"));
  assert.deepEqual(warmupFor("run_easy"), warmupFor("easy_run"));
});
