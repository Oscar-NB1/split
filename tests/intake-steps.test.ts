import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKS, DEPENDENTS, STEPS, dependentsOf, filled, liveSteps, mapOf, subFor,
  weeklyLoad,
  type Answers, type Step,
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

test("a 5 km time is not asked of someone who does not run 5 km", () => {
  // a stepper defaulted to 32 minutes plus a "no idea" escape is a worse way of
  // saying the same thing — their paces come from the running base instead
  const asks = (runningSelf: string) =>
    liveSteps({ ...doubles, runningSelf }, true).some((s) => s.id === "pace");
  assert.equal(asks("I do not run"), false);
  assert.equal(asks("Runs with walk breaks"), false);
  assert.equal(asks("5 km nonstop"), true);
  assert.equal(asks("Half marathon fit"), true);
});

test("secondary races are only asked about when there is a target", () => {
  // without a target there is no gap, and the gap is what gates the intent
  const has = (hasRace: string) =>
    liveSteps({ ...doubles, hasRace }, true).some((s) => s.id === "bRaces");
  assert.equal(has("Yes"), true);
  assert.equal(has("No"), false);
  // and it never blocks the flow — most people have no second race
  assert.equal(filled(step("bRaces"), {}), true);
});

test("changing an answer forgets what that answer decided", () => {
  /*
   * The principle: answers determine the questions that follow, so nothing later
   * can invalidate something earlier. Going back is the one case that looks like
   * it does — a division chosen for doubles is meaningless once the discipline is
   * singles — so the dependent answer is cleared rather than left to fail
   * validation twenty steps later.
   */
  assert.ok(dependentsOf("discipline").includes("division"),
    "the division lists differ per discipline");
  assert.ok(dependentsOf("discipline").includes("runDelta"),
    "and the partner questions only exist for doubles");
  assert.ok(dependentsOf("hasRace").includes("raceDate"));
  assert.ok(dependentsOf("hasRace").includes("bRaces"),
    "no target means nothing to gate a secondary race against");
  assert.ok(dependentsOf("raceDate").includes("bRaces"),
    "moving the target changes what each B-race intent can afford");
  assert.ok(dependentsOf("runningSelf").includes("paceUnknown"));
  // Nothing depends on the last few answers, and claiming otherwise would clear
  // things for no reason.
  assert.deepEqual(dependentsOf("injuries"), []);
  assert.deepEqual(dependentsOf("prefs"), []);
});

test("every dependent names a real step or an answer a step writes", () => {
  const ids = new Set(STEPS.map((s) => s.id));
  // fields written by composite steps rather than being steps themselves
  const written = new Set(["goalMin", "paceMin", "paceSec", "paceUnknown", "equipment"]);
  for (const [parent, deps] of Object.entries(DEPENDENTS)) {
    assert.ok(ids.has(parent), `${parent} is a step`);
    for (const d of deps) {
      assert.ok(ids.has(d) || written.has(d), `${d} is a step or a written field`);
    }
  }
});

// ----------------------------------------------------------------------- map

test("every step belongs to exactly one block", () => {
  // A question missing from BLOCKS is a question the overview cannot reach, and
  // one listed twice is one that reads as answered in two places.
  const seen = new Map<string, string>();
  for (const b of BLOCKS) {
    for (const id of b.ids) {
      assert.ok(!seen.has(id), `${id} is only in ${seen.get(id) ?? b.name}`);
      seen.set(id, b.name);
      assert.ok(STEPS.some((s) => s.id === id), `${id} is a real step`);
    }
  }
  for (const s of STEPS) assert.ok(seen.has(s.id), `${s.id} is in a block`);
});

test("the map numbers the steps the athlete is actually asked", () => {
  // The point of deriving from `live`: a runner is never told to go to a step
  // about their partner, and the numbers match the header they can see.
  const a: Answers = { discipline: "Running race", hasRace: "Yes", base: "Some" };
  const live = liveSteps(a, false);
  const blocks = mapOf(live, a, (s) => (s.id === "base" ? "Some" : ""));

  const flat = blocks.flatMap((b) => b.rows);
  assert.deepEqual(flat.map((r) => r.id), live.map((s) => s.id).filter(
    (id) => flat.some((r) => r.id === id)), "in the order they are asked");
  for (const r of flat) {
    assert.equal(live[r.step - 1].id, r.id, `${r.id} jumps to its own step`);
  }
  assert.ok(!flat.some((r) => r.id === "runDelta"), "no partner questions");

  const start = blocks.find((b) => b.name === "Where you are starting")!;
  assert.ok(start.answered < start.total, `${start.answered}/${start.total}`);
  assert.equal(start.rows.find((r) => r.id === "base")!.answer, "Some");
  assert.ok(start.range.startsWith("Steps "), start.range);
});

test("a block with nothing to ask is left out rather than shown empty", () => {
  const a: Answers = { discipline: "Running race", hasRace: "Yes" };
  const names = mapOf(liveSteps(a, false), a, () => "").map((b) => b.name);
  assert.ok(!names.includes("You and your partner"), names.join(", "));
});

test("the partner block only exists for a doubles athlete", () => {
  // It held the division, the Hyrox experience and the past races, which are
  // every athlete's own answers — so a singles athlete was reading their own
  // answers under a heading about a partner they do not have.
  const partnerBlock = (discipline: string) => {
    const a: Answers = { discipline, hasRace: "Yes" };
    return mapOf(liveSteps(a, false), a, () => "")
      .find((b) => b.name === "You and your partner");
  };
  assert.equal(partnerBlock("Hyrox singles"), undefined);
  assert.equal(partnerBlock("Running race"), undefined);
  assert.deepEqual(partnerBlock("Hyrox doubles")?.rows.map((r) => r.id),
    ["runDelta", "stationDelta"]);
});

test("picking doubles is what the form says brings the partner questions", () => {
  const [doubles] = STEPS.find((s) => s.id === "discipline")!.opts!;
  assert.match(String(doubles[1]), /partner/i);
});
