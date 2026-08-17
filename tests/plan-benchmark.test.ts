import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BENCHMARK_NOTE, PROTOCOL_VERSION, ROUNDS,
  anchorOf, benchmarkTarget, fadeOf, planLines, protocolFor,
} from "../lib/plan/benchmark";
import { EXPECTED_LAPS, RUN_DISTANCE_M } from "../lib/plan/capture";
import { RULES, changes, read } from "../lib/plan/findings";
import { kitFrom } from "../lib/plan/strength";
import { parseSteps } from "../lib/prescription";

/**
 * The benchmark's missing middle.
 *
 * Everything around it was built and never joined up: a preflight page rendered with
 * `protocol={null}`, a results screen over an empty table, an `anchorFrom(rounds)` nothing
 * had ever called, and an "Apply to the block" button that wrote a timestamp. What these
 * hold is the joins — that the protocol matches the lap count the capture layer expects,
 * that the numbers a test produces reach the plan, and that every line of the diff has a
 * reason behind it.
 */

const KIT = kitFrom(["Sled — race weight", "SkiErg", "Rower", "Kettlebells"]);
const LOADS = {
  sled_push_total_kg: 152, sled_pull_total_kg: 103,
  farmers_kg: 24, lunge_kg: 20, wall_ball_kg: 6,
};

/** A plausible test: 400s at 1:38 fading to 1:47. */
const ROUNDS_4 = [
  { run_s: 98, distance_m: 400, station_s: 132 },
  { run_s: 101, distance_m: 400, station_s: 138 },
  { run_s: 104, distance_m: 400, station_s: 145 },
  { run_s: 107, distance_m: 400, station_s: 151 },
];

test("the protocol has exactly the laps the capture layer counts", () => {
  /*
   * These two numbers have to agree or `mapLaps` reports a missed press on a clean test.
   * They lived in different files and nothing tied them together.
   */
  const p = protocolFor(KIT, LOADS, 300);
  assert.equal(p.legs.length, EXPECTED_LAPS);
  assert.equal(ROUNDS * 2, EXPECTED_LAPS);
  assert.equal(p.legs.filter((l) => /^Run \d/.test(l.label)).length, ROUNDS);
  /* Run first, station second, alternating: what "odd laps are runs" on the page means. */
  p.legs.forEach((l, i) => {
    assert.equal(/^Run \d/.test(l.label), i % 2 === 0, `leg ${i + 1}: ${l.label}`);
  });
});

test("the same athlete gets the same test twice", () => {
  /*
   * A benchmark's only job is to be comparable to itself. A protocol that drifted with the
   * block would measure a different thing each time and the fade across four rounds — the
   * finding that actually changes the plan — would mean nothing across two tests.
   */
  assert.deepEqual(protocolFor(KIT, LOADS, 300), protocolFor(KIT, LOADS, 300));
});

test("no sled is still a test, with the substitution stated", () => {
  const p = protocolFor(kitFrom(["SkiErg", "Rower"]), LOADS, 300);
  assert.equal(p.legs.length, EXPECTED_LAPS);
  assert.equal(p.variant, "no_sled", "and it is recorded as a different variant");
  assert.ok(p.legs.some((l) => /substituted/i.test(l.label)),
    "an athlete with no sled is told what to do instead rather than silently given a gap");
});

test("the prescription parses as a session", () => {
  const target = benchmarkTarget(protocolFor(KIT, LOADS, 300));
  const steps = parseSteps(target);
  assert.ok(steps.length > 0, "the app cannot read its own benchmark");
  assert.match(target, new RegExp(`${RUN_DISTANCE_M}m Z4`));
  /* Station loads in the same wording a Hyrox session uses, not a second format. */
  assert.match(target, /25 m Sled push at 152 kg total/);
  assert.ok(BENCHMARK_NOTE.includes("eight presses"));
});

test("a lap that measured 380 m is not read as a 400", () => {
  /*
   * Scaling flatters or penalises the pace by more than the width of a band, so a short GPS
   * lap is scaled to the protocol distance rather than taken at face value.
   */
  const short = anchorOf(ROUNDS_4.map((r) => ({ ...r, distance_m: 380 })))!;
  const exact = anchorOf(ROUNDS_4)!;
  assert.ok(short.cv_pace_s_per_km > exact.cv_pace_s_per_km,
    "the same times over a shorter lap is a slower pace, not the same one");
});

