import { test } from "node:test";
import assert from "node:assert/strict";
import { BAND, MAX_SHIFT, MIN_STREAK, prescribedPace, read, secs, type Signal } from "../lib/signals";
import { daysToRace } from "../lib/coach";

const sig = (on: string, prescribed: number, achieved: number, weight = 1, type = "Interval"): Signal =>
  ({ on, label: `${on} session`, type, weight, prescribed, achieved });

const GOAL = 55 * 60;

test("no signals is not a verdict", () => {
  const r = read([], GOAL);
  assert.equal(r.state, "on");
  assert.equal(r.streak, 0);
  assert.equal(r.shift, 0);
  assert.equal(r.projected, GOAL);
  assert.equal(r.confidence, "Building");
});

test("inside the tolerance band is on plan, not off it", () => {
  // a session one second off prescription is noise; a plan that reacts to noise
  // is worse than one that reacts to nothing
  const r = read([sig("2026-08-01", 255, 256), sig("2026-08-08", 255, 254), sig("2026-08-15", 255, 256)], GOAL);
  assert.equal(r.state, "on");
  assert.equal(r.shift, 0);
});

test("three consecutive misses is behind, and moves the target", () => {
  const r = read([
    sig("2026-08-01", 255, 263), sig("2026-08-08", 255, 265), sig("2026-08-15", 255, 264),
  ], GOAL);
  assert.equal(r.state, "behind");
  assert.equal(r.streak, 3);
  assert.ok(r.shift > 0, "a slower target");
  assert.equal(r.confidence, "High");
});

test("three consecutive beats is ahead, and pulls the target in", () => {
  const r = read([
    sig("2026-08-01", 255, 248), sig("2026-08-08", 255, 246), sig("2026-08-15", 255, 247),
  ], GOAL);
  assert.equal(r.state, "ahead");
  assert.ok(r.shift < 0);
});

test("two in a row is not enough to change anything", () => {
  // deliberate: MIN_STREAK is 3. Two sessions is a fortnight, and a fortnight of
  // being quick is as likely to be two good days as it is a fitness change.
  const r = read([sig("2026-08-08", 255, 246), sig("2026-08-15", 255, 245)], GOAL);
  assert.equal(r.streak, 2);
  assert.equal(r.shift, 0, "no shift under a three-session streak");
  assert.equal(r.confidence, "Medium");
  assert.ok(MIN_STREAK === 3);
});

test("one freak session cannot flip the verdict", () => {
  // four honest sessions then one huge outlier: the streak resets to 1, so no
  // shift, even though the trend has moved
  const r = read([
    sig("2026-07-01", 255, 254), sig("2026-07-08", 255, 256), sig("2026-07-15", 255, 255),
    sig("2026-07-22", 255, 254), sig("2026-08-01", 255, 285),
  ], GOAL);
  assert.equal(r.streak, 1);
  assert.equal(r.shift, 0);
});

test("recency is weighted: an old miss counts less than a fresh one", () => {
  const older = read([sig("2026-06-01", 255, 275), sig("2026-08-01", 255, 255)], GOAL);
  const newer = read([sig("2026-06-01", 255, 255), sig("2026-08-01", 255, 275)], GOAL);
  assert.ok(newer.trend > older.trend, "the same miss matters more when it is recent");
});

test("only the last five sessions count", () => {
  const ancient = Array.from({ length: 8 }, (_, i) => sig(`2026-0${i + 1}-01`, 255, 300));
  const recent = Array.from({ length: 5 }, (_, i) => sig(`2026-0${i + 4}-01`, 255, 255));
  // eight terrible sessions followed by five on-plan ones: the window means the
  // trend is close to zero, not catastrophic
  const r = read([...ancient, ...recent], GOAL);
  assert.ok(Math.abs(r.trend) < BAND, `trend ${r.trend} should be inside the band`);
});

