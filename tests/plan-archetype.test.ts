import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capture, Segment } from "../lib/plan/capture";
import { ARCHETYPES, archetypeOf, confidenceOf, recompute } from "../lib/plan/archetype";
import { read } from "../lib/plan/findings";

function capture(o: {
  runs: number[]; stations?: number[];
  aborted?: boolean; submaximal?: boolean; variant?: string;
}): Capture {
  const segments: Segment[] = [];
  let t = 0, i = 1;
  o.runs.forEach((r, n) => {
    segments.push({ index: i++, type: "run", offset_s: t, duration_s: r, source: "app_timer" });
    t += r;
    if (o.stations?.[n] !== undefined) {
      segments.push({ index: i++, type: "station", offset_s: t, duration_s: o.stations[n], source: "app_timer" });
      t += o.stations[n];
    }
  });
  return {
    athlete_id: "a", protocol_version: 1, variant: o.variant ?? "full",
    submaximal: o.submaximal ?? false, started_at: "2026-08-19T09:00:00Z",
    segments, hr: { source: "none" }, completion: { aborted: o.aborted ?? false },
  };
}
const at = "2026-08-20T10:00:00Z";
const of = (c: Capture) => archetypeOf(c, "b1", at);

test("no benchmark, no archetype", () => {
  // a self-reported 5 km cannot locate a limiter, and intake answers produce
  // neither durability nor pacing — so the honest answer is nothing
  assert.equal(archetypeOf(null, "b1", at), null);
  assert.equal(archetypeOf(capture({ runs: [240, 250] }), null, at), null);
});

test("runs giving way with heavy fade is a thin engine", () => {
  // paced evenly and still faded — see the known-defect test for why a
  // monotonic fade cannot reach this label
  const a = of(capture({ runs: [255, 235, 238, 310], stations: [220, 222, 224, 226] }))!;
  assert.equal(a.type, "thin_engine");
  assert.equal(a.confidence, "high");
  assert.deepEqual(a.contributing, ["Limiter", "Durability"]);
});

test("stations giving way while pace holds is a strong runner", () => {
  const a = of(capture({ runs: [240, 244, 248, 252], stations: [220, 250, 280, 310] }))!;
  assert.equal(a.type, "strong_runner");
});

test("no dominant limiter splits on durability alone", () => {
  const good = of(capture({ runs: [240, 244, 248, 252], stations: [220, 224, 228, 232] }))!;
  assert.equal(good.type, "even_keel");
  const bad = of(capture({ runs: [255, 235, 238, 310], stations: [231, 213, 216, 281] }))!;
  assert.equal(bad.type, "both_ends");
});

test("pacing wins when more than one condition matches", () => {
  // cheapest thing to correct, most expensive to leave uncorrected
  const c = capture({ runs: [200, 250, 265, 275], stations: [220, 222, 224, 226] });
  const rs = read(c);
  assert.equal(rs.find((r) => r.dim === "Pacing")!.band, "positive splitter");
  assert.equal(rs.find((r) => r.dim === "Limiter")!.band, "aerobic");
  assert.ok(275 / 200 >= 1.20, "thin_engine also matches");
  assert.equal(of(c)!.type, "fast_start");
});

test("nothing matching is even_keel at low confidence, never null", () => {
  // aerobic limiter, evenly paced, fade between 1.12 and 1.20: no condition
  const a = of(capture({ runs: [255, 238, 242, 292], stations: [220, 222, 224, 226] }))!;
  assert.equal(a.type, "even_keel");
  assert.equal(a.confidence, "low", "it is a fallback, and says so");
});

// -------------------------------------------------------------- confidence

test("a test that cannot support the label says so", () => {
  assert.equal(confidenceOf(capture({ runs: [240, 250, 260, 270], submaximal: true })), "low");
  assert.equal(confidenceOf(capture({ runs: [240, 250, 260, 270], aborted: true })), "low");
  assert.equal(confidenceOf(capture({ runs: [240, 250, 260, 270], variant: "field" })), "low");
  assert.equal(confidenceOf(capture({ runs: [240, 250, 260, 270] }), true), "low",
    "substituted equipment is not comparable across variants");
  assert.equal(confidenceOf(capture({ runs: [240, 250, 260, 270] })), "high");
});

// ---------------------------------------------------------------- recompute

test("the station half is frozen for the life of the block", () => {
  // limiter compares run degradation with station degradation, and nothing
  // after the benchmark measures stations
  const a = of(capture({ runs: [240, 260, 285, 300], stations: [220, 222, 224, 226] }))!;
  const later = "2026-10-01T10:00:00Z";
  const { archetype } = recompute(a, { durability: "good", pacing: "even" }, later);

  assert.deepEqual(archetype.dimensions.limiter, a.dimensions.limiter);
  assert.equal(archetype.dimensions.limiter!.source, "benchmark");
  assert.equal(archetype.dimensions.limiter!.as_of, a.dimensions.limiter!.as_of);

  assert.equal(archetype.dimensions.durability!.source, "key_sessions");
  assert.equal(archetype.dimensions.durability!.as_of, later);
  assert.equal(archetype.dimensions.pacing!.value, "even");
});

