import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMITMENT, EXCLUSIONS, ROLE_BIAS, SUBSTITUTION_DECAY, applyAbsences,
  applyExclusions, benchmarkWeeks, classify, creditFor, lockedProtects,
} from "../lib/plan/adjust";
import type { Absence } from "../lib/plan/intake-rules";
import { resolve, type ResolveInput } from "../lib/plan/resolve";
import { skeleton } from "../lib/plan/skeleton";
import { addDays } from "../lib/dates";

// ------------------------------------------------------------- commitments

test("classification is sport by format, not sport alone", () => {
  // the same machine, two different trainings
  assert.equal(COMMITMENT.row_steady.credit, 1.0);
  assert.equal(COMMITMENT.row_class.credit, 0.8);
  assert.ok(COMMITMENT.row_class.leg_cost !== COMMITMENT.row_steady.leg_cost);
});

test("spin costs the legs and gives back almost nothing", () => {
  const spin = COMMITMENT.spin;
  assert.equal(spin.credit, 0.3);
  assert.equal(spin.leg_cost, "high");
  assert.ok(COMMITMENT.cycling_steady.credit > spin.credit, "steady cycling is worth more");
});

test("a hard day that builds none of this counts for nothing", () => {
  for (const k of ["kickboxing", "football", "climbing"]) {
    assert.equal(COMMITMENT[k].credit, 0, k);
    assert.equal(COMMITMENT[k].leg_cost, "high", `${k} still costs`);
  }
  assert.equal(creditFor("kickboxing", 2, 40, "base"), 0);
});

test("a Hyrox class can stand in for the Hyrox session", () => {
  assert.equal(COMMITMENT.hyrox_class.replaces_hyrox, true);
  assert.ok(!COMMITMENT.spin.replaces_hyrox);
});

test("substitution decays through the block", () => {
  // early the limiter is aerobic capacity; late it is running economy, and only
  // running builds that
  assert.ok(SUBSTITUTION_DECAY.base > SUBSTITUTION_DECAY.build);
  assert.ok(SUBSTITUTION_DECAY.build > SUBSTITUTION_DECAY.specific);
  assert.equal(SUBSTITUTION_DECAY.taper, 0, "nothing substitutes in the taper");

  const early = creditFor("row_steady", 2, 40, "base");
  const late = creditFor("row_steady", 2, 40, "specific");
  assert.ok(early > late, `${early} in base against ${late} in specific`);
  assert.equal(creditFor("row_steady", 2, 40, "taper"), 0);
});

test("an unclassified commitment is counted conservatively rather than ignored", () => {
  const c = classify("underwater_basket_weaving");
  assert.ok(c.credit > 0 && c.credit < 0.5);
});

test("locked protects the frequency and nothing else", () => {
  // "spin is non-negotiable, twice a week" is a commitment to going twice, not
  // to the two days that sit either side of a key session
  assert.deepEqual(lockedProtects(true), { frequency: true, placement: false, intensity: false });
});

// --------------------------------------------------------------- absences

const base = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  general_training_age: "intermediate", hyrox_experience: null,
  running_base: "runs_regularly", target_sessions: 5, available_days: 5,
  confidence: "measured", ...over,
});

const START = "2026-08-17";
const weekStart = (n: number) => addDays(START, (n - 1) * 7);

const away = (from: string, to: string, type: Absence["type"] = "no_training"): Absence =>
  ({ from_date: from, to_date: to, type });

test("no training cuts the week to 35% and takes the down week with it", () => {
  const r = resolve(base());
  const { weeks } = skeleton(r, 12);
  const before = weeks[4].km;
  const out = applyAbsences(weeks, [away("2026-09-14", "2026-09-20")], weekStart);
  const hit = out.weeks.find((w) => w.reason?.startsWith("Away"))!;
  assert.ok(hit.km < before * 0.5, `${hit.km} from ${before}`);
  assert.equal(hit.deload, true, "the down week snaps onto the trip");
});

