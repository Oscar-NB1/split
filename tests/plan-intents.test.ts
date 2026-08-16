import { test } from "node:test";
import assert from "node:assert/strict";
import { paramsFrom } from "../lib/plan/from-intake";
import { generate } from "../lib/plan/generate";
import { toTemplate } from "../lib/plan/to-template";
import { intentRanges } from "../lib/plan/intents";
import type { Intake } from "../lib/intake";

const x = (o: Partial<Intake> = {}): Intake => ({
  hasRace: "Yes", discipline: "Hyrox doubles", raceDistance: null,
  raceDate: "2026-11-29", role: null, division: "Mixed doubles", longRunDay: "Sun",
  base: "Several years", runningSelf: "Runs regularly",
  paceMin: 22, paceSec: 30, paceUnknown: false,
  peakWeekKm: 38, longestRunKm: 19, volumeSource: "self",
  goal: "Compete", goalMin: 70, startDate: "2026-08-17",
  targetSessions: "6", allowDoubles: null, wantRestDay: "Yes, keep one",
  sessionPref: "Mix", hyroxExp: "Weekly", runDelta: "About the same",
  stationDelta: "About the same", gymAccess: "Open floor, any time",
  runStationLink: "Yes, with a walk between",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  commitments: ["Padel"], freq: { Padel: 1 }, commitDay: { Padel: ["Wed"] },
  commitMode: { Padel: "add" },
  equipment: ["Sled — race weight", "SkiErg", "Rower", "Wall balls"],
  sled: "Race weight and distance", injuries: "",
  volume: "Progressive", difficulty: "Hard", benchmark: "scheduled",
  pastRaces: [], bRaces: [],
  ...o,
} as Intake);

const built = (o: Partial<Intake> = {}) =>
  generate(paramsFrom(x(o), {
    recent: null, absences: [], max_hr: 185, measured: false,
  }));

test("a session is named after what you do in it, never after its importance", () => {
  // "Key session" was the title of every quality run — a session called after its
  // own significance, which tells the athlete nothing about what to run. Key is a
  // marker, and it is carried by `significance`.
  const t = toTemplate(built(), 185);
  const titles = t.weeks.flat().map((d) => d.title);
  assert.ok(!titles.some((n) => /^key session$/i.test(n)), titles.slice(0, 8).join(", "));

  const quality = t.weeks[1].filter((d) => d.kind === "quality_run");
  assert.ok(quality.length > 0);
  for (const q of quality) {
    assert.match(q.title, /\d/, `${q.title} says what to run`);
    assert.equal(q.significance, "key", "and is still marked key");
  }
});

test("two quality runs in a week are two different sessions", () => {
  const t = toTemplate(built({ difficulty: "Hard" }), 185);
  for (const week of t.weeks) {
    const q = week.filter((d) => d.kind === "quality_run").map((d) => d.title);
    if (q.length < 2) continue;
    assert.equal(new Set(q).size, q.length, `same session twice: ${q.join(" / ")}`);
  }
});

test("a commitment keeps the athlete's own name for it", () => {
  const t = toTemplate(built(), 185);
  assert.ok(t.weeks[1].some((d) => d.title === "Padel"), "not 'padel'");
});

test("every phase says what it is for, what to protect and what to drop", () => {
  // The week screen looks for the range containing this week. It used to be one row
  // per week carrying only a phase name, so the screen found nothing and showed
  // "Off block" over a plan that was running.
  const ranges = intentRanges(built(), 185);
  assert.ok(ranges.length >= 3, `${ranges.length} phases`);
  for (const r of ranges) {
    assert.ok(r.to >= r.from);
    assert.ok(r.purpose.length > 40, r.phase);
    assert.ok(r.protect.length > 0, `${r.phase} protects something`);
    assert.match(r.sacrifice, /Never the long run|nothing spare/,
      "the long run is never the thing to drop");
    assert.ok(r.watch.length > 20, r.phase);
  }
  const covered = ranges.flatMap((r) =>
    Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i));
  assert.deepEqual(covered, built().weeks.map((w) => w.n), "every week is in a phase");
});

test("the watch line quotes a heart rate only when there is one to quote", () => {
  const withHr = intentRanges(built(), 185)[0].watch;
  assert.match(withHr, /\d+ bpm/);
  const without = intentRanges(built(), null)[0].watch;
  assert.ok(!/bpm/.test(without), without);
});
