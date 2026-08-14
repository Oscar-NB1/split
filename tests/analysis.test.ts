import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySegments, decodePolyline, downsample, hms, pace, statsFor,
  type LapRow,
} from "../lib/analysis";
import { encodePolyline } from "../lib/map";

/**
 * The lap fixtures below are real rows from the database, not invented ones.
 * `intervals` is a 10x300m session; `steady` is the same distance auto-lapped
 * every kilometre. The classifier has to separate those two without being told
 * which is which, so both need to be here.
 */
const lap = (i: number, m: number, sec: number, hr: number, maxHr = hr + 6): LapRow => ({
  lap_index: i, name: `Lap ${i}`, distance_m: m, moving_seconds: sec,
  elapsed_seconds: sec, avg_speed_ms: m / sec, max_speed_ms: null,
  avg_hr: hr, max_hr: maxHr,
});

// 1km warmup, 10x300m with 150s floats, 1km cooldown, and the stop-and-save stub
const intervals: LapRow[] = [
  lap(1, 1000, 364, 134),
  lap(2, 300, 69, 160), lap(3, 448, 150, 154),
  lap(4, 300, 68, 164), lap(5, 444, 150, 157),
  lap(6, 300, 69, 165), lap(7, 441, 150, 158),
  lap(8, 300, 70, 166), lap(9, 441, 150, 163),
  lap(10, 300, 70, 169), lap(11, 448, 150, 163),
  lap(12, 300, 70, 172), lap(13, 431, 150, 164),
  lap(14, 300, 67, 173), lap(15, 432, 150, 167),
  lap(16, 300, 69, 173), lap(17, 437, 150, 168),
  lap(18, 300, 66, 174), lap(19, 404, 150, 166),
  lap(20, 300, 61, 178, 186), lap(21, 1000, 358, 164),
  lap(22, 9, 6, 159),
];

// an auto-lapped steady run: every lap the same kilometre, small speed spread
const steady: LapRow[] = [
  lap(1, 1000, 300, 148), lap(2, 1000, 296, 152), lap(3, 1000, 305, 153),
  lap(4, 1000, 298, 155), lap(5, 1000, 292, 157), lap(6, 1000, 301, 156),
];

test("an interval session is recognised as one", () => {
  const { isIntervals } = classifySegments(intervals);
  assert.equal(isIntervals, true);
});

test("a steady run auto-lapped every km is NOT called intervals", () => {
  // the failure mode this guards: every km of an easy run reported as a "rep"
  const { isIntervals, segments } = classifySegments(steady);
  assert.equal(isIntervals, false);
  assert.ok(segments.every((s) => s.role === "steady"));
});

