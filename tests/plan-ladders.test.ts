import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DURABILITY_COEFFICIENT, RUNG_MULTIPLIER, UNCALIBRATED, anchorFrom, cvPace,
  durability, prescribe, racePaceMultiplier, withoutAnchor,
} from "../lib/plan/paces";
import {
  ENTRY, LADDERS, canDoStations, ladderFor, rungFor,
} from "../lib/plan/ladders";
import { ZONE_BUDGET, ladderMix, z5Share } from "../lib/plan/zone-budget";

// ------------------------------------------------------------------- paces

test("critical velocity comes off the best 400, not the average", () => {
  // the split is run inside a fatigued circuit, so it already sits near CV
  const rounds = [{ run_time_s: 84 }, { run_time_s: 88 }, { run_time_s: 92 }, { run_time_s: 96 }];
  assert.equal(cvPace(rounds), 210, "84 s per 400 is 3:30 per km");
});

test("the fade is why the benchmark has four rounds instead of one effort", () => {
  const steady = [{ run_time_s: 90 }, { run_time_s: 90 }, { run_time_s: 90 }, { run_time_s: 90 }];
  const fading = [{ run_time_s: 90 }, { run_time_s: 96 }, { run_time_s: 102 }, { run_time_s: 108 }];
  assert.equal(durability(steady), 1);
  assert.equal(durability(fading), 1.2);

  // identical best splits, very different prescriptions — which is correct
  assert.equal(cvPace(steady), cvPace(fading));
  assert.ok(anchorFrom(fading)!.race_pace_s_per_km > anchorFrom(steady)!.race_pace_s_per_km);
});

test("the race-pace multiplier matches the brief's worked numbers", () => {
  assert.equal(DURABILITY_COEFFICIENT, 1.5);
  assert.equal(Math.round(racePaceMultiplier(1.0) * 100) / 100, 1.02, "no fade → CV + 2%");
  assert.equal(Math.round(racePaceMultiplier(1.2) * 100) / 100, 1.32, "a 20% fader → CV + 32%");
});

test("every pace carries the uncalibrated flag until the table is checked", () => {
  // the brief marks these as judgement, not derivation
  const a = anchorFrom([{ run_time_s: 90 }, { run_time_s: 95 }])!;
  assert.ok(a.flags.some((f) => f.code === UNCALIBRATED.code));
  const p = prescribe(a, "threshold", 189, 3, 7);
  assert.equal(p.kind, "pace");
  assert.ok(p.kind === "pace" && p.flags.some((f) => f.code === "paces_uncalibrated"));
});

test("the multipliers are all relative to critical velocity, and ordered", () => {
  assert.equal(RUNG_MULTIPLIER.cv, 1.0);
  assert.ok(RUNG_MULTIPLIER.easy > RUNG_MULTIPLIER.long, "easy is slower than long");
  assert.ok(RUNG_MULTIPLIER.long > RUNG_MULTIPLIER.threshold);
  assert.ok(RUNG_MULTIPLIER.threshold > RUNG_MULTIPLIER.cv);
  assert.ok(RUNG_MULTIPLIER.cv > RUNG_MULTIPLIER.five_k);
  assert.ok(RUNG_MULTIPLIER.five_k > RUNG_MULTIPLIER.neuromuscular, "reps are the fastest");
});

test("with no anchor it is heart rate, and effort only as the floor", () => {
  // week 1 exists before its own benchmark, so a pace there is unearned — but
  // RPE is not the default when a strap can do better
  assert.equal(withoutAnchor(189, 3, 7).kind, "hr");
  assert.equal(withoutAnchor(null, 3, 7).kind, "rpe");
  assert.equal(prescribe(null, "cv", 189, 2, 6).kind, "hr");
  assert.equal(prescribe(null, "cv", null, 2, 6).kind, "rpe");
});

test("an aborted or single-round benchmark yields no anchor at all", () => {
  assert.equal(anchorFrom([]), null);
  assert.equal(anchorFrom([{ run_time_s: 90 }]), null, "one round cannot show a fade");
});

// ----------------------------------------------------------------- ladders