test("training as normal changes nothing and does not spend a down week", () => {
  // someone who kept training on a work trip has not had a recovery week
  const r = resolve(base());
  const { weeks } = skeleton(r, 12);
  const target = weeks[4];
  const out = applyAbsences(weeks, [away("2026-09-14", "2026-09-20", "normal")], weekStart);
  const hit = out.weeks.find((w) => w.n === target.n)!;
  assert.equal(hit.km, target.km, "volume untouched");
  assert.equal(hit.deload, target.deload, "and no down week consumed");
});

test("ten days away earns a return week, ramping over two", () => {
  const r = resolve(base());
  const { weeks } = skeleton(r, 14);
  const out = applyAbsences(weeks, [away("2026-09-14", "2026-09-28")], weekStart);
  assert.ok(out.flags.some((f) => f.code === "re_entry"));
  const back = out.weeks.find((w) => w.reason?.startsWith("Back from"))!;
  const second = out.weeks.find((w) => w.reason === "Second week back")!;
  assert.ok(back && second, "both weeks are shaped");
  assert.ok(back.volumeFactor < second.volumeFactor, "and the ramp goes the right way");
});

test("a short trip does not earn a return week", () => {
  const r = resolve(base());
  const { weeks } = skeleton(r, 12);
  const out = applyAbsences(weeks, [away("2026-09-14", "2026-09-17")], weekStart);
  assert.ok(!out.flags.some((f) => f.code === "re_entry"));
});

// -------------------------------------------------------------- benchmarks

test("benchmarks go at week 1, the midpoint, and four out", () => {
  assert.deepEqual(benchmarkWeeks(12, () => false), [1, 6, 8]);
  assert.deepEqual(benchmarkWeeks(16, () => false), [1, 8, 12]);
});

test("a benchmark is never placed inside a week the athlete is away", () => {
  // a test run on a trip measures the trip, not the training
  const placed = benchmarkWeeks(12, (n) => n === 6);
  assert.ok(!placed.includes(6));
  assert.equal(placed.length, 3, "it moves rather than disappearing");
});

test("benchmark weeks are always distinct and inside the block", () => {
  for (const len of [4, 6, 8, 10, 12, 20]) {
    const w = benchmarkWeeks(len, () => false);
    assert.equal(new Set(w).size, w.length, `${len}: no duplicates`);
    for (const n of w) assert.ok(n >= 1 && n <= len, `${len}: week ${n} is inside the block`);
  }
});

// -------------------------------------------------------------- exclusions

test("an exclusion substitutes where it can and removes where it cannot", () => {
  const sessions = [
    { kind: "sandbag_lunge" }, { kind: "farmers_carry" }, { kind: "long_run" },
  ];
  const lunges = applyExclusions(sessions, ["lunges"]);
  assert.ok(lunges.sessions.some((s) => s.kind === "split_squat_bodyweight"));
  assert.ok(!lunges.sessions.some((s) => s.kind === "sandbag_lunge"));

  const carries = applyExclusions(sessions, ["loaded_carry"]);
  assert.ok(!carries.sessions.some((s) => s.kind === "farmers_carry"), "removed, not replaced");
  assert.equal(EXCLUSIONS.loaded_carry.substitute, null);
});

test("an exclusion only ever removes — it never adds work", () => {
  const sessions = [{ kind: "long_run" }, { kind: "sandbag_lunge" }];
  const out = applyExclusions(sessions, ["lunges"]);
  assert.ok(out.sessions.length <= sessions.length, "nothing appeared");
});

test("an exclusion that touches nothing is silent", () => {
  const out = applyExclusions([{ kind: "long_run" }], ["overhead"]);
  assert.deepEqual(out.flags, []);
});

// --------------------------------------------------------------- role bias

test("role biases which stations get attention, not how many", () => {
  assert.deepEqual(ROLE_BIAS.protected, ["ski", "row"], "machine metres");
  assert.ok(ROLE_BIAS.station_carrier.includes("sled"));
  assert.ok(ROLE_BIAS.station_carrier.includes("lunges"));
  // the allocation decides how much station work there is; doing it here too
  // would compound
  assert.ok(ROLE_BIAS.balanced.length > ROLE_BIAS.protected.length);
});