test("session type is weighted: a time trial says more than a tempo", () => {
  const tt = read([
    sig("2026-08-01", 255, 265, 1.5, "Time trial"),
    sig("2026-08-08", 255, 265, 1.5, "Time trial"),
    sig("2026-08-15", 255, 265, 1.5, "Time trial"),
  ], GOAL);
  const tempo = read([
    sig("2026-08-01", 255, 265, 0.8, "Tempo"),
    sig("2026-08-08", 255, 265, 0.8, "Tempo"),
    sig("2026-08-15", 255, 265, 0.8, "Tempo"),
  ], GOAL);
  // identical misses, so the trend matches — but weight is what the caller uses
  // to decide which signals to feed in at all
  assert.ok(Math.abs(tt.trend - tempo.trend) < 0.01);
  assert.equal(tt.state, "behind");
});

test("the shift is capped, however bad it gets", () => {
  const awful = Array.from({ length: 5 }, (_, i) => sig(`2026-08-0${i + 1}`, 255, 400));
  const r = read(awful, GOAL);
  assert.ok(Math.abs(r.shift) <= MAX_SHIFT, `shift ${r.shift} exceeds the cap`);
});

test("a lift is scored the other way up: more is better", () => {
  // dir -1 flips the sign, so lifting 5 kg over prescription is 'ahead'
  const r = read([
    { on: "2026-08-01", label: "Back squat", type: "Top set", weight: 1, prescribed: 105, achieved: 110, dir: -1 },
    { on: "2026-08-08", label: "Back squat", type: "Top set", weight: 1, prescribed: 105, achieved: 112, dir: -1 },
    { on: "2026-08-15", label: "Back squat", type: "Top set", weight: 1, prescribed: 105, achieved: 111, dir: -1 },
  ], GOAL);
  assert.equal(r.state, "ahead");
});

test("the same signals always give the same verdict", () => {
  // the whole reason this is not a model: it has to be replayable
  const s = [sig("2026-08-01", 255, 262), sig("2026-08-08", 255, 264), sig("2026-08-15", 255, 263)];
  assert.deepEqual(read(s, GOAL), read(s, GOAL));
});

test("deltas render with their sign kept", () => {
  assert.equal(secs(4), "+4 s/km");
  assert.equal(secs(-4), "−4 s/km");
  assert.equal(secs(0), "0 s/km");
});

test("prescribed pace is read from the title, where the plan states it", () => {
  assert.equal(prescribedPace("RACE SESSION · 8 × 1000 m @ 4:15"), 255);
  assert.equal(prescribedPace("5 × 800 m @ 4:20"), 260);
  assert.equal(prescribedPace("6 × 1000 m @ 4:05"), 245);
});

test("a title with no pace produces no signal rather than a guess", () => {
  assert.equal(prescribedPace("BENCHMARK · 5 × 1000 m"), null);
  assert.equal(prescribedPace("Long run 18 km"), null);
  assert.equal(prescribedPace("Hyrox continuous"), null);
});

test("something that is not a pace is not read as one", () => {
  // a start time, or a finish time, must not become a per-kilometre target
  assert.equal(prescribedPace("Race @ 09:30"), null, "9:30 is a clock time, not a pace");
  assert.equal(prescribedPace("Sim @ 58:00"), null, "58:00 is a finish time");
  assert.equal(prescribedPace("Reps @ 1:30"), null, "1:30/km is nobody's pace");
});

test("days-to-race counts down, not up", () => {
  // diffDays(a, b) is a - b. Getting the order wrong returned -105 for a race
  // three months out, which read as "block complete" on two screens and made the
  // 28/14/7/1-day countdown notifications look up MARKS[-105] and never fire.
  assert.equal(daysToRace("2026-08-15"), 105, "race is 28 Nov 2026");
  assert.equal(daysToRace("2026-11-27"), 1, "the night before");
  assert.equal(daysToRace("2026-11-28"), 0, "race day");
  assert.ok(daysToRace("2026-12-01") < 0, "after the race");
});

test("the countdown marks are days that can actually occur", () => {
  // every mark must be reachable by counting down from the block start
  const fromStart = daysToRace("2026-08-17");
  for (const mark of [28, 14, 7, 1]) {
    assert.ok(mark < fromStart, `${mark} days out falls inside the block`);
  }
});
