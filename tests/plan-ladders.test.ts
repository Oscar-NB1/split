import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DURABILITY_COEFFICIENT, RUNG_MULTIPLIER, UNCALIBRATED, anchorFrom, cvPace,
  durability, prescribe, racePaceMultiplier, withoutAnchor,
} from "../lib/plan/paces";
import {
  ENTRY, LADDERS, PHASE_MIX, canDoStations, ladderFor, rungFor,
} from "../lib/plan/ladders";

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

test("race-specific work only appears in the phases that have it", () => {
  assert.equal(PHASE_MIX.base.L6, undefined, "no simulations in base");
  assert.equal(PHASE_MIX.build.L6, undefined);
  assert.ok((PHASE_MIX.specific.L6 ?? 0) > 0);
});

test("L5 is maintenance, never a focus", () => {
  // an athlete already running 400s at 3:39 needs threshold, not more top end
  for (const phase of ["base", "build", "specific", "taper"] as const) {
    const mix = PHASE_MIX[phase];
    const l5 = mix.L5 ?? 0;
    const biggest = Math.max(...Object.values(mix));
    assert.ok(l5 <= biggest, `${phase}: L5 at ${l5} against a peak of ${biggest}`);
    if (phase !== "base") assert.ok(l5 < biggest, `${phase}: and never the largest share`);
  }
});

test("ladder choice is deterministic and follows the phase mix", () => {
  const picks = Array.from({ length: 10 }, (_, w) => ladderFor("build", w, true));
  assert.deepEqual(picks, Array.from({ length: 10 }, (_, w) => ladderFor("build", w, true)),
    "same input, same plan");
  const l3 = picks.filter((p) => p === "L3").length;
  const l4 = picks.filter((p) => p === "L4").length;
  const l5 = picks.filter((p) => p === "L5").length;
  assert.equal(l3, 4, "40%");
  assert.equal(l4, 4, "40%");
  assert.equal(l5, 2, "20%");
});

test("an athlete with no facility is never given a simulation", () => {
  assert.equal(canDoStations("field"), false);
  const picks = Array.from({ length: 10 }, (_, w) => ladderFor("specific", w, false));
  assert.ok(!picks.includes("L6"), "L6 drops out and the rest take its share");
  assert.equal(picks.length, 10);
});