test("entry comes from the running self-assessment", () => {
  assert.equal(ENTRY.doesnt_run.L1, 0, "the bottom of run/walk");
  assert.equal(ENTRY.doesnt_run.L4, undefined, "and no race-pace work at all");
  assert.ok((ENTRY.marathon_competitive.L4 ?? 0) > (ENTRY.runs_regularly.L4 ?? 0));
});

test("the never-runner starts on run/walk and is never handed intervals", () => {
  const r = rungFor("L1", "doesnt_run", 0, "base");
  assert.match(r.label, /3 min run \/ 1 min walk/);
  assert.equal(rungFor("L4", "doesnt_run", 0, "base").rung, 0, "the bottom, if it appears at all");
});

test("a rung climbs every other week, and the phase caps it", () => {
  const base = rungFor("L3", "runs_regularly", 6, "base");
  const specific = rungFor("L3", "runs_regularly", 6, "specific");
  assert.ok(base.rung < specific.rung, "a base week cannot reach the top of the ladder");
  // Six weeks in, climbing every other week from an entry that leaves headroom:
  // near the top of the ladder rather than exactly on it, and the top is reachable
  // from any entry given enough weeks.
  assert.ok(specific.rung >= LADDERS.L3.rungs.length - 2, `${specific.rung}`);
  assert.equal(rungFor("L3", "runs_regularly", 12, "specific").rung,
    LADDERS.L3.rungs.length - 1, "and the top is reachable");
});

test("a phase does not open and close on the same rung", () => {
  /*
   * Weeks one to four of the base phase were the same session every Monday: the
   * athlete's entry rung already sat at the phase cap, so the clamp pinned it and
   * nothing moved. Entering below the cap leaves the phase somewhere to go.
   */
  const across = [0, 1, 2, 3, 4, 5].map((w) => rungFor("L3", "half_marathon_fit", w, "base").rung);
  assert.ok(new Set(across).size > 1, `pinned at ${across.join(", ")}`);
  assert.ok(across[across.length - 1] > across[0], across.join(" → "));
});

const mixOf = (phase: "base" | "build" | "specific" | "taper") =>
  ladderMix(phase, "runs_regularly", true);

test("race-specific work only appears in the phases that have it", () => {
  assert.equal(mixOf("base").L6, undefined, "no simulations in base");
  assert.equal(mixOf("build").L6, undefined);
  assert.ok((mixOf("specific").L6 ?? 0) > 0);
});

test("almost no work above race pace, and none of it outside the build weeks", () => {
  /*
   * The old version of this test exempted the base phase from its own rule —
   * `if (phase !== "base")` — which is how the table came to give L5 forty per cent
   * of the base weeks while the comment above it said L5 was "never a focus". The
   * test had been written to accommodate the bug.
   *
   * A Hyrox has no sprint in it and its shortest run is a kilometre. The top end an
   * athlete needs comes from the strides in every quality warm-up, not from spending
   * one of two weekly hard sessions above race pace.
   */
  assert.equal(z5Share("base"), 0, "a base phase has no business above race pace");
  for (const phase of ["base", "build", "specific", "taper"] as const) {
    assert.ok(z5Share(phase) <= 0.10, `${phase}: ${z5Share(phase) * 100}% above race pace`);
    const mix = mixOf(phase);
    const biggest = Math.max(...Object.values(mix) as number[]);
    assert.ok((mix.L5 ?? 0) < biggest, `${phase}: L5 is never the largest share`);
  }
});

test("every phase's budget adds up, and each says what the phase is for", () => {
  for (const phase of ["base", "build", "specific", "taper"] as const) {
    const b = ZONE_BUDGET[phase];
    const total = b.z3 + b.z4 + b.z5 + b.race;
    assert.ok(Math.abs(total - 1) < 1e-9, `${phase} sums to ${total}`);
  }
  // base builds the ceiling; specific is race-shaped. That is the whole argument.
  assert.ok(ZONE_BUDGET.base.z3 > ZONE_BUDGET.base.z4, "base is threshold-led");
  assert.ok(ZONE_BUDGET.specific.z4 + ZONE_BUDGET.specific.race > 0.6,
    "specific is race pace and stations");
  assert.ok(ZONE_BUDGET.taper.z4 > ZONE_BUDGET.build.z4, "a taper is rehearsal");
});

