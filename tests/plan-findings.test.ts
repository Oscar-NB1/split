import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capture, Segment } from "../lib/plan/capture";
import { changes, read } from "../lib/plan/findings";

const seg = (i: number, type: Segment["type"], d: number, off = 0): Segment =>
  ({ index: i, type, offset_s: off, duration_s: d, source: "app_timer" });

/** Runs, stations and transitions laid end to end, with offsets that add up. */
function capture(o: {
  runs: number[]; stations?: number[]; transitions?: number[];
  hr?: { t_offset_s: number; bpm: number }[];
  aborted?: boolean; submaximal?: boolean;
} ): Capture {
  const segments: Segment[] = [];
  let t = 0, i = 1;
  o.runs.forEach((r, n) => {
    segments.push(seg(i++, "run", r, t)); t += r;
    if (o.stations?.[n] !== undefined) { segments.push(seg(i++, "station", o.stations[n], t)); t += o.stations[n]; }
    if (o.transitions?.[n] !== undefined) { segments.push(seg(i++, "transition", o.transitions[n], t)); t += o.transitions[n]; }
  });
  return {
    athlete_id: "a", protocol_version: 1, variant: "full",
    submaximal: o.submaximal ?? false, started_at: "2026-08-19T09:00:00Z",
    segments, hr: o.hr ? { source: "garmin", series: o.hr } : { source: "none" },
    completion: { aborted: o.aborted ?? false },
  };
}

const find = (rs: ReturnType<typeof read>, dim: string) => rs.find((r) => r.dim === dim);

test("the most important thing is said first", () => {
  const rs = read(capture({ runs: [252, 261, 272, 340], stations: [222, 228, 236, 244] }));
  assert.ok(rs.length > 1);
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i - 1].priority >= rs[i].priority);
});

test("fade lands in the right band and says so with the real numbers", () => {
  const heavy = find(read(capture({ runs: [240, 260, 280, 300] })), "Durability")!;
  assert.equal(heavy.band, "heavy");
  assert.equal(heavy.severity, "attention");
  assert.match(heavy.headline, /25% across 4 rounds/);
  assert.match(heavy.body, /4:00 and round 4 ran 5:00/);
  assert.match(heavy.effect, /fatigue-resistance/);

  assert.equal(find(read(capture({ runs: [240, 242, 244, 248] })), "Durability")!.band, "strong");
});

test("a positive splitter is called one, and it outranks everything else", () => {
  const rs = read(capture({ runs: [200, 240, 244, 248] }));
  const p = find(rs, "Pacing")!;
  assert.equal(p.band, "positive splitter");
  assert.match(p.body, /costs a race/);
  assert.equal(p.effect, "Key sessions get a capped opening rep.");
  assert.ok(p.priority >= Math.max(...rs.filter((r) => r.dim !== "Speed").map((r) => r.priority)));
});

test("the limiter is whichever side gave way first", () => {
  const runLimited = capture({ runs: [240, 260, 280, 300], stations: [220, 222, 224, 226] });
  assert.equal(find(read(runLimited), "Limiter")!.band, "aerobic");
  const stationLimited = capture({ runs: [240, 242, 244, 246], stations: [220, 250, 280, 310] });
  assert.equal(find(read(stationLimited), "Limiter")!.band, "strength");
  const even = capture({ runs: [240, 250, 260, 270], stations: [220, 229, 238, 247] });
  assert.equal(find(read(even), "Limiter")!.band, "balanced");
});

// ------------------------------------------------------------ what it omits

test("an aborted session says nothing about durability", () => {
  // silence is the honest output — a neutral band would read as a measurement
  const rs = read(capture({ runs: [240, 260, 280, 300], aborted: true }));
  assert.equal(find(rs, "Durability"), undefined);
  assert.ok(find(rs, "Speed"), "what was measured is still reported");
});

test("a submaximal test says nothing about pacing", () => {
  assert.equal(find(read(capture({ runs: [200, 240, 244, 248], submaximal: true })), "Pacing"), undefined);
});

test("no heart-rate stream means no recovery reading", () => {
  assert.equal(find(read(capture({ runs: [240, 250, 260, 270], transitions: [30, 30, 30] })), "Recovery"), undefined);
});

test("an inferred transition is never read as roxzone", () => {
  // only a pressed lap measures a transition; a derived one is a guess at where
  // a gap was, and roxzone is the thing it would corrupt
  const c = capture({ runs: [240, 250, 260, 270], transitions: [60, 60, 60] });
  for (const s of c.segments) if (s.type === "transition") s.low_confidence = true;
  assert.equal(find(read(c), "Transitions"), undefined);
});

test("too few runs to say anything yields nothing at all", () => {
  assert.deepEqual(read(capture({ runs: [240] })), []);
});

// ---------------------------------------------------------------- recovery

test("heart-rate fall across transitions bands the recovery", () => {
  const c = capture({
    runs: [240, 250, 260, 270], transitions: [30, 30, 30],
    hr: Array.from({ length: 1300 }, (_, t) => ({ t_offset_s: t, bpm: 170 })),
  });
  // make each transition end 15 bpm below where it started
  for (const s of c.segments.filter((x) => x.type === "transition")) {
    for (const p of c.hr.series!) {
      if (p.t_offset_s > s.offset_s && p.t_offset_s <= s.offset_s + s.duration_s) p.bpm = 155;
    }
  }
  const r = find(read(c), "Recovery")!;
  assert.equal(r.band, "fast");
  assert.match(r.headline, /15 bpm per transition/);
  assert.match(r.body, /across 3 transitions/);
});

// ------------------------------------------------- from the test to the plan

test("a second test compares against the first", () => {
  const first = capture({ runs: [252, 261, 272, 286] });
  const second = capture({ runs: [232, 238, 244, 251] });
  const s = find(read(second, first), "Speed")!;
  assert.equal(s.band, "improving");
  assert.match(s.headline, /faster than last time/);
  assert.match(s.body, /4:28 to 4:01/);
});

test("only the lines that moved are shown, each with its reason", () => {
  const readings = read(capture({ runs: [240, 260, 280, 300], stations: [220, 222, 224, 226] }));
  const cs = changes(
    { "Key session pace": "4:41 /km", "Easy run pace": "6:11 /km", "Week 1 volume": "34 km" },
    { "Key session pace": "4:28 /km", "Easy run pace": "6:11 /km", "Week 1 volume": "38 km" },
    readings,
  );
  assert.deepEqual(cs.map((c) => c.label), ["Key session pace", "Week 1 volume"]);
  const vol = cs.find((c) => c.label === "Week 1 volume")!;
  assert.equal(vol.dim, "Durability");
  assert.equal(vol.band, "heavy", "the reading that moved it, not a generic one");
  assert.match(vol.rule, /Volume only rises when fade improves/);
  assert.ok(vol.feel.length > 0, "and what it feels like in a session");
});

test("a changed line with no rule still renders rather than disappearing", () => {
  const cs = changes({ Something: "a" }, { Something: "b" }, []);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].dim, "—");
});
