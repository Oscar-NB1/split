import { test } from "node:test";
import assert from "node:assert/strict";
import { ADJUSTED_THRESHOLD, couldBe, pickClosest, statusFor } from "../lib/ingest";

/*
 * Both of these happened, a day apart, on the same athlete's calendar.
 *
 * Monday: a 39-minute Strava "Workout" — her legs session — landed on the 40-minute run/walk
 * session instead of the 45-minute strength session, because duration was the only signal and
 * 39 is one minute from 40.
 *
 * Tuesday: a 36-minute WeightTraining with no distance on it was paired with her key run and the
 * session marked done, so the app believed she had run when she had lifted.
 */
const MONDAY = [
  { id: "run", kind: "quality_run", planned_minutes: 40 },
  { id: "lift", kind: "strength", planned_minutes: 45 },
];

test("a weights session cannot be a run, whatever the clock says", () => {
  assert.equal(couldBe("quality_run", "WeightTraining"), false);
  assert.equal(couldBe("quality_run", "Workout"), false);
  assert.equal(couldBe("easy_run", "Ride"), false);
  assert.equal(couldBe("long_run", "Swim"), false);
});

test("and a run is a run under any of Strava's names for one", () => {
  for (const sport of ["Run", "TrailRun", "VirtualRun"]) {
    assert.equal(couldBe("quality_run", sport), true, sport);
    assert.equal(couldBe("long_run", sport), true, sport);
  }
});

test("the gate picks the lift on Monday, where duration alone picked the run", () => {
  const byDuration = pickClosest(MONDAY, 39);
  assert.equal(byDuration!.id, "run", "the bug: one minute closer wins");

  const gated = MONDAY.filter((c) => couldBe(c.kind, "Workout"));
  assert.deepEqual(gated.map((c) => c.id), ["lift"]);
  assert.equal(pickClosest(gated, 39)!.id, "lift");
});

test("and leaves Tuesday unmatched rather than logging a run she did not do", () => {
  const tuesday = [{ id: "run", kind: "quality_run", planned_minutes: 24 }];
  assert.deepEqual(tuesday.filter((c) => couldBe(c.kind, "WeightTraining")), []);
});

test("a strength session takes anything that is not a run or a ride", () => {
  assert.equal(couldBe("strength", "WeightTraining"), true);
  assert.equal(couldBe("strength", "Workout"), true);
  assert.equal(couldBe("strength", "Crossfit"), true);
  assert.equal(couldBe("strength", "Run"), false, "a run is not a lifting session");
  assert.equal(couldBe("strength", "Ride"), false);
});

test("spin wants a bike", () => {
  assert.equal(couldBe("spin", "Ride"), true);
  assert.equal(couldBe("spin", "VirtualRide"), true);
  assert.equal(couldBe("spin", "Run"), false);
  assert.equal(couldBe("spin", "WeightTraining"), false);
});

test("nothing is claimed about the kinds that get logged as anything", () => {
  /*
   * A Hyrox session comes in as a Run, a Workout or a Crossfit depending on the day, and a race
   * as any of them. Ruling on those would invent exactly the confident wrong answers the gate
   * exists to prevent.
   */
  for (const sport of ["Run", "Workout", "WeightTraining", "Crossfit", null]) {
    assert.equal(couldBe("hyrox", sport), true);
    assert.equal(couldBe("race", sport), true);
    assert.equal(couldBe("benchmark", sport), true);
    assert.equal(couldBe("kickboxing", sport), true);
  }
});

test("a missing sport blocks a run rather than guessing one", () => {
  /* Strava always sends one; a manual entry or another provider may not. */
  assert.equal(couldBe("quality_run", null), false);
  assert.equal(couldBe("quality_run", undefined), false);
  assert.equal(couldBe("strength", null), true, "and lands on the kind that asks least");
});

test("an untimed session still ranks last", () => {
  /* Unchanged behaviour, kept under test because the gate now runs in front of it. */
  const c = [
    { id: "untimed", kind: "hyrox", planned_minutes: null },
    { id: "easy", kind: "easy_run", planned_minutes: 40 },
  ];
  assert.equal(pickClosest(c, 41)!.id, "easy");
});

test("short of plan is adjusted, not done", () => {
  assert.equal(statusFor(24, 40), "adjusted");
  assert.equal(statusFor(36, 40), "done");
  assert.equal(ADJUSTED_THRESHOLD, 0.7);
});