test("the ten work reps are found, and the floats are not among them", () => {
  const { segments } = classifySegments(intervals);
  const work = segments.filter((s) => s.role === "work");
  assert.equal(work.length, 10);
  assert.deepEqual(work.map((w) => w.lap_index), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  // every rep was the programmed 300m; no float leaked in
  assert.ok(work.every((w) => w.distance_m === 300));
});

test("warm-up and cool-down are separated from the recoveries", () => {
  const { segments } = classifySegments(intervals);
  assert.equal(segments.find((s) => s.lap_index === 1)!.role, "warmup");
  assert.equal(segments.find((s) => s.lap_index === 21)!.role, "cooldown");
  // the 9m stop-and-save press is not a segment
  assert.equal(segments.find((s) => s.lap_index === 22)!.role, "stub");
  assert.equal(segments.filter((s) => s.role === "rest").length, 9);
});

test("recovery HR excludes the warm-up, which would otherwise flatter it", () => {
  const { segments } = classifySegments(intervals);
  const rest = statsFor(segments, ["rest"]);
  // the warm-up averaged 134bpm; real recoveries never came below 154
  assert.ok(rest.lowest_segment_hr! >= 154, `got ${rest.lowest_segment_hr}`);
  const withWarmup = statsFor(segments, ["rest", "warmup"]);
  assert.equal(withWarmup.lowest_segment_hr, 134);
});

test("peak segment HR is the hardest rep, and max HR is instantaneous", () => {
  const { segments } = classifySegments(intervals);
  const work = statsFor(segments, ["work"]);
  assert.equal(work.peak_segment_hr, 178); // the last rep's average
  assert.equal(work.max_hr, 186);          // the highest beat inside it
  assert.equal(work.count, 10);
  assert.equal(work.distance_m, 3000);
});

test("averages are weighted by time, not a mean of means", () => {
  // two segments, wildly different lengths: the long one must dominate
  const rows = [
    lap(1, 400, 100, 180), lap(2, 400, 100, 180), lap(3, 400, 100, 180),
    lap(4, 4000, 900, 140),
  ];
  const { segments } = classifySegments(rows);
  const all = statsFor(segments, ["work", "rest", "steady", "warmup", "cooldown"]);
  const meanOfMeans = (180 * 3 + 140) / 4; // 170 — what the naive version gives
  const weighted = (180 * 300 + 140 * 900) / 1200; // 150
  assert.ok(Math.abs(all.avg_hr! - weighted) < 0.5, `got ${all.avg_hr}`);
  assert.ok(Math.abs(all.avg_hr! - meanOfMeans) > 15);
});

test("segment clocks run consecutively from zero", () => {
  const { segments } = classifySegments(intervals);
  assert.equal(segments[0].start_s, 0);
  assert.equal(segments[0].end_s, 364);
  assert.equal(segments[1].start_s, 364);
  for (let i = 1; i < segments.length; i++) {
    assert.equal(segments[i].start_s, segments[i - 1].end_s);
  }
});

test("laps arriving out of order are still ordered correctly", () => {
  const shuffled = [intervals[3], intervals[0], intervals[1], intervals[2]];
  const { segments } = classifySegments(shuffled);
  assert.deepEqual(segments.map((s) => s.lap_index), [1, 2, 3, 4]);
});

test("no laps at all is not a crash", () => {
  const { segments, isIntervals } = classifySegments([]);
  assert.deepEqual(segments, []);
  assert.equal(isIntervals, false);
  assert.equal(statsFor([], ["work"]).count, 0);
  assert.equal(statsFor([], ["work"]).avg_hr, null);
});

test("downsample averages buckets and keeps cumulative distance honest", () => {
  const n = 1000;
  const streams = {
    time: { data: Array.from({ length: n }, (_, i) => i) },
    heartrate: { data: Array.from({ length: n }, () => 150) },
    velocity_smooth: { data: Array.from({ length: n }, () => 3) },
    distance: { data: Array.from({ length: n }, (_, i) => i * 3) },
    altitude: { data: Array.from({ length: n }, () => 100) },
  };
  const s = downsample(streams, 100);
  assert.ok(s.t.length <= 100, `got ${s.t.length}`);
  assert.equal(s.hr[0], 150);
  // the last bucket's distance is the run's total, not the bucket's first sample
  assert.equal(s.dist[s.dist.length - 1], (n - 1) * 3);
});

test("downsample survives gaps in the HR stream", () => {
  // a strap that drops out mid-run sends nulls; a bucket of them must be null,
  // not zero, or the graph draws a cliff to the floor
  const streams = {
    time: { data: [0, 1, 2, 3] },
    heartrate: { data: [null, null, null, null] },
  };
  const s = downsample(streams, 4);
  assert.equal(s.hr[0], null);
});

test("downsample on an empty stream returns empty, not a crash", () => {
  assert.deepEqual(downsample({}, 100).t, []);
});

test("pace converts m/s to min/km and rounds without making :60", () => {
  assert.equal(pace(1000 / 300), "5:00");
  assert.equal(pace(4.29), "3:53");
  // 2.7855 m/s is 5:59.0/km; the naive version printed 5:60 near this boundary
  assert.equal(pace(1000 / 359.7), "6:00");
  assert.equal(pace(null), "—");
  assert.equal(pace(0.2), "—"); // a stopped watch, not an 83min kilometre
});

test("hms formats with an hour only when there is one", () => {
  assert.equal(hms(59), "0:59");
  assert.equal(hms(600), "10:00");
  assert.equal(hms(3661), "1:01:01");
  assert.equal(hms(null), "—");
});

test("polyline decoding matches Google's reference example", () => {
  const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(points, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test("an empty polyline is an empty route, not a crash", () => {
  assert.deepEqual(decodePolyline(""), []);
});

test("polyline encoding is the exact inverse of decoding", () => {
  // Google's reference example, encoded from its own decoded form
  const points: [number, number][] = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
  assert.equal(encodePolyline(points), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(decodePolyline(encodePolyline(points)), points);
});

test("encoding survives a real route round trip", () => {
  // a short synthetic route with sub-metre deltas, which is where a sign or
  // shift bug in the varint packing shows up
  const points: [number, number][] = [];
  for (let i = 0; i < 200; i++) {
    points.push([52.5 + i * 0.00012, 13.4 - i * 0.00009]);
  }
  const round = decodePolyline(encodePolyline(points));
  assert.equal(round.length, points.length);
  round.forEach(([lat, lng], i) => {
    // 1e-5 degrees is the format's own resolution, about 1m
    assert.ok(Math.abs(lat - points[i][0]) < 1e-5, `lat ${i}`);
    assert.ok(Math.abs(lng - points[i][1]) < 1e-5, `lng ${i}`);
  });
});

test("a route crossing the equator and prime meridian keeps its signs", () => {
  const points: [number, number][] = [[0.001, -0.001], [-0.001, 0.001], [0, 0]];
  assert.deepEqual(decodePolyline(encodePolyline(points)), points);
});
