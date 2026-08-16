import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_MATRIX, RUNNING_CEILING, type ResolveInput, hyroxToAge, olderOf, resolve,
} from "../lib/plan/resolve";
import { deloadWeeks, phases, skeleton } from "../lib/plan/skeleton";

const base = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  general_training_age: "intermediate",
  hyrox_experience: null,
  running_base: "runs_regularly",
  target_sessions: 4,
  available_days: 5,
  confidence: "estimated",
  ...over,
});

// ------------------------------------------------------------------ resolve

test("training age is the higher of the two histories, never the average", () => {
  // someone two years into Hyrox with races behind them is not a novice,
  // whatever they say about general training
  assert.equal(hyroxToAge({ months: 24, sessions_per_week: 3, races_done: 3 }), "elite");
  assert.equal(hyroxToAge({ months: 12, sessions_per_week: 2, races_done: 1 }), "advanced");
  assert.equal(hyroxToAge(null), "novice");
  assert.equal(olderOf("novice", "advanced"), "advanced");
  assert.equal(resolve(base({
    general_training_age: "novice",
    hyrox_experience: { months: 24, sessions_per_week: 3, races_done: 3 },
  })).training_age, "elite");
});

test("the running ceiling beats the base matrix — the case the brief names", () => {
  // gym-strong, cannot run 5k, five days available: must not exceed 15 km in week 1
  const r = resolve(base({
    general_training_age: "advanced", running_base: "walk_breaks",
    target_sessions: 5, available_days: 5, confidence: "measured",
  }));
  assert.equal(r.matrix_volume, 24, "what training age alone would have said");
  assert.equal(r.ceiling, 15);
  assert.equal(r.start_volume, 15, "the ceiling wins");
  assert.ok(r.flags.some((f) => /the running wins/.test(f)));
});

test("every ceiling in the table is enforced", () => {
  for (const [rb, ceiling] of Object.entries(RUNNING_CEILING)) {
    const r = resolve(base({
      general_training_age: "elite", running_base: rb as never,
      target_sessions: 7, confidence: "measured", available_days: 7,
    }));
    if (ceiling == null) assert.equal(r.start_volume, BASE_MATRIX.elite[7], `${rb} uncapped`);
    else assert.ok(r.start_volume <= ceiling, `${rb} capped at ${ceiling}`);
  }
});

test("not knowing has a cost, and it is stated", () => {
  // Reinstated by the intake form after being removed: a benchmark clears the
  // haircut, Strava supplying the volume halves it rather than clearing it, and
  // guessing pays it in full. The tiering is the whole point — see
  // tests/plan-recent.test.ts for the three-way comparison.
  const measured = resolve(base({ confidence: "measured" }));
  const guessed = resolve(base({ confidence: "estimated" }));
  assert.equal(guessed.start_volume, Math.round(measured.start_volume * 0.85 * 10) / 10);
  assert.ok(guessed.flags.some((f) => /under your ceiling/.test(f)));
  assert.ok(!measured.flags.some((f) => /under your ceiling/.test(f)));
});

test("high availability on a low base schedules fewer sessions and flags it", () => {
  // seven days free, novice: the matrix flattens and the athlete is told why
  const r = resolve(base({
    general_training_age: "novice", target_sessions: 7, available_days: 7,
  }));
  assert.equal(BASE_MATRIX.novice[7], BASE_MATRIX.novice[5], "the matrix flattens on purpose");
  assert.ok(r.start_volume <= 12);
});

test("more sessions than days is refused unless doubles are allowed", () => {
  const no = resolve(base({ target_sessions: 6, available_days: 4 }));
  assert.equal(no.sessions, 4);
  assert.ok(no.flags.some((f) => /Without doubles/.test(f)));
  const yes = resolve(base({ target_sessions: 6, available_days: 4, allow_doubles: true }));
  assert.equal(yes.sessions, 6);
});

test("the ramp is the lower of the two, and the dial scales it", () => {
  const r = resolve(base({ general_training_age: "elite", running_base: "walk_breaks" }));
  assert.equal(Math.round(r.ramp_rate * 100), 6, "the running ramp binds");
  const gentle = resolve(base({
    general_training_age: "elite", running_base: "walk_breaks", volume_dial: 0.6,
  }));
  assert.ok(gentle.ramp_rate < r.ramp_rate);
});

test("the peak comes from training age, and from nothing else", () => {
  // the same athlete does not become capable of less by declining to be measured
  for (const confidence of ["measured", "estimated"] as const) {
    const advanced = resolve(base({ confidence, general_training_age: "advanced" }));
    assert.equal(advanced.peak_ceiling, Math.round(advanced.start_volume * 2.2 * 10) / 10);
    const novice = resolve(base({ confidence, general_training_age: "novice" }));
    assert.equal(novice.peak_ceiling, Math.round(novice.start_volume * 1.8 * 10) / 10);
  }
});

// ----------------------------------------------------------------- skeleton