test("a hand-timed round with no distance is trusted rather than guessed at", () => {
  const byHand = anchorOf(ROUNDS_4.map(({ run_s, station_s }) => ({ run_s, station_s })));
  assert.ok(byHand, "a stopwatch test is a test");
  assert.equal(byHand!.cv_pace_s_per_km, anchorOf(ROUNDS_4)!.cv_pace_s_per_km);
});

test("one round measures nothing, because fade needs a first and a last", () => {
  assert.equal(anchorOf([ROUNDS_4[0]]), null);
  assert.equal(fadeOf([ROUNDS_4[0]]), null);
  /* And the reading layer agrees, which is where the two-round floor comes from. */
  assert.equal(read({
    athlete_id: "x", protocol_version: PROTOCOL_VERSION, variant: "full", submaximal: false,
    started_at: "2026-08-17T09:00:00Z",
    segments: [{ index: 1, type: "run", offset_s: 0, duration_s: 98, source: "manual" }],
    hr: { source: "none" }, completion: { aborted: false },
  }).length, 0);
});

test("every line of the plan diff has a reason behind it", () => {
  /*
   * `changes()` looks each label up in RULES to find why it moved. A label that is not in
   * that table produces a row with no explanation, which is the one thing the results screen
   * must not show — it is the whole reason the screen exists.
   */
  const after = planLines(anchorOf(ROUNDS_4), fadeOf(ROUNDS_4));
  assert.ok(Object.keys(after).length > 0);
  for (const label of Object.keys(after)) {
    assert.ok(RULES[label], `"${label}" has no rule behind it`);
  }
});

test("the long run's pace waits for the fade to flatten", () => {
  const heavy = [
    { run_s: 98, station_s: 130 }, { run_s: 104, station_s: 140 },
    { run_s: 112, station_s: 150 }, { run_s: 121, station_s: 160 },
  ];
  const fade = fadeOf(heavy)!;
  assert.ok(fade > 1.12, `${fade} should be a heavy fade`);
  assert.equal(planLines(anchorOf(heavy), fade)["Long run pace"], undefined,
    "distance is not bought with form — the screen states this rule, so it has to be one");

  const light = planLines(anchorOf(ROUNDS_4), fadeOf(ROUNDS_4));
  assert.ok(light["Long run pace"], "and it moves once the curve flattens");
});

test("a test moves the paces it measured, and says which", () => {
  const before = { "Key session pace": "4:29/km", "Easy run pace": "5:50/km" };
  const after = planLines(anchorOf(ROUNDS_4), fadeOf(ROUNDS_4));
  const capture = {
    athlete_id: "x", protocol_version: PROTOCOL_VERSION, variant: "full",
    submaximal: false, started_at: "2026-08-17T09:00:00Z",
    segments: ROUNDS_4.flatMap((r, i) => [
      { index: i * 2 + 1, type: "run" as const, offset_s: 0, duration_s: r.run_s,
        distance_m: r.distance_m, source: "manual" as const },
      { index: i * 2 + 2, type: "station" as const, offset_s: 0, duration_s: r.station_s,
        source: "manual" as const },
    ]),
    hr: { source: "none" as const }, completion: { aborted: false },
  };
  const diff = changes(before, after, read(capture));
  assert.ok(diff.length >= 2, "a measured test that changes nothing has not been read");
  const key = diff.find((c) => c.label === "Key session pace")!;
  assert.ok(key, "the key session pace is the line a speed measurement moves");
  assert.notEqual(key.before, key.after);
  assert.ok(key.rule.length > 0, "and it carries the rule that moved it");
});

test("an unchanged line is not in the diff", () => {
  const after = planLines(anchorOf(ROUNDS_4), fadeOf(ROUNDS_4));
  assert.deepEqual(changes(after, after, []), [],
    "a diff of fourteen rows where seven agree buries the seven that matter");
});
