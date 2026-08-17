import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beyondHorizon, coldCost, conditionsCost, headlineFor, heatCost, verdictFor,
  wasAdverse, windCost,
} from "../lib/weather";
import { read, repRead, type Signal } from "../lib/signals";

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

test("one rep off the pace, and the set proves nothing", () => {
  /*
   * Four flew and one blew up. Averaging would have called this ahead and moved the
   * plan; reading the reps calls it a set they could not complete at that pace, which
   * is a durability finding rather than a pace one.
   */
  const r = read([sweep([241, 240, 239, 238, 262])], 250);
  assert.equal(r.shift, 0, "no shift from a set that fell apart");
  assert.equal(r.points[0].reps_read!.behind, 1);
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

// --- reps, not the average of them ----------------------------------------------

test("one blown rep does not turn a good session into a bad verdict", () => {
  /*
   * 4:05, 4:06, 4:07, 4:30 against a 4:10 target. The average is 4:12, which reads
   * as behind — while three of the four reps beat the target and one rep blew up.
   * That athlete is fitter than their prescription, and averaging says the opposite.
   */
  const reps = [245, 246, 247, 270];
  const s: Signal = {
    on: "2026-08-14", label: "4 × 1000 m", type: "Interval", weight: 1,
    prescribed: 250, achieved: reps.reduce((a, b) => a + b, 0) / reps.length, reps,
  };
  assert.ok(s.achieved > 250, "the average is behind the target");
  const rr = repRead(s)!;
  assert.equal(rr.ahead, 3, "three reps beat it");
  assert.equal(rr.behind, 1, "one blew up");
  /*
   * Nothing moves — and that is the point. Averaging called this session *behind*
   * and would have eased every pace target in the block off one bad rep. Reading the
   * reps calls it what it is: a prescription that is about right, for an athlete who
   * held it three times out of four.
   *
   * It does not move the plan quicker either, because a set is a set: they were asked
   * for four reps at 4:10 and produced three. The finding is durability, and the
   * `fade` figure is where that gets said.
   */
  assert.equal(rr.provable, 0, "a set with a blown rep proves nothing about pace");
  const v = read([s], 250);
  assert.equal(v.points[0].delta, 0);
  assert.notEqual(v.state, "behind", "and above all, not behind");
});

test("a set that fell apart is not read as on plan", () => {
  /*
   * 3:55, 4:05, 4:15, 4:25 averages exactly the 4:10 target. The athlete went out too
   * hard and could not hold it — which is the opposite finding from the session above,
   * and has an identical average.
   */
  const reps = [235, 245, 255, 265];
  const s: Signal = {
    on: "2026-08-14", label: "4 × 1000 m", type: "Interval", weight: 1,
    prescribed: 250, achieved: 250, reps,
  };
  const rr = repRead(s)!;
  assert.equal(rr.ahead, 2);
  assert.equal(rr.behind, 2);
  assert.equal(rr.provable, 0, "a mixed set proves nothing about the pace");
  assert.equal(read([s], 250).points[0].delta, 0);
  assert.equal(rr.fade, 20, "and it says they lost 20 s/km across it");
});

test("fade is reported, and needs enough reps to mean anything", () => {
  const even: Signal = {
    on: "2026-08-14", label: "6 × 1000 m", type: "Interval", weight: 1,
    prescribed: 250, achieved: 250, reps: [250, 249, 251, 250, 250, 251],
  };
  assert.ok(Math.abs(repRead(even)!.fade!) <= 1, "held evenly");
  assert.equal(repRead({ ...even, reps: [250, 248, 252] })!.fade, null,
    "three reps is not a trend");
});

test("without laps, the session average is still the evidence", () => {
  // A lift, or an activity imported with no interval structure, has one number.
  const s: Signal = {
    on: "2026-08-14", label: "Threshold 20 min", type: "Interval", weight: 1,
    prescribed: 250, achieved: 244,
  };
  assert.equal(repRead(s), null, "no reps, no rep read");
  // and the one number it did give us is still the evidence
  assert.equal(read([s], 250).points[0].delta, -6);
});

test("a run of sessions moves the plan by the least of them, not the average", () => {
  /*
   * Same argument as inside a session, one level up. Three sessions at −8, −9 and −2
   * average to about −7, and the athlete has only demonstrated −2 across all three.
   * A plan moves by the amount every piece of evidence supports.
   */
  const at = (d: number): Signal => ({
    on: "2026-08-14", label: "5 × 1000 m", type: "Interval", weight: 1,
    prescribed: 250, achieved: 250 + d,
    reps: [250 + d, 250 + d, 250 + d, 250 + d],
  });
  const r = read([at(-8), at(-9), at(-2)], 250);
  assert.equal(r.streak, 3, "three on the same side of the band");
  assert.equal(r.shift, -1, "−2 × 0.6, rounded — the binding session");
  assert.ok(r.trend < -4, `the trend is still reported as ${r.trend}`);
});
