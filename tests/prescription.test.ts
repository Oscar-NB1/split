import { test } from "node:test";
import assert from "node:assert/strict";
import { mmss, parseSteps, parseStrength, repCount, restFor, tonnage } from "../lib/prescription";

// the real prescription the plan writes for week 1's Tuesday
const KEY = [
  "- 15m Z2 warm up",
  "- 5x",
  "- 800m Z4",
  "- 90s Z1 walk",
  "- 10m Z1 cool down",
].join("\n");

test("a run prescription groups into warm-up, the set, and cool-down", () => {
  const g = parseSteps(KEY);
  assert.deepEqual(g.map((x) => x.label), ["Warm-up", "5 ×", "Cool-down"]);
  assert.equal(g[1].repeat, 5);
  assert.equal(g[1].items.length, 2, "the rep and its recovery");
});

test("the work rep and the recovery are told apart", () => {
  const [, main] = parseSteps(KEY);
  assert.equal(main.items[0].rest, false, "800m Z4 is work");
  assert.equal(main.items[1].rest, true, "90s Z1 walk is recovery");
});

test("Z1 counts as recovery even when the line doesn't say walk", () => {
  const g = parseSteps("- 5x\n- 400m Z5\n- 60s Z1");
  assert.equal(g[0].items[1].rest, true);
});

test("dose and zone are pulled out of the line", () => {
  const [warm] = parseSteps(KEY);
  assert.equal(warm.items[0].dose, "15m");
  assert.equal(warm.items[0].zone, "Z2");
  assert.equal(warm.items[0].label, "warm up");
});

test("reps are counted through the repeat, not per line", () => {
  // 5 × (one work rep) = 5, not 1 and not 10
  assert.equal(repCount(parseSteps(KEY)), 5);
});

test("a 5K time trial has no repeat block and still parses", () => {
  const g = parseSteps("- 15m Z2 warm up\n- 5000m Z5\n- 10m Z1 cool down");
  assert.equal(g.length, 3);
  assert.equal(g[1].items[0].dose, "5000m");
  assert.equal(g[1].repeat, 1);
});

test("no target is no steps, not a crash", () => {
  assert.deepEqual(parseSteps(null), []);
  assert.deepEqual(parseSteps(""), []);
  assert.deepEqual(parseSteps("   "), []);
});

// ------------------------------------------------------------------ strength

test("a lift line parses into name, sets, reps and load", () => {
  const [l] = parseStrength("Trap bar deadlift 3x5 @ 130");
  assert.deepEqual(l, { name: "Trap bar deadlift", sets: 3, reps: 5, load: 130 });
});

test("the whole Strength A block parses", () => {
  const lifts = parseStrength(
    "Trap bar deadlift 3x5 @ 130\nBack squat 3x5 @ 105\nWeighted pull-up 3x6 @ 12",
  );
  assert.equal(lifts.length, 3);
  assert.deepEqual(lifts.map((l) => l.name),
    ["Trap bar deadlift", "Back squat", "Weighted pull-up"]);
  assert.equal(lifts[2].load, 12);
});

test("bodyweight is a null load, not a zero one", () => {
  // zero kilograms and no prescribed load are different things: one renders as
  // a number the athlete can step up from, the other as a dash
  const [l] = parseStrength("Press-up 3x12");
  assert.equal(l.load, null);
  assert.equal(l.sets, 3);
});

test("an unreadable line survives as a lift rather than vanishing", () => {
  const lifts = parseStrength("Sled push, heavy, until it hurts");
  assert.equal(lifts.length, 1);
  assert.equal(lifts[0].name, "Sled push, heavy, until it hurts");
  assert.equal(lifts[0].sets, 0);
});

test("× and x are both accepted, and kg is optional", () => {
  assert.equal(parseStrength("Back squat 3×5 @ 105kg")[0].load, 105);
  assert.equal(parseStrength("Back squat 3 x 5 @ 105")[0].sets, 3);
});

test("tonnage counts only completed sets", () => {
  const sets = [
    { load_kg: 100, reps: 5, done: true },
    { load_kg: 100, reps: 5, done: true },
    { load_kg: 100, reps: 5, done: false },  // not done: not lifted
    { load_kg: null, reps: 12, done: true }, // bodyweight: no kilograms to count
  ];
  assert.equal(tonnage(sets), 1000);
});

test("rest follows the set scheme: heavy and low-rep needs longer", () => {
  // a triple at 90% is not recoverable in ninety seconds; a set of twelve does
  // not need three minutes
  assert.equal(restFor(3), 180);
  assert.equal(restFor(5), 180);
  assert.equal(restFor(6), 120);
  assert.equal(restFor(8), 120);
  assert.equal(restFor(12), 90);
  assert.equal(restFor(20), 90);
});

test("rest has a sane default when no reps are prescribed", () => {
  assert.equal(restFor(null), 120);
  assert.equal(restFor(undefined), 120);
});

test("the clock reads m:ss, and h:mm:ss past an hour", () => {
  assert.equal(mmss(90), "1:30");
  assert.equal(mmss(180), "3:00");
  assert.equal(mmss(9), "0:09");
  assert.equal(mmss(3661), "1:01:01");
  // a countdown must never render a negative
  assert.equal(mmss(-5), "0:00");
});
