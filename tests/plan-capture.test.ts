import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DURATION_TOLERANCE, EXPECTED_LAPS, hrFindings, isRunLap,
  mapLaps, timeFindings, type Lap,
} from "../lib/plan/capture";

const lap = (t: number, d: number): Lap => ({ elapsed_time: t, distance: d });
/** A clean eight-lap capture: four 400s alternating with four stations. */
const clean: Lap[] = [
  lap(90, 400), lap(70, 0), lap(93, 400), lap(75, 0),
  lap(96, 400), lap(78, 0), lap(99, 400), lap(80, 0),
];
const PROTOCOL_S = clean.reduce((n, l) => n + l.elapsed_time, 0);

test("odd laps are runs and even laps are stations", () => {
  assert.equal(isRunLap(1), true);
  assert.equal(isRunLap(2), false);
  assert.equal(EXPECTED_LAPS, 8, "four runs plus four stations, one press each");
});

test("a clean capture maps without asking the athlete anything", () => {
  const m = mapLaps(clean, PROTOCOL_S);
  assert.equal(m.ok, true);
  assert.equal(m.needsConfirmation, false);
  assert.equal(m.segments.length, 8);
  assert.deepEqual(m.segments.filter((s) => s.type === "run").map((s) => s.index), [1, 3, 5, 7]);
  // offsets accumulate, so a later segment knows where it sat in the session
  assert.equal(m.segments[0].offset_s, 0);
  assert.equal(m.segments[1].offset_s, 90);
});

test("a missed press is detected rather than silently shifting everything", () => {
  // the failure this exists for: a race simulation recorded run 2 and the sled
  // push as one lap, and every later segment moved by one
  const merged = [lap(90, 400), lap(163, 400), lap(96, 400), lap(78, 0), lap(99, 400), lap(80, 0), lap(70, 0)];
  const m = mapLaps(merged, PROTOCOL_S);
  assert.equal(m.ok, false);
  assert.equal(m.needsConfirmation, true, "one tap resolves it; a guess corrupts everything after");
  assert.ok(m.problems.some((p) => /7 laps recorded against 8/.test(p)));
});

test("a run lap of the wrong distance is named, with the number", () => {
  const short = [...clean];
  short[2] = lap(70, 250);
  const m = mapLaps(short, PROTOCOL_S);
  assert.ok(m.problems.some((p) => /Lap 3/.test(p) && /250 m/.test(p)));
});

test("a session far off the protocol duration is flagged", () => {
  const m = mapLaps(clean, PROTOCOL_S * 2);
  assert.ok(m.problems.some((p) => /against about/.test(p)));
  // and one within tolerance is not
  assert.equal(mapLaps(clean, PROTOCOL_S * (1 + DURATION_TOLERANCE * 0.5)).ok, true);
});

test("even a failed mapping still returns the segments to show the athlete", () => {
  // it renders the laps with inferred labels and asks — it does not refuse
  const m = mapLaps(clean.slice(0, 6), PROTOCOL_S);
  assert.equal(m.needsConfirmation, true);
  assert.equal(m.segments.length, 6, "there is something to confirm against");
});

// ------------------------------------------------------ progressive results

test("everything time-based is available the moment they finish", () => {
  // Strava lags by minutes to hours and the results screen must not wait
  const f = timeFindings(mapLaps(clean, PROTOCOL_S).segments);
  const keys = f.map((x) => x.key);
  assert.ok(keys.includes("best_run_s"));
  assert.ok(keys.includes("durability"));
  assert.ok(keys.includes("pacing_spread"));
  assert.ok(keys.includes("station_total_s"));
  assert.ok(f.every((x) => x.needs === "time"));
});

test("durability is the last run over the first", () => {
  const f = timeFindings(mapLaps(clean, PROTOCOL_S).segments);
  assert.equal(f.find((x) => x.key === "durability")!.value, Math.round((99 / 90) * 1000) / 1000);
});

test("heart-rate findings stay absent until the stream arrives", () => {
  // absent rather than blank: a blank reads as a failure
  assert.deepEqual(hrFindings({ source: "none" }), []);
  assert.deepEqual(hrFindings({ source: "strava" }), [], "named source, no series yet");
  const later = hrFindings({
    source: "strava", series: [{ t_offset_s: 0, bpm: 150 }], max: 181, recovery_60s: 32,
  });
  assert.equal(later.length, 2);
  assert.ok(later.every((x) => x.needs === "hr"));
});

test("four run splits alone still yield three of the seven dimensions", () => {
  // a degraded capture is worth far more than a refused one
  const manual = [90, 93, 96, 99].map((d, i) => ({
    index: i * 2 + 1, type: "run" as const, offset_s: 0, duration_s: d,
    source: "manual" as const,
  }));
  const f = timeFindings(manual).map((x) => x.key);
  assert.ok(f.includes("best_run_s") && f.includes("durability") && f.includes("pacing_spread"));
});