test("a recompute with nothing new leaves the dimensions alone", () => {
  const a = of(capture({ runs: [240, 244, 248, 252], stations: [220, 224, 228, 232] }))!;
  const { archetype } = recompute(a, {}, "2026-10-01T10:00:00Z");
  assert.deepEqual(archetype.dimensions, a.dimensions);
});

// ------------------------------------------------ the validation that matters

test("every type derives as itself where its condition is genuinely met", () => {
  // thin_engine and both_ends need a shape where round 1 is NOT quick relative
  // to the rest — see the unreachability test below for why that is hard
  const cases: Record<string, Capture> = {
    thin_engine: capture({ runs: [255, 235, 238, 310], stations: [220, 222, 224, 226] }),
    fast_start: capture({ runs: [200, 250, 265, 275], stations: [220, 222, 224, 226] }),
    strong_runner: capture({ runs: [240, 244, 248, 252], stations: [220, 250, 280, 310] }),
    even_keel: capture({ runs: [240, 244, 248, 252], stations: [220, 224, 228, 232] }),
    both_ends: capture({ runs: [255, 235, 238, 310], stations: [231, 213, 216, 281] }),
  };
  for (const [expected, c] of Object.entries(cases)) {
    assert.equal(of(c)!.type, expected, `${expected} derives as itself`);
  }
  assert.equal(Object.keys(cases).length, ARCHETYPES.length, "every type is reachable");
});

test("no two types describe the same set of plan changes", () => {
  // the brief's own validation: two types with identical effects are one type
  // with two names
  const cases: Record<string, Capture> = {
    thin_engine: capture({ runs: [255, 235, 238, 310], stations: [220, 222, 224, 226] }),
    fast_start: capture({ runs: [200, 250, 265, 275], stations: [220, 222, 224, 226] }),
    strong_runner: capture({ runs: [240, 244, 248, 252], stations: [220, 250, 280, 310] }),
    even_keel: capture({ runs: [240, 244, 248, 252], stations: [220, 224, 228, 232] }),
    both_ends: capture({ runs: [255, 235, 238, 310], stations: [231, 213, 216, 281] }),
  };
  const shapes = new Map<string, string>();
  for (const [name, c] of Object.entries(cases)) {
    const shape = read(c).map((r) => `${r.dim}:${r.effect}`).sort().join("|");
    for (const [other, seen] of shapes) {
      assert.notEqual(shape, seen, `${name} and ${other} would change the same things`);
    }
    shapes.set(name, shape);
  }
});

test("KNOWN DEFECT: an evenly fading athlete always reads as fast_start", () => {
  /*
   * Fade and front-loading are not independent. Front-loading is measured as
   * round 1 against the mean of the rest, and for any monotonic decay that
   * quantity is positive by construction — a perfectly even fade of 5% already
   * bands as "front-loaded".
   *
   * So with fade >= 1.12 the fast_start condition is satisfied too, and
   * precedence gives it the label. thin_engine and both_ends are only reachable
   * on a negative-split-then-collapse shape, which is not what either is meant
   * to describe.
   *
   * This test pins the behaviour rather than asserting it is right. Fixing it
   * means measuring round 1 against the trend rather than against the mean of
   * the rest, which changes findings.ts and therefore the plan — outside this
   * brief's "no generator changes".
   */
  for (const fade of [1.12, 1.20, 1.30]) {
    const runs = [0, 1, 2, 3].map((k) => Math.round(240 * (1 + (k / 3) * (fade - 1))));
    const a = of(capture({ runs, stations: [220, 222, 224, 226] }))!;
    assert.equal(a.type, "fast_start", `fade ${fade} is labelled fast_start`);
  }
  // and the aerobic limiter it also has is still visible in the dimensions,
  // so nothing is lost — only the headline word is arguable
  const a = of(capture({ runs: [240, 256, 272, 288], stations: [220, 222, 224, 226] }))!;
  assert.equal(a.dimensions.limiter!.value, "aerobic");
  assert.equal(a.dimensions.durability!.value, "heavy");
});

test("the order is precedence, not a ranking", () => {
  // even_keel is not a goal state, and nothing may present it as the best one
  assert.equal(ARCHETYPES.length, new Set(ARCHETYPES).size);
  const a = of(capture({ runs: [240, 244, 248, 252], stations: [220, 224, 228, 232] }))!;
  assert.ok(!("rank" in a) && !("score" in a));
});
