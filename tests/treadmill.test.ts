import { strict as assert } from "node:assert";
import test from "node:test";
import {
  isTreadmill, needsWorkReport, paceFromSpeed, speedFromPace, secondsFor, paceOfReport,
  workShapeOf,
} from "../lib/treadmill";

const TT = {
  title: "TEST - 2 km time trial @ 5:15-5:30/km (10.9-11.4 km/h)",
  target: "- 900m Z2 warm up\n- 2km Z4 time trial — nonstop, negative split\n- 600m Z1 cool down",
};
const REPS = {
  title: "KEY RUN - 6 × 400 m @ 5:10/km (11.6 km/h) · 90 s walk",
  target: "- 1.3km Z2 warm up\n- 6x\n- 400m Z4 @ 5:07-5:13/km\n- 90s Z1 walk\n- 800m Z1 cool down",
};
const RUNWALK = {
  title: "Run/walk build - 5 × (4 min run @ 6:30-7:00/km · 8.6-9.2 km/h / 1 min walk)",
  target: "- 5x\n- 4 min Z2 @ 6:30-7:00/km\n- 1 min Z1 walk",
};

test("a time trial is one effort, and its target comes off the title's band", () => {
  const s = workShapeOf(TT.title, TT.target);
  assert.equal(s?.kind, "single");
  assert.equal(s && s.kind === "single" && s.distanceM, 2000);
  // 5:15-5:30 midpoints to 5:22.5 -> 323 s/km, so 2 km is about 10:46
  assert.equal(s?.targetSeconds, 646);
});

test("reps are counted, and each one carries its own distance", () => {
  const s = workShapeOf(REPS.title, REPS.target);
  assert.equal(s?.kind, "reps");
  assert.equal(s && s.kind === "reps" && s.count, 6);
  assert.equal(s && s.kind === "reps" && s.distanceM, 400);
  assert.equal(s?.targetSeconds, 124); // 400 m at 5:10/km
});

test("a run/walk session has nothing to report: the reps are minutes, not distances", () => {
  assert.equal(workShapeOf(RUNWALK.title, RUNWALK.target), null);
});

test("an easy run has no work to ask about", () => {
  assert.equal(workShapeOf("Easy run", "- 3km Z2 @ 6:45-7:15/km"), null);
});

test("Strava's names for going nowhere", () => {
  assert.equal(isTreadmill("Run", true), true);
  assert.equal(isTreadmill("VirtualRun", false), true);
  assert.equal(isTreadmill("Run", false), false);
  assert.equal(isTreadmill(null, undefined), false);
});

test("a treadmill run with work on it gets asked", () => {
  const shape = workShapeOf(TT.title, TT.target);
  const r = needsWorkReport({
    shape, treadmill: true, lapCount: 2, alreadyReported: false, declined: false,
  });
  assert.equal(r?.why, "a treadmill only tells us your total distance");
});

test("distances that disagree get asked even when nothing says treadmill", () => {
  // hers: 4,216 m on the machine against 2,636 m from the watch
  const r = needsWorkReport({
    shape: workShapeOf(TT.title, TT.target), treadmill: false, lapCount: 2,
    summaryM: 4216.5, lapSumM: 2635.9, alreadyReported: false, declined: false,
  });
  assert.equal(r?.why, "the distances on this one do not agree");
});

test("fewer laps than reps means the watch was never lapped", () => {
  const r = needsWorkReport({
    shape: workShapeOf(REPS.title, REPS.target), treadmill: false, lapCount: 2,
    summaryM: 5000, lapSumM: 5000, alreadyReported: false, declined: false,
  });
  assert.equal(r?.why, "we cannot see the reps in what your watch recorded");
});

test("outdoors, lapped properly, nothing is asked", () => {
  const r = needsWorkReport({
    shape: workShapeOf(REPS.title, REPS.target), treadmill: false, lapCount: 13,
    summaryM: 5000, lapSumM: 5000.4, alreadyReported: false, declined: false,
  });
  assert.equal(r, null);
});

test("answered once, or declined once, is not asked again", () => {
  const shape = workShapeOf(TT.title, TT.target);
  assert.equal(needsWorkReport({
    shape, treadmill: true, lapCount: 0, alreadyReported: true, declined: false,
  }), null);
  assert.equal(needsWorkReport({
    shape, treadmill: true, lapCount: 0, alreadyReported: false, declined: true,
  }), null);
});

test("a session with no stated work is never asked, treadmill or not", () => {
  assert.equal(needsWorkReport({
    shape: null, treadmill: true, lapCount: 0, alreadyReported: false, declined: false,
  }), null);
});

test("belt speed and pace are the same number, read two ways", () => {
  assert.equal(paceFromSpeed(11.6), 310.3448275862069);      // 5:10/km
  assert.equal(Math.round(paceFromSpeed(11.6)), 310);
  assert.equal(Math.round(speedFromPace(310) * 10) / 10, 11.6);
  assert.equal(secondsFor(400, 11.6), 124);                  // one 400 at 11.6 km/h
  assert.equal(secondsFor(2000, 11.2), 643);
});

test("and a reported rep says what the pace was", () => {
  assert.equal(paceOfReport(2000, 648), 324);                // 10:48 for 2 km is 5:24/km
  assert.equal(paceOfReport(400, 124), 310);
  assert.equal(paceOfReport(0, 100), null);
  assert.equal(paceOfReport(400, 0), null);
});
