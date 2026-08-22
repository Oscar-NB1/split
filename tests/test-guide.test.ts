import { strict as assert } from "node:assert";
import test from "node:test";
import { testGuideFor } from "../lib/test-guide";

const TT2 = {
  title: "TEST - 2 km time trial @ 5:15-5:30/km (10.9-11.4 km/h)",
  target: "- 900m Z2 warm up\n- 2km Z4 time trial — nonstop, negative split\n- 600m Z1 cool down",
};

test("a stated band becomes a target range of finish times", () => {
  const g = testGuideFor(TT2.title, TT2.target)!;
  assert.equal(g.distance_m, 2000);
  assert.equal(g.target_low_s, 630);   // 5:15/km over 2 km = 10:30
  assert.equal(g.target_high_s, 660);  // 5:30/km over 2 km = 11:00
  assert.match(g.strategy[0], /10:30–11:00/);
  assert.match(g.strategy[0], /10\.9–11\.4 km\/h/, "and the belt speed to set");
});

test("the 3 km and 5 km tests get their own numbers", () => {
  const three = testGuideFor("KEY RUN - 3 km time trial @ 5:35/km (10.7 km/h)",
    "- 900m Z2 warm up\n- 3km Z4 time trial — nonstop, negative split\n- 600m Z1 cool down")!;
  // a single stated pace becomes a band of five seconds either side
  assert.equal(three.target_low_s, Math.round(330 * 3));
  assert.equal(three.target_high_s, Math.round(340 * 3));

  const five = testGuideFor("KEY RUN - 5 km time trial @ 5:50/km (10.3 km/h)",
    "- 900m Z2 warm up\n- 5km Z4 time trial — nonstop, negative split\n- 600m Z1 cool down")!;
  assert.equal(five.target_low_s, Math.round(345 * 5));
  assert.equal(five.target_high_s, Math.round(355 * 5));
});

test("a test with no stated pace still gets guidance, without inventing a number", () => {
  const g = testGuideFor("TEST",
    "- 900m Z2 warm up\n- 2km Z2 time trial — nonstop, negative split\n- 600m Z1 cool down")!;
  assert.equal(g.target_low_s, null);
  assert.equal(g.target_high_s, null);
  assert.match(g.strategy[0], /hardest pace you believe you can hold/);
});

test("the reassurance is always there, and says the number is not a grade", () => {
  const g = testGuideFor(TT2.title, TT2.target)!;
  assert.match(g.reassurance, /Try to finish it/);
  assert.match(g.reassurance, /completely fine/);
  assert.match(g.reassurance, /information, not a grade/);
});

test("a short test is told to hold on rather than negative split", () => {
  const short = testGuideFor("TEST - 800 m", "- 800m Z4 time trial")!;
  assert.equal(short.distance_m, 800);
  assert.match(short.strategy[2], /hold on/);
  const long = testGuideFor(TT2.title, TT2.target)!;
  assert.match(long.strategy[2], /come home faster/);
});

test("anything that is not a test gets nothing", () => {
  assert.equal(testGuideFor("Easy run", "- 3km Z2 @ 6:45-7:15/km"), null);
  assert.equal(testGuideFor("KEY RUN - 6 × 400 m @ 5:10/km",
    "- 1.3km Z2 warm up\n- 6x\n- 400m Z4 @ 5:07-5:13/km"), null);
  assert.equal(testGuideFor("Hyrox class", "- 60 min Z2 Hyrox class"), null);
  assert.equal(testGuideFor("TEST", null), null, "a time trial with no prescription is not one");
});

test("a clock time in a title is not mistaken for a pace", () => {
  // "Race @ 09:30" is a start time; the pace filter rejects anything over 15:00/km
  const g = testGuideFor("RACE @ 09:30", "- 5km Z4 time trial")!;
  assert.equal(g.target_low_s, null, "no target rather than a nine-minute-per-km one");
});
