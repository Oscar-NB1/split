import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_MATRIX, LONG_RUN_SHARE, PROVEN_HEADROOM, RUNNING_CEILING,
  baseFromLongRun, resolve, type ResolveInput,
} from "../lib/plan/resolve";
import { preferMeasured } from "../lib/recent";

const base = (o: Partial<ResolveInput> = {}): ResolveInput => ({
  general_training_age: "advanced",
  hyrox_experience: null,
  running_base: "runs_regularly",
  target_sessions: 6,
  available_days: 6,
  confidence: "estimated",
  ...o,
});

test("what you are already running beats what the matrix guessed", () => {
  // the complaint this exists for: the matrix reads adjectives and said 28 km
  // to someone already running 40
  const matrix = resolve(base());
  assert.equal(matrix.start_volume, BASE_MATRIX.advanced[6]);
  const real = resolve(base({
    recent: { weekly_km: 40, peak_week_km: 44, long_run_km: 16, source: "measured" },
  }));
  assert.equal(real.start_volume, 40);
  assert.ok(real.flags.some((f) => /you are already running that/.test(f)));
});

test("a recent week below the matrix also wins, and says why", () => {
  // it cuts as well as raises — the point is that it is the real number
  const r = resolve(base({
    recent: { weekly_km: 14, long_run_km: 8, source: "measured" },
  }));
  assert.equal(r.start_volume, 14);
  assert.ok(r.flags.some((f) => /where your running actually is/.test(f)));
});

test("nothing recent falls back to the matrix rather than refusing", () => {
  for (const recent of [null, undefined, { weekly_km: null, long_run_km: null, source: "reported" as const }]) {
    assert.equal(resolve(base({ recent })).start_volume, BASE_MATRIX.advanced[6]);
  }
});

// ------------------------------------------------------- the long run as evidence

test("a long run raises the running base, never lowers it", () => {
  assert.equal(baseFromLongRun(19), "half_marathon_fit");
  assert.equal(baseFromLongRun(12), "runs_regularly");
  assert.equal(baseFromLongRun(null), null);

  // an 18 km run out of someone who called themselves a 5 km runner
  const r = resolve(base({
    running_base: "5k_nonstop",
    recent: { weekly_km: null, long_run_km: 19, source: "measured" },
  }));
  assert.ok(r.ceiling !== null && r.ceiling > RUNNING_CEILING["5k_nonstop"]!);
  assert.ok(r.flags.some((f) => /puts your running above what you called it/.test(f)));

  // and a short one out of a marathon runner changes nothing
  const kept = resolve(base({
    running_base: "marathon_competitive",
    recent: { weekly_km: null, long_run_km: 5, source: "measured" },
  }));
  assert.equal(kept.ceiling, RUNNING_CEILING.marathon_competitive);
});

test("a reported week is checked against the long run behind it", () => {
  // 60 km a week behind a 5 km longest run is a mistyped answer
  const r = resolve(base({
    recent: { weekly_km: 60, long_run_km: 5, source: "reported" },
  }));
  assert.equal(r.start_volume, 5 * LONG_RUN_SHARE);
  assert.ok(r.flags.some((f) => /usually a quarter to a third/.test(f)));
});

test("a measured week is never second-guessed", () => {
  // it is the athlete's own arithmetic over their own files; disbelieving it
  // in favour of a rule of thumb would be the wrong way round
  const r = resolve(base({
    recent: { weekly_km: 60, long_run_km: 5, source: "measured" },
  }));
  assert.equal(r.start_volume, 60);
  assert.ok(!r.flags.some((f) => /quarter to a third/.test(f)));
});

// ------------------------------------------------------------------ the peak

test("the peak builds on the biggest week actually completed", () => {
  // an athlete whose weeks swing 20 to 38 has proven 38, not 27
  const r = resolve(base({
    recent: { weekly_km: 27.3, peak_week_km: 38, long_run_km: 19, source: "measured" },
  }));
  assert.equal(r.peak_ceiling, Math.round(27.3 * 2.2 * 10) / 10, "under the cap, so uncapped");
  assert.ok(r.peak_ceiling <= 38 * PROVEN_HEADROOM);
});

test("a block builds on proven volume rather than doubling it", () => {
  const r = resolve(base({
    recent: { weekly_km: 40, peak_week_km: 40, long_run_km: 16, source: "measured" },
  }));
  assert.equal(r.peak_ceiling, Math.round(40 * PROVEN_HEADROOM * 10) / 10);
  assert.ok(r.peak_ceiling < 40 * 2.2, "the multiplier alone would give 88 km");
  assert.ok(r.flags.some((f) => /biggest recent week/.test(f)));
});

test("with nothing recent the peak is unbounded by proof", () => {
  const r = resolve(base());
  assert.equal(r.peak_ceiling, Math.round(r.start_volume * 2.2 * 10) / 10);
});

// ------------------------------------------------------------ measured beats told

test("a record beats a memory, and the two are never blended", () => {
  const measured = { weekly_km: 27.3, long_run_km: 19, source: "measured" as const };
  assert.equal(preferMeasured(measured, { weekly_km: 40, long_run_km: 16 }), measured);

  const told = preferMeasured(null, { weekly_km: 40, long_run_km: 16 });
  assert.deepEqual(told, { weekly_km: 40, long_run_km: 16, source: "reported" });
  assert.equal(preferMeasured(null, { weekly_km: null, long_run_km: null }), null);

  // an empty history does not silently outrank what they told us
  assert.equal(
    preferMeasured({ weekly_km: null, long_run_km: null, source: "measured" },
      { weekly_km: 40, long_run_km: 16 })?.source, "reported");
});