test("deloads go by block length, and match the brief's worked examples", () => {
  // 10 weeks, advanced (block 5): load 1–5, deload 6, load 7–8, taper 9–10
  assert.deepEqual(deloadWeeks(10, 5), [6]);
  // 10 weeks, novice (block 3): deloads at 4 and 8, taper 9–10
  assert.deepEqual(deloadWeeks(10, 3), [4, 8]);
});

test("no run of loading weeks ever exceeds the block", () => {
  for (const length of [6, 8, 10, 12, 15, 20]) {
    for (const block of [3, 4, 5, 6]) {
      const downs = new Set(deloadWeeks(length, block));
      let run = 0;
      for (let w = 1; w <= length - 2; w++) {
        run = downs.has(w) ? 0 : run + 1;
        assert.ok(run <= block, `${length}wk block ${block}: ${run} loading weeks at ${w}`);
      }
    }
  }
});

test("a fixed fourth week would put three low weeks in a ten-week plan", () => {
  // the reason the rule is block length rather than w mod 4
  const fixed = [4, 8].length + 2;         // deloads + taper weeks
  const advanced = deloadWeeks(10, 5).length + 2;
  assert.equal(fixed, 4);
  assert.equal(advanced, 3, "one fewer low week for someone who can take five");
});

test("the taper absorbs the final down week where the block allows", () => {
  // advanced has room, so nothing sits next to the taper
  assert.ok(!deloadWeeks(10, 5).includes(8), "no deload adjacent to the taper");
  // novice does not have room, and the block constraint wins — four loading
  // weeks on someone who can take three is the bigger mistake
  assert.ok(deloadWeeks(10, 3).includes(8));
});

test("phases are 30/30/25/15 and always add up", () => {
  for (const length of [6, 8, 10, 12, 15, 20, 24]) {
    const { phases: p } = phases(length);
    assert.equal(p.length, length, `${length} weeks`);
    assert.equal(p[p.length - 1], "taper", `${length}: ends in taper`);
    for (const name of ["base", "build", "specific", "taper"]) {
      assert.ok(p.includes(name as never), `${length}: has a ${name} phase`);
    }
  }
});

test("under six weeks there is no base phase, and it is flagged", () => {
  const { phases: p, flags } = phases(4);
  assert.ok(!p.includes("base"));
  assert.ok(flags.some((f) => /too short for a base phase/.test(f)));
});

test("the curve rises, tapers, and never exceeds the peak ceiling", () => {
  const r = resolve(base({ general_training_age: "advanced", confidence: "measured" }));
  const { weeks } = skeleton(r, 12);
  assert.equal(weeks.length, 12);
  assert.equal(weeks[0].km, r.start_volume);
  for (const w of weeks) assert.ok(w.km <= r.peak_ceiling + 0.1, `week ${w.n} within the ceiling`);
  assert.ok(weeks[11].km < weeks[9].km, "race week is the smallest");
  assert.equal(weeks[11].note, "Race week");
});

test("a deload does not reset the climb", () => {
  const r = resolve(base({ general_training_age: "novice" }));
  const { weeks } = skeleton(r, 12);
  const downs = weeks.filter((w) => w.deload).map((w) => w.n);
  assert.ok(downs.length > 0);
  for (const n of downs) {
    const after = weeks.find((w) => w.n === n + 1 && !w.deload && !w.taper);
    const before = weeks.find((w) => w.n === n - 1);
    if (after && before) {
      assert.ok(after.km > before.km, `week ${n + 1} resumes above week ${n - 1}`);
    }
  }
});

test("race week is at most 40% of peak, even though the taper factor says 45%", () => {
  // The brief gives taper 0.45 for the last week and asserts race week is at most
  // 40% of peak. Off a peak reached in the last loading week those disagree, and
  // the assertion wins — a plan that fails one is never shipped.
  for (const age of ["novice", "advanced"] as const) {
    const r = resolve(base({ general_training_age: age, confidence: "measured" }));
    const { weeks } = skeleton(r, 12);
    const peak = Math.max(...weeks.map((w) => w.km));
    assert.ok(weeks[11].km <= peak * 0.4 + 0.1, `${age}: ${weeks[11].km} of ${peak}`);
  }
});

test("loading weeks never rise faster than the ramp", () => {
  // Between LOADING weeks: coming out of a down week is a large rise by design,
  // and comparing a deload to the week after it measures the deload, not the ramp.
  const r = resolve(base({ general_training_age: "elite", confidence: "measured" }));
  const { weeks } = skeleton(r, 16);
  const loading = weeks.filter((w) => !w.deload && !w.taper);
  for (let i = 1; i < loading.length; i++) {
    const rise = loading[i].km / loading[i - 1].km - 1;
    assert.ok(rise <= r.ramp_rate + 0.02,
      `week ${loading[i].n} rose ${(rise * 100).toFixed(1)}% over week ${loading[i - 1].n}`);
  }
});

test("the never-runner archetype peaks under 15 km", () => {
  const r = resolve(base({
    general_training_age: "novice", running_base: "doesnt_run",
    target_sessions: 3, available_days: 3,
  }));
  const { weeks } = skeleton(r, 12);
  assert.ok(Math.max(...weeks.map((w) => w.km)) < 15, "peak stays under 15 km");
});
