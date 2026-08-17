import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_MATRIX, LONG_RUN_SHARE, PEAK_OVER_BRACKET,
  PROVEN_HEADROOM, RUNNING_CEILING, baseFromLongRun, resolve, type ResolveInput,
} from "../lib/plan/resolve";
import { preferMeasured, __weekKeyForTest as weekKey } from "../lib/recent";

const base = (o: Partial<ResolveInput> = {}): ResolveInput => ({
  general_training_age: "advanced",
  hyrox_experience: null,
  running_base: "half_marathon_fit",
  target_sessions: 6,
  available_days: 6,
  confidence: "estimated",
  ...o,
});
const strava = (peak: number | null, long: number | null) =>
  ({ peak_week_km: peak, long_run_km: long, source: "measured" as const });

// ------------------------------------------- the peak week is what week 1 uses

test("week 1 is built from the biggest recent week, not the bracket", () => {
  const bracket = BASE_MATRIX.advanced[6];
  const r = resolve(base({ recent: strava(38, 19) }));
  // 38 is inside 1.6x the bracket, so it stands, undiscounted
  assert.equal(r.start_volume, 38);
  assert.ok(r.start_volume > bracket, "a real 38 km week beats a 28 km guess");
});

test("one enormous week is evidence, but only so far", () => {
  // a race week inside an otherwise quiet block is not a base to build from
  const bracket = BASE_MATRIX.advanced[6];
  const r = resolve(base({ recent: strava(90, 30) }));
  assert.equal(r.start_volume, Math.round(bracket * PEAK_OVER_BRACKET));
  assert.ok(r.flags.some((f) => /as far above your training bracket as one week/.test(f)));
});

test("a peak week below the bracket is still the number used", () => {
  const r = resolve(base({ recent: strava(12, 8) }));
  assert.ok(r.start_volume < BASE_MATRIX.advanced[6]);
  assert.ok(r.flags.some((f) => /rather than the .* the bracket suggested/.test(f)));
});

test("nothing at all starts below the bracket and builds towards it", () => {
  /*
   * The bracket was being used as both the start and the ceiling, so an athlete who left
   * both volume questions blank got a flat block — ten weeks of the same week, for
   * somebody whose whole problem is that they have never built up. With no evidence the
   * bracket describes where they could get to, not where they are.
   */
  /*
   * The discount applies to somebody new to running, not to anyone who skipped a question:
   * an athlete who calls themselves marathon-competitive has given evidence in the
   * description itself.
   */
  const bracket = 15;
  for (const recent of [null, undefined, strava(null, null)]) {
    const r = resolve(base({ recent, running_base: "walk_breaks" }));
    assert.ok(r.start_volume < bracket, `${r.start_volume} against a bracket of ${bracket}`);
    assert.ok(r.start_volume >= bracket * 0.55, "and not so low it is a different athlete");
    assert.ok(r.peak_ceiling > r.start_volume, "so there is somewhere to build to");
    assert.ok(r.flags.some((f) => /have not given a weekly volume/.test(f)),
      "and it says why rather than being quietly cautious");
  }
  // One number of their own is better evidence, and is used instead.
  assert.equal(
    resolve(base({ recent: strava(bracket, 8), running_base: "walk_breaks" })).start_volume,
    bracket);
});

// -------------------------------------------- the long run caps, it never lifts

test("the longest run caps the week whatever the athlete called themselves", () => {
  // 8 km longest run does not support a 30 km week, however experienced
  const r = resolve(base({ running_base: "marathon_competitive", recent: strava(40, 8) }));
  assert.equal(r.ceiling, Math.round(8 * LONG_RUN_SHARE));
  assert.ok(r.flags.some((f) => /does not yet support more than that in a week/.test(f)));
});

test("a long run raises the running base, never lowers it", () => {
  assert.equal(baseFromLongRun(19), "half_marathon_fit");
  assert.equal(baseFromLongRun(12), "runs_regularly");
  assert.equal(baseFromLongRun(null), null);

  const r = resolve(base({ running_base: "5k_nonstop", recent: strava(30, 19) }));
  assert.ok(r.flags.some((f) => /puts your running above what you called it/.test(f)));
  assert.ok(r.ceiling! > RUNNING_CEILING["5k_nonstop"]!);
});

test("the tighter of the two ceilings wins", () => {
  // stated base says 45, a 10 km long run says 32 — the run is the binding one
  const r = resolve(base({ running_base: "half_marathon_fit", recent: strava(60, 10) }));
  assert.equal(r.ceiling, 32);
});

