import { test } from "node:test";
import assert from "node:assert/strict";
import type { Intake } from "../lib/intake";
import { paramsFrom, type Extra } from "../lib/plan/from-intake";
import { generate } from "../lib/plan/generate";

const EMPTY_EXTRA: Extra = { recent: null, absences: [], max_hr: null, measured: false };

const base = (o: Partial<Intake> = {}): Intake => ({
  hasRace: "Yes", discipline: "Hyrox doubles", raceDistance: null,
  raceDate: "2026-11-28", role: null, division: "Men · open",
  base: "Over a year", runningSelf: "Half marathon fit",
  paceMin: 22, paceSec: 0, paceUnknown: false,
  peakWeekKm: null, longestRunKm: null, volumeSource: null,
  goal: "Target a time", goalMin: 56, startDate: "2026-08-17",
  targetSessions: "6", allowDoubles: "Yes, when it helps", wantRestDay: "Yes, keep one",
  sessionPref: "Write me the session", hyroxExp: "Weekly",
  runDelta: "They are a bit faster", stationDelta: "I am a bit stronger",
  gymAccess: "Open floor, any time",
  pastRaces: [],
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  commitments: [], freq: {}, commitDay: {},
  equipment: ["Sled — race weight", "SkiErg", "Rower", "Wall balls", "Treadmill"],
  sled: "Race weight and distance", injuries: null,
  volume: "Progressive", difficulty: "Challenging", benchmark: "offered",
  ...o,
});

test("the block length comes from the calendar, not a preference", () => {
  const p = paramsFrom(base(), EMPTY_EXTRA);
  assert.equal(p.length, 15, "17 Aug to 28 Nov");
  // and it is clamped either side rather than trusted
  assert.equal(paramsFrom(base({ raceDate: "2030-01-01" }), EMPTY_EXTRA).length, 24);
  assert.equal(paramsFrom(base({ raceDate: "2026-08-24" }), EMPTY_EXTRA).length, 4);
});

test("days become indices, Monday zero, in order", () => {
  const p = paramsFrom(base({ days: ["Sat", "Mon", "Thu"] }), EMPTY_EXTRA);
  assert.deepEqual(p.days, [0, 3, 5]);
  assert.equal(p.available_days, 3);
});

test("Hyrox history can only raise the training age, never lower it", () => {
  const green = paramsFrom(base({ base: "Under 3 months", hyroxExp: "Multiple weekly" }), EMPTY_EXTRA);
  assert.equal(green.general_training_age, "intermediate", "raised from novice");
  const seasoned = paramsFrom(base({ base: "Several years", hyroxExp: "None" }), EMPTY_EXTRA);
  assert.equal(seasoned.general_training_age, "elite", "Hyrox inexperience does not demote");
});

test("the advanced Hyrox tier needs a race on file, not a claim", () => {
  // the intake's past-race step was dropped, which left this tier unreachable —
  // it now comes from the imported official results instead of a question
  const claimed = paramsFrom(base({ base: "Under 3 months", hyroxExp: "Multiple weekly" }), EMPTY_EXTRA);
  assert.equal(claimed.general_training_age, "intermediate");
  const raced = paramsFrom(base({ base: "Under 3 months", hyroxExp: "Multiple weekly" }),
    { ...EMPTY_EXTRA, hyrox_races: 1 });
  assert.equal(raced.general_training_age, "advanced");
  assert.equal(raced.hyrox_experience!.races_done, 1);
});

test("only a logged benchmark counts as measured", () => {
  // Strava measures volume, not pace, and the two are not interchangeable
  const withStrava = paramsFrom(base(), {
    ...EMPTY_EXTRA,
    recent: { peak_week_km: 38, long_run_km: 19, source: "measured" },
  });
  assert.equal(withStrava.confidence, "estimated");
  assert.equal(withStrava.recent!.source, "measured", "but the volume is still measured");
  assert.equal(paramsFrom(base(), { ...EMPTY_EXTRA, measured: true }).confidence, "measured");
});