test("an athlete who does not run is not given threshold intervals", () => {
  /*
   * The old table had no L1 or L2 at any phase, so their quality slot drew from the
   * threshold ladder and their entry rung fell through to zero: "2 × 8 min" at
   * threshold, in week one, for somebody who does not run.
   */
  for (const phase of ["base", "build", "specific", "taper"] as const) {
    const mix = ladderMix(phase, "doesnt_run", true);
    assert.deepEqual(Object.keys(mix).sort(), ["L1", "L2"], `${phase}: ${Object.keys(mix)}`);
    const pick = ladderFor(phase, 0, true, "doesnt_run");
    assert.ok(["L1", "L2"].includes(pick), `${phase} picked ${pick}`);
  }
  // and somebody taking walk breaks gets a little threshold, but not much
  const walk = ladderMix("build", "walk_breaks", true);
  assert.ok((walk.L1 ?? 0) > 0 && (walk.L3 ?? 0) > 0 && (walk.L3 ?? 0) < 0.5);
});

test("ladder choice is deterministic and follows the phase mix", () => {
  const picks = Array.from({ length: 10 }, (_, w) => ladderFor("build", w, true));
  assert.deepEqual(picks, Array.from({ length: 10 }, (_, w) => ladderFor("build", w, true)),
    "same input, same plan");
  const share = (id: string) => picks.filter((p) => p === id).length;
  // build: 40% threshold, 50% race pace, 10% above it — the budget, in sessions
  assert.equal(share("L3"), 4, "40% threshold");
  assert.equal(share("L4"), 5, "50% race pace");
  assert.equal(share("L5"), 1, "10% above it, and only in this phase");
});

test("an athlete with no facility is never given a simulation", () => {
  assert.equal(canDoStations("field"), false);
  const picks = Array.from({ length: 10 }, (_, w) => ladderFor("specific", w, false));
  assert.ok(!picks.includes("L6"), "L6 drops out and the rest take its share");
  assert.equal(picks.length, 10);
});

test("a session never gets easier because a phase changed", () => {
  /*
   * `weeksIn` counts from the start of the phase, so it went back to zero at every
   * boundary: week 9 of the build finished on the top rung and week 10 of the
   * specific phase started again at the bottom of the same ladder. The session got
   * easier because the calendar turned a page.
   */
  const build = rungFor("L3", "runs_regularly", 4, "build", 8).rung;
  const specific = rungFor("L3", "runs_regularly", 0, "specific", 9).rung;
  assert.ok(specific >= build,
    `build reached rung ${build}, specific restarted at ${specific}`);
});

test("the taper is the one phase allowed to go backwards", () => {
  /*
   * At a cap of 1.0 it reached the top of every ladder, and did: the first taper week
   * prescribed 2 × 20 min — forty minutes at threshold, the longest quality session
   * of the block, a fortnight out. Intensity stays; volume comes down.
   */
  const specific = rungFor("L3", "runs_regularly", 3, "specific", 12).rung;
  const taper = rungFor("L3", "runs_regularly", 0, "taper", 13).rung;
  assert.ok(taper < specific, `specific ${specific}, taper ${taper}`);
});

test("the race share belongs to the Hyrox session, not to the interval session", () => {
  /*
   * The quality slot and the Hyrox slot both drew from a mix containing L6, so
   * roughly three in ten race-specific weeks prescribed "Compromised running" as the
   * interval session as well — the same session twice, on consecutive days.
   */
  const running = ladderMix("specific", "runs_regularly", true, true);
  assert.equal(running.L6, undefined, "a running slot never draws a simulation");
  const week = ladderMix("specific", "runs_regularly", true);
  assert.ok((week.L6 ?? 0) > 0, "the week's budget still spends it");

  for (let w = 0; w < 10; w++) {
    assert.notEqual(ladderFor("specific", w, true, "runs_regularly"), "L6");
  }
});
