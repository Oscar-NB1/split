import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTENT_COST, MIN_RACE_GAP_DAYS, checkIntent, fieldUsability, gapWeeks,
  intentLocked, intentOptions, tooClose, usableFields,
} from "../lib/race/brace";

const TARGET = "2026-11-28";

test("the gap decides what you can afford", () => {
  // under two weeks: training only, and told why
  const close = intentOptions("2026-11-20", TARGET);
  assert.deepEqual(close.allowed, ["training"]);
  assert.ok(close.warning?.includes("comes directly out of your target race"));

  assert.deepEqual(intentOptions("2026-11-07", TARGET).allowed, ["training"]);
  assert.deepEqual(intentOptions("2026-10-28", TARGET).allowed, ["training", "sharpen"]);
  assert.deepEqual(intentOptions("2026-10-01", TARGET).allowed,
    ["training", "sharpen", "compete"]);
});

test("the worked example lands on sharpen as the ceiling", () => {
  const o = intentOptions("2026-10-28", TARGET);
  assert.equal(o.gap_weeks, 4.4);
  assert.ok(!o.allowed.includes("compete"));
  assert.match(o.blocked.find((b) => b.intent === "compete")!.reason, /about two weeks/);
});

test("a blocked intent is refused with alternatives, never downgraded", () => {
  // an athlete quietly given a training week would find out on race day
  const bad = checkIntent("compete", "2026-10-28", TARGET);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.deepEqual(bad.allowed, ["training", "sharpen"]);
    assert.match(bad.reason, /specific phase spent on a different race/);
  }
  assert.equal(checkIntent("sharpen", "2026-10-28", TARGET).ok, true);
});

test("the advertised cost sits next to the gating", () => {
  // an intent that quietly costs more than advertised is worse than one that
  // costs more openly
  assert.equal(INTENT_COST.compete.week_volume, -0.40);
  assert.match(INTENT_COST.sharpen.before, /key session before it goes/);
  assert.match(INTENT_COST.compete.cost, /two weeks/);
});

// ------------------------------------------------------------ result usability

const solo = { doubles: false, intent: "compete" as const };

test("a raced solo B-race is usable throughout", () => {
  const f = fieldUsability(solo);
  assert.deepEqual(usableFields(f), ["roxzone", "run_paces", "station_times"]);
  assert.equal(f.reason, undefined);
});

test("roxzone is always usable — a transition is a transition", () => {
  // the only in-plan source of one now that benchmark retests are gone
  for (const c of [
    { doubles: true, partner_slower: true, my_share: 0.9, intent: "training" as const },
    { doubles: false, intent: "training" as const },
  ]) {
    assert.equal(fieldUsability(c).roxzone, "usable");
  }
});

test("a partner-paced run does not enter the anchor hierarchy", () => {
  // a distorted run pace at rank 1 would poison every prescription in the plan
  const f = fieldUsability({ doubles: true, partner_slower: true, intent: "compete" });
  assert.equal(f.run_paces, "distorted");
  assert.equal(f.station_times, "usable");
  assert.match(f.reason!, /partner's pace/);
});

test("training intent means the paces were not raced", () => {
  const f = fieldUsability({ doubles: false, intent: "training" });
  assert.equal(f.run_paces, "distorted");
  assert.match(f.reason!, /rather than raced/);
});

test("an uneven station split is not comparable with a solo race", () => {
  assert.equal(fieldUsability({ doubles: true, my_share: 0.5, intent: "compete" }).station_times,
    "usable");
  for (const share of [0.3, 0.75]) {
    const f = fieldUsability({ doubles: true, my_share: share, intent: "compete" });
    assert.equal(f.station_times, "distorted");
    assert.match(f.reason!, new RegExp(`${Math.round(share * 100)}%`));
  }
});

test("several distortions are all reported, not just the first", () => {
  const f = fieldUsability({
    doubles: true, partner_slower: true, my_share: 0.85, intent: "training",
  });
  assert.equal(usableFields(f).join(), "roxzone");
  assert.match(f.reason!, /partner's pace/);
  assert.match(f.reason!, /rather than raced/);
  assert.match(f.reason!, /85%/);
});

// ----------------------------------------------------------------- hard limits

test("two races closer than five days are not two races", () => {
  assert.equal(MIN_RACE_GAP_DAYS, 5);
  assert.equal(tooClose("2026-10-28", "2026-10-31"), true);
  assert.equal(tooClose("2026-10-28", "2026-11-02"), false);
  assert.equal(tooClose("2026-11-02", "2026-10-28"), false, "order does not matter");
});

test("intent locks a week out", () => {
  // reshaping the weeks around a race you are about to run is not a decision
  // anyone makes well, and the taper it would rewrite has already happened
  assert.equal(intentLocked("2026-10-28", "2026-10-22"), true);
  assert.equal(intentLocked("2026-10-28", "2026-10-21"), true);
  assert.equal(intentLocked("2026-10-28", "2026-10-20"), false);
});

test("the gap is signed the way the rules read", () => {
  assert.ok(gapWeeks("2026-10-28", TARGET) > 0, "a race before the target is a positive gap");
});