test("the partner scale reads both ways round", () => {
  const p = paramsFrom(base(), EMPTY_EXTRA);
  assert.deepEqual(p.partner, { run_delta: 1, station_delta: 1 });
  const flipped = paramsFrom(base({
    runDelta: "I am much faster", stationDelta: "They are much stronger",
  }), EMPTY_EXTRA);
  assert.deepEqual(flipped.partner, { run_delta: -2, station_delta: -2 });
});

test("a partner only exists for doubles, and only once answered", () => {
  assert.equal(paramsFrom(base({ discipline: "Hyrox singles" }), EMPTY_EXTRA).partner, null);
  assert.equal(paramsFrom(base({ runDelta: null }), EMPTY_EXTRA).partner, null);
});

test("the variant comes from kit and access together", () => {
  assert.equal(paramsFrom(base(), EMPTY_EXTRA).variant, "full");
  // full kit you have to queue for is not a full setup
  assert.equal(
    paramsFrom(base({ gymAccess: "Busy — expect to queue" }), EMPTY_EXTRA).variant, "gym");
  assert.equal(paramsFrom(base({ gymAccess: "Classes only" }), EMPTY_EXTRA).variant, "class");
  assert.equal(paramsFrom(base({ equipment: [] }), EMPTY_EXTRA).variant, "field");
});

test("commitments are added, not substituted", () => {
  // they are doing these anyway, so they cost load without buying a slot back
  const p = paramsFrom(base({
    commitments: ["Kickboxing", "Nothing fixed"],
    freq: { Kickboxing: 2 }, commitDay: { Kickboxing: ["Mon", "Thu"] },
  }), EMPTY_EXTRA);
  assert.equal(p.commitments.length, 1, "'Nothing fixed' is not a commitment");
  assert.deepEqual(p.commitments[0], {
    activity: "kickboxing", per_week: 2, fixed_days: [0, 3],
    intensity: "high", mode: "add", locked: true,
  });
});

test("weeks start on the Monday the athlete picked", () => {
  const p = paramsFrom(base({ startDate: "2026-08-17" }), EMPTY_EXTRA);
  assert.equal(p.week_start(1), "2026-08-17");
  assert.equal(p.week_start(2), "2026-08-24");
});

test("no anchor without a benchmark, so every pace is flagged as derived", () => {
  assert.equal(paramsFrom(base(), EMPTY_EXTRA).anchor, null);
});

test("a skipped benchmark schedules none", () => {
  assert.equal(paramsFrom(base({ benchmark: "skipped" }), EMPTY_EXTRA).benchmark, false);
  assert.equal(paramsFrom(base(), EMPTY_EXTRA).benchmark, true);
});

// ------------------------------------------------------- end to end

test("a full intake generates a valid block", () => {
  const out = generate(paramsFrom(base(), {
    ...EMPTY_EXTRA,
    recent: { peak_week_km: 38, long_run_km: 19, source: "measured" },
    max_hr: 189,
  }));
  assert.equal(out.weeks.length, 15);
  assert.equal(out.weeks[0].km, 38, "week 1 is the biggest recent week");
  assert.ok(out.weeks.some((w) => w.benchmark), "and the benchmark is in it");
  assert.deepEqual(out.violations, [], "no assertion failures");
});

test("the sparsest survivable intake still generates", () => {
  // everything optional left out: it must produce a block, not throw
  const out = generate(paramsFrom(base({
    hasRace: "No", raceDate: null, goal: null, discipline: "General fitness",
    runningSelf: "I do not run", base: "Under 3 months", hyroxExp: null,
    targetSessions: null, days: ["Tue", "Thu"], equipment: [],
    runDelta: null, stationDelta: null, gymAccess: null, startDate: null,
  }), EMPTY_EXTRA));
  assert.ok(out.weeks.length >= 4);
  assert.ok(out.weeks.every((w) => w.km > 0));
});