// ------------------------------------------------ not knowing has a stated cost

test("nothing is discounted for not having been benchmarked", () => {
  // removed twice — once on instruction, once after the intake form put it back
  const measured = resolve(base({ confidence: "measured", recent: strava(38, 19) }));
  const stravaOnly = resolve(base({ recent: strava(38, 19) }));
  const guessed = resolve(base({
    recent: { peak_week_km: 38, long_run_km: 19, source: "reported" },
  }));

  assert.equal(measured.start_volume, 38);
  assert.equal(stravaOnly.start_volume, 38, "Strava pays no margin");
  assert.equal(guessed.start_volume, 38, "and neither does a typed-in number");
  for (const r of [measured, stravaOnly, guessed]) {
    assert.ok(!r.flags.some((f) => /under your ceiling/.test(f)));
  }
});

test("the ramp is not tiered by measurement either", () => {
  const ramp = (o: Partial<ResolveInput>) => resolve(base(o)).ramp_rate;
  assert.equal(ramp({ confidence: "measured", recent: strava(38, 19) }),
               ramp({ recent: { peak_week_km: 38, long_run_km: 19, source: "reported" } }));
});

// ------------------------------------------------------------------ the peak

test("a block builds on proven volume rather than doubling it", () => {
  const r = resolve(base({ confidence: "measured", recent: strava(40, 19) }));
  assert.equal(r.peak_ceiling, Math.round(40 * PROVEN_HEADROOM * 10) / 10);
  assert.ok(r.peak_ceiling < 40 * 2.2, "the multiplier alone would give 88 km");
  assert.ok(r.flags.some((f) => /biggest recent week/.test(f)));
});

test("with nothing recent the peak is unbounded by proof", () => {
  // Across a long block, where the training-age multiplier is what binds rather than the
  // number of loading weeks available to climb through.
  const r = resolve(base({ block_weeks: 30 }));
  assert.equal(r.peak_ceiling, Math.round(r.start_volume * 2.2 * 10) / 10);
});

// ------------------------------------------------------------ measured beats told

test("a record beats a memory, and the two are never blended", () => {
  const measured = strava(38, 19);
  assert.equal(preferMeasured(measured, { peak_week_km: 50, long_run_km: 16 }), measured);

  const told = preferMeasured(null, { peak_week_km: 50, long_run_km: 16 });
  assert.deepEqual(told, { peak_week_km: 50, long_run_km: 16, source: "reported" });
  assert.equal(preferMeasured(null, { peak_week_km: null, long_run_km: null }), null);

  // an empty history does not silently outrank what they told us
  assert.equal(
    preferMeasured(strava(null, null), { peak_week_km: 50, long_run_km: 16 })?.source,
    "reported");
});

test("the week key agrees with what the database buckets by", () => {
  // both paths bucket Monday-first; if they disagreed, the same athlete would
  // get a different week 1 depending on whether their history had imported yet
  assert.equal(weekKey(new Date("2026-08-16T22:00:00")), "2026-08-10");
  assert.equal(weekKey(new Date("2026-08-10T06:00:00")), "2026-08-10");
  assert.equal(weekKey(new Date("2026-08-17T06:00:00")), "2026-08-17");
});

test("a race on the calendar raises the ceiling; general fitness does not", () => {
  /*
   * A Hyrox contains eight kilometres of running. A 15 km ceiling makes race day more than
   * half of the biggest week the plan will ever allow — which is not caution, it is a plan
   * that cannot get its athlete to the start line.
   */
  const fitness = resolve(base({ running_base: "walk_breaks", has_race: false }));
  const racing = resolve(base({ running_base: "walk_breaks", has_race: true }));
  assert.equal(fitness.ceiling, 15, "training to be fit keeps the protective ceiling");
  assert.ok(racing.ceiling! >= 28, `${racing.ceiling} km with a race on the calendar`);
  assert.ok(racing.peak_ceiling > fitness.peak_ceiling, "and the block can reach further");

  // The ramp still governs how fast anybody gets there.
  assert.equal(racing.ramp_rate, fitness.ramp_rate, "the roof moved, not the climb");
});

test("somebody who does not run at all is still told the truth", () => {
  // Raising the roof must not turn into ambition for an athlete ten weeks from a race with
  // no running behind them.
  const r = resolve(base({ running_base: "doesnt_run", has_race: true }));
  assert.ok(r.ceiling! <= 20, `${r.ceiling} km for somebody who does not run`);
});
