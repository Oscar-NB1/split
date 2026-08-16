import { test } from "node:test";
import assert from "node:assert/strict";
import { dialPreview } from "../lib/plan/preview";
import type { Intake } from "../lib/intake";

const base = (o: Partial<Intake> = {}): Intake => ({
  hasRace: "Yes", discipline: "Hyrox doubles", raceDistance: null,
  raceDate: "2026-11-15", role: null, division: "Mixed doubles", longRunDay: "Sun",
  base: "Several years", runningSelf: "Runs regularly",
  paceMin: 22, paceSec: 30, paceUnknown: false,
  peakWeekKm: 38, longestRunKm: 19, volumeSource: "self",
  goal: "Compete", goalMin: 70, startDate: "2026-08-19",
  targetSessions: "6", allowDoubles: null, wantRestDay: "Yes, keep one",
  sessionPref: "Mix", hyroxExp: "Weekly", runDelta: "About the same",
  stationDelta: "About the same", gymAccess: "Open floor, any time",
  runStationLink: "Yes, with a walk between",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  commitments: [], freq: {}, commitDay: {}, commitMode: {},
  equipment: [], sled: "Used a lighter sled", injuries: "",
  volume: "Progressive", difficulty: "Challenging", benchmark: "offered",
  pastRaces: [], bRaces: [],
  ...o,
} as Intake);

test("the volume dial changes the curve it is shown beside", () => {
  // The dials are the only two answers whose effect is otherwise invisible, which
  // is the whole reason the curve is on that step.
  const slow = dialPreview(base({ volume: "Conservative" }));
  const fast = dialPreview(base({ volume: "Aggressive" }));
  assert.ok(fast.ramp > slow.ramp, `${fast.ramp} > ${slow.ramp}`);
  assert.ok(fast.peak >= slow.peak);
  assert.match(slow.curve, /climbs [\d.]+% a week/);
});

test("the difficulty dial changes what is inside the week, not its size", () => {
  const steady = dialPreview(base({ difficulty: "Steady" }));
  const hard = dialPreview(base({ difficulty: "Hard" }));
  const quality = (p: ReturnType<typeof dialPreview>) =>
    p.rows.find((r) => r.label === "Quality sessions")!.value;

  assert.equal(quality(steady), "1 a week");
  assert.equal(quality(hard), "2 a week", "the dial did nothing at all before this");
  assert.equal(steady.rows.find((r) => r.label === "Long run")!.value,
    "By effort, no pace target");
  // Same weeks, same volume: difficulty is not a volume setting.
  assert.deepEqual(steady.weeks.map((w) => w.km), hard.weeks.map((w) => w.km));
});

test("the ceiling quoted is the one the curve is actually held under", () => {
  // r.ceiling caps week 1; quoting it beside the peak read as "peaks at 70 km
  // against your 32 km ceiling", which is not a sentence anyone can act on.
  const p = dialPreview(base());
  assert.ok(p.ceiling != null && p.peak <= p.ceiling + 0.5, `${p.peak} vs ${p.ceiling}`);
});

test("a half-answered form produces a curve rather than a crash", () => {
  const p = dialPreview(base({ targetSessions: "", days: [], peakWeekKm: null,
    longestRunKm: null, startDate: null }));
  assert.ok(p.weeks.length > 0);
  assert.ok(p.peak > 0);
});
