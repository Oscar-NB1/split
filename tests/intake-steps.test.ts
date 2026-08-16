import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STEPS, filled, liveSteps, subFor, weeklyLoad, type Answers, type Step,
} from "../lib/intake-steps";

const ids = (a: Answers, strava = false) => liveSteps(a, strava).map((s) => s.id);
const step = (id: string): Step => STEPS.find((s) => s.id === id)!;
const doubles: Answers = { discipline: "Hyrox doubles", hasRace: "Yes" };

test("every step has a question and a unique id", () => {
  assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
  for (const s of STEPS) assert.ok(s.q.length > 0, `${s.id} asks something`);
  for (const s of STEPS.filter((x) => x.kind === "choice")) {
    assert.ok((s.opts ?? []).length >= 2, `${s.id} offers a choice`);
  }
});

// ------------------------------------------------------------------- gating

test("the partner questions are doubles-only", () => {
  assert.ok(ids(doubles).includes("runDelta"));
  assert.ok(!ids({ discipline: "Hyrox singles" }).includes("runDelta"));
});

test("a partner already in the app answers them better than a guess would", () => {
  assert.ok(!ids({ ...doubles, partnerInApp: true }).includes("runDelta"));
  assert.ok(!ids({ ...doubles, pastRaces: [{ partnerPulled: true }] }).includes("stationDelta"));
});

test("the Hyrox questions drop out for a running race", () => {
  const running = ids({ discipline: "Running race", hasRace: "Yes" });
  for (const id of ["division", "sled", "hyroxExp", "pastRaces"]) {
    assert.ok(!running.includes(id), `${id} is not asked`);
  }
  assert.ok(running.includes("raceDistance"), "but the distance is");
});

test("no race means no date and no goal", () => {
  const none = ids({ discipline: "General fitness", hasRace: "No" });
  assert.ok(!none.includes("raceDate") && !none.includes("goal"));
});

test("connecting Strava removes the step that offers it", () => {
  assert.ok(ids(doubles, false).includes("stravaConnect"));
  assert.ok(!ids(doubles, true).includes("stravaConnect"));
  // the two questions it prefills stay — they are confirmed, not skipped
  assert.ok(ids(doubles, true).includes("peakWeek"));
});

test("doubles and rest days are only asked when the week does not fit", () => {
  assert.ok(!ids({ ...doubles, targetSessions: "5" }).includes("allowDoubles"));
  const packed = { ...doubles, targetSessions: "6", commitments: ["Kickboxing"], freq: { Kickboxing: 2 } };
  assert.equal(weeklyLoad(packed), 8);
  assert.ok(ids(packed).includes("allowDoubles"));

  const everyDay = { ...packed, days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };
  assert.ok(ids(everyDay).includes("wantRestDay"));
  assert.ok(!ids({ ...everyDay, days: ["Mon", "Tue"] }).includes("wantRestDay"));
});

test("'Nothing fixed' costs no sessions", () => {
  assert.equal(weeklyLoad({ targetSessions: "5", commitments: ["Nothing fixed"] }), 5);
});

test("the step that only exists because of arithmetic states the arithmetic", () => {
  const packed = {
    ...doubles, targetSessions: "6", commitments: ["Kickboxing"], freq: { Kickboxing: 2 },
    days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  };
  const sub = subFor(step("allowDoubles"), packed);
  assert.match(sub, /8 sessions across 5 available days/);
  // and an ordinary step keeps its own
  assert.equal(subFor(step("base"), packed), step("base").sub);
});

// ------------------------------------------------------------------- filled

test("a distance is answered by a number or by saying you do not know", () => {
  const s = step("peakWeek");
  assert.equal(filled(s, {}), false);
  assert.equal(filled(s, { peakWeek: 38 }), true);
  assert.equal(filled(s, { peakWeekUnknown: true }), true);
  assert.equal(filled(s, { peakWeek: 0 }), false, "zero is not an answer");
});

test("the skippable steps never block the flow", () => {
  for (const id of ["stravaConnect", "pastRaces", "injuries", "pace"]) {
    assert.equal(filled(step(id), {}), true, `${id} does not block`);
  }
});

test("chips accept a typed-in other", () => {
  assert.equal(filled(step("commitments"), {}), false);
  assert.equal(filled(step("commitments"), { commitments: ["Yoga"] }), true);
  assert.equal(filled(step("commitments"), { otherCommit: "Brazilian jiu-jitsu" }), true);
});

test("both dials are needed before the last step is done", () => {
  assert.equal(filled(step("prefs"), { volume: "Progressive" }), false);
  assert.equal(filled(step("prefs"), { volume: "Progressive", difficulty: "Hard" }), true);
});

test("the progress count only ever counts questions this athlete will see", () => {
  // the complaint a filtered flow avoids: a bar that jumps two places
  const running = liveSteps({ discipline: "Running race", hasRace: "No" }, true);
  const hyrox = liveSteps(doubles, false);
  assert.ok(running.length < hyrox.length);
  assert.ok(running.every((s) => STEPS.includes(s)), "no invented steps");
});
