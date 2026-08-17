import { test } from "node:test";
import assert from "node:assert/strict";
import { dialPreview } from "../lib/plan/preview";
import type { Intake } from "../lib/intake";
import { toBlock } from "../lib/block";

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

test("a week counts its running twice: all of it, and the part outside the classes", () => {
  /*
   * Both numbers are true and they answer different questions. The running inside a Hyrox class
   * counts towards the week — it is running, and his plan says so explicitly — but six of those
   * kilometres arrive in 500 m pieces between a sled and a set of wall balls, which is not the
   * same training as six on a road.
   *
   * Derived from the week's own sessions rather than stored, so the two cannot drift apart.
   */
  const block = toBlock({
    id: "b", name: "Block", start_date: "2026-08-17",
    volume: [{ km: 51, note: "" }],
    weeks: [[
      { day: 0, kind: "quality_run", title: "Threshold", minutes: 60,
        target: "- 3km Z2 warm up\n- 6x\n- 1000m Z4 @ 4:20/km\n- 90s Z1 walk\n- 2km Z1 cool down" },
      { day: 2, kind: "hyrox", title: "Class", minutes: 60,
        target: "- 3km Z2 running inside the class" },
      { day: 5, kind: "hyrox", title: "Class", minutes: 70,
        target: "- 5.5km Z4 running inside the class @ 4:26/km" },
      { day: 3, kind: "strength", title: "Strength", minutes: 45,
        target: "Trap bar deadlift 4x4 rest 180s" },
      { day: 6, kind: "long_run", title: "Long run", minutes: 95,
        target: "- 18km Z2 @ 5:08-5:22/km" },
    ]],
    intents: [], race_date: null, race_name: null, goal_label: null, goal_seconds: null,
    plan_state: null, benchmark: {}, guardrails: [], easy_pace: null, corrections: [],
  } as never);

  const w = block.weeks[0];
  assert.equal(w.km, 51, "the total is the author's own number");
  assert.equal(w.km_excl_hyrox, 29, "11 + 18 — the two classes come out");
  /* Strength contributes nothing, because a lift line has no distance in it. */
});
