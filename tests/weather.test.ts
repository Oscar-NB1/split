import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beyondHorizon, coldCost, conditionsCost, headlineFor, heatCost, verdictFor,
  wasAdverse, windCost,
} from "../lib/weather";
import { read, type Signal } from "../lib/signals";

test("heat costs nothing until it costs something, then accelerates", () => {
  assert.equal(heatCost(12, 60), 0, "a cool day is not an excuse");
  assert.equal(heatCost(15, 60), 0, "nor is the threshold itself");

  // the curve, not a straight line: five degrees hurts far more up high than low
  const low = heatCost(20, 50) - heatCost(15, 50);
  const high = heatCost(32, 50) - heatCost(27, 50);
  assert.ok(high > low * 2, `${low} s/km from 15→20 against ${high} from 27→32`);
});

test("humidity multiplies heat, and dry heat is not penalised for being dry", () => {
  assert.equal(heatCost(28, 40), heatCost(28, 50), "below 50% is neutral, not a credit");
  assert.ok(heatCost(28, 85) > heatCost(28, 50), "humid air stops sweat working");
});

test("wind and cold are small, and the total is capped", () => {
  assert.equal(windCost(12), 0, "a breeze is weather, not resistance");
  assert.ok(windCost(35) > 0 && windCost(35) < 12, `${windCost(35)} s/km at 35 km/h`);
  assert.equal(coldCost(8), 0);
  assert.ok(coldCost(-6) > 0);

  /*
   * Capped at 25 s/km. Past that the honest answer is a different session, not a
   * slower target — an app offering to move a pace by forty seconds is pretending
   * the session was still the session.
   */
  assert.equal(conditionsCost({ temp_c: 41, humidity: 95, wind_kmh: 60 }), 25);
});

test("the verdict names the one thing that matters most about the day", () => {
  assert.equal(verdictFor({ temp_c: 30, humidity: 70, wind_kmh: 5, rain_mm: 0 }), "hot");
  assert.equal(verdictFor({ temp_c: 14, humidity: 60, wind_kmh: 38, rain_mm: 0 }), "windy");
  assert.equal(verdictFor({ temp_c: 9, humidity: 80, wind_kmh: 8, rain_mm: 7 }), "wet");
  assert.equal(verdictFor({ temp_c: 13, humidity: 55, wind_kmh: 9, rain_mm: 0 }), "fine");
});

test("the headline is advice, not a readout", () => {
  const hot = headlineFor({ verdict: "hot", temp_c: 29, wind_kmh: 6, rain_mm: 0, cost_s: 9 });
  assert.match(hot, /effort/, "it says what to do about it");
  assert.match(hot, /9 s\/km/, "and what it will cost");

  const fine = headlineFor({ verdict: "fine", temp_c: 13, wind_kmh: 8, rain_mm: 0, cost_s: 0 });
  assert.doesNotMatch(fine, /s\/km/, "no allowance is offered on a good day");
});

// --- what it does to calibration -----------------------------------------------

const sig = (achieved: number, conditions = 0): Signal => ({
  on: "2026-08-01", label: "5 × 1000 m", type: "Interval", weight: 1,
  prescribed: 250, achieved, conditions_s: conditions,
});

test("bad conditions cannot slow a plan down", () => {
  /*
   * Three sessions eight seconds off prescription, all of them in the sort of heat
   * that costs about that much. Without the allowance this reads as an athlete who
   * has got slower and recommends moving every pace target in the block.
   */
  const missed = [sig(258), sig(258), sig(258)];
  assert.equal(read(missed, 250).state, "behind");
  assert.ok(read(missed, 250).shift > 0, "it would have slowed the plan");

  const inHeat = [sig(258, 9), sig(258, 9), sig(258, 9)];
  assert.equal(read(inHeat, 250).state, "on", "the heat explains it");
  assert.equal(read(inHeat, 250).shift, 0, "so nothing moves");
});

test("but they cannot speed one up either — the allowance is one-directional", () => {
  /*
   * Beating a target in bad conditions is real evidence, and arguably stronger than
   * the same run in still air. Crediting it further would be the app arguing with
   * evidence in its own favour.
   */
  const fast = [sig(242, 9), sig(242, 9), sig(242, 9)];
  const still = [sig(242, 0), sig(242, 0), sig(242, 0)];
  assert.deepEqual(read(fast, 250).shift, read(still, 250).shift);
  assert.equal(read(fast, 250).state, "ahead");
});

test("the allowance pulls towards zero and never past it", () => {
  // 3 s/km off prescription, with a 20 s/km allowance: on plan, not wildly ahead.
  const r = read([sig(253, 20), sig(253, 20), sig(253, 20)], 250);
  assert.equal(r.state, "on");
  assert.equal(r.shift, 0);
  assert.ok(r.trend >= 0, `trend ${r.trend} never crosses into 'ahead'`);
});

test("adverse is a higher bar than 'it cost something'", () => {
  // The engine already tolerates ±2 s/km of noise; this is for the days that
  // genuinely changed what was possible.
  assert.equal(wasAdverse(3), false);
  assert.equal(wasAdverse(6), true);
});

test("the forecast horizon is respected, and beyond it is labelled", () => {
  const today = new Date("2026-08-17T09:00:00Z");
  assert.equal(beyondHorizon("2026-08-20", today), false, "three days out is a forecast");
  assert.equal(beyondHorizon("2026-08-31", today), false, "a fortnight out still is");
  assert.equal(beyondHorizon("2026-11-29", today), true, "race day is not");
});

// --- one session, if it swept ---------------------------------------------------

const sweep = (reps: number[], prescribed = 250): Signal => ({
  on: "2026-08-14", label: "5 × 1000 m", type: "Interval", weight: 1,
  prescribed, achieved: reps.reduce((a, b) => a + b, 0) / reps.length, reps,
});

test("a session where every rep beat target moves the plan on its own", () => {
  /*
   * The streak rule exists so one freak session cannot move a plan, and it is the
   * right default. A set where every rep came in ahead is not a freak session — it
   * is a prescription that has stopped fitting, and making the athlete prove it
   * three times is three more weeks at a pace they have already outgrown.
   */
  const r = read([sweep([243, 241, 242, 240, 239])], 250);
  assert.equal(r.state, "ahead");
  assert.ok(r.shift < 0, `${r.shift} s/km off a single sweeping session`);
});

test("one rep off the pace, and it waits for the streak like everything else", () => {
  // Four flew and one blew up: that is a pacing story, not a fitness one.
  const r = read([sweep([241, 240, 239, 238, 262])], 250);
  assert.equal(r.shift, 0, "no shift from a set that fell apart");
});

test("two quick reps are a good day, not evidence", () => {
  const r = read([sweep([242, 240])], 250);
  assert.equal(r.shift, 0, "three reps minimum before one session can speak");
});

test("a sweep only ever unlocks the quick direction", () => {
  /*
   * Nothing about one bad session justifies making a plan easier on the spot. The
   * slow direction still has to earn its three sessions.
   */
  const slow = read([sweep([262, 264, 263, 265, 266])], 250);
  assert.equal(slow.shift, 0, "nothing moves off one slow session");
  // It may read "behind" — that is the existing verdict and it is honest — but the
  // confidence stays Building and no recommendation is offered.
  assert.equal(slow.confidence, "Building");
});

test("a session with no laps imported cannot sweep, and does not pretend to", () => {
  const noReps: Signal = {
    on: "2026-08-14", label: "5 × 1000 m", type: "Interval", weight: 1,
    prescribed: 250, achieved: 240,
  };
  assert.equal(read([noReps], 250).shift, 0);
});
