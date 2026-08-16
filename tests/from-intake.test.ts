import { test } from "node:test";
import assert from "node:assert/strict";
import type { Intake } from "../lib/intake";
import { paramsFrom, type Extra } from "../lib/plan/from-intake";
import { generate } from "../lib/plan/generate";

const EMPTY_EXTRA: Extra = { recent: null, absences: [], max_hr: null, measured: false };

const base = (o: Partial<Intake> = {}): Intake => ({
  hasRace: "Yes", discipline: "Hyrox doubles", raceDistance: null,
  raceDate: "2026-11-28", role: null, division: "Men · open", longRunDay: null,
  base: "Over a year", runningSelf: "Half marathon fit",
  paceMin: 22, paceSec: 0, paceUnknown: false,
  peakWeekKm: null, longestRunKm: null, volumeSource: null,
  goal: "Target a time", goalMin: 56, startDate: "2026-08-17",
  targetSessions: "6", allowDoubles: "Yes, when it helps", wantRestDay: "Yes, keep one",
  sessionPref: "Write me the session", hyroxExp: "Weekly",
  runDelta: "They are a bit faster", stationDelta: "I am a bit stronger",
  gymAccess: "Open floor, any time",
  runStationLink: "Yes, with a walk between",
  pastRaces: [],
  bRaces: [],
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  commitments: [], freq: {}, commitDay: {}, commitMode: {},
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

test("the partner scale reads both ways round, on one convention", () => {
  // Positive is the partner, on both axes — the scale roleFrom() documents. The
  // station column used to be inverted, which swapped protected and run_limiter.
  const p = paramsFrom(base({
    runDelta: "They are a bit faster", stationDelta: "They are a bit stronger",
  }), EMPTY_EXTRA);
  assert.deepEqual(p.partner, { run_delta: 1, station_delta: 1 });
  const flipped = paramsFrom(base({
    runDelta: "I am much faster", stationDelta: "I am much stronger",
  }), EMPTY_EXTRA);
  assert.deepEqual(flipped.partner, { run_delta: -2, station_delta: -2 });

  const protectedPair = paramsFrom(base({
    runDelta: "They are much faster", stationDelta: "They are much stronger",
  }), EMPTY_EXTRA);
  assert.deepEqual(protectedPair.partner, { run_delta: 2, station_delta: 2 });
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
    // The key is normalised; the label is what the athlete typed, because that is
    // what appears on the day. "padel" was showing up as the title of a session.
    activity: "kickboxing", label: "Kickboxing", per_week: 2, fixed_days: [0, 3],
    intensity: "high", mode: "add", locked: true,
  });
});

test("weeks start on the Monday the athlete picked", () => {
  const p = paramsFrom(base({ startDate: "2026-08-17" }), EMPTY_EXTRA);
  assert.equal(p.week_start(1), "2026-08-17");
  assert.equal(p.week_start(2), "2026-08-24");
});

test("the paces come from the best evidence on file", () => {
  /*
   * A race the athlete has run beats a 5 km they typed, which beats the time they
   * are aiming at. Every one of them states itself on the session, so a target
   * built from a goal is never read as a measurement.
   */
  const raced = paramsFrom(base({
    pastRaces: [{ event: "Heerenveen", division: null, finish: "1:00:50",
      run_avg: "4:33", stations: "21:17", rox: "5:20", anchored: true }],
  }), EMPTY_EXTRA).anchor!;
  assert.match(raced.flags[0].code, /from_race/);
  assert.equal(raced.race_pace_s_per_km, 273, "their own average run split");
  assert.ok(raced.cv_pace_s_per_km < 273, "fresh running is quicker than compromised");

  const goalOnly = paramsFrom(base({
    paceUnknown: true, goal: "Target a time", goalMin: 60, pastRaces: [],
  }), EMPTY_EXTRA).anchor!;
  assert.match(goalOnly.flags[0].code, /from_goal/);
  assert.match(goalOnly.flags[0].message, /not from anything you have run/);

  const nothing = paramsFrom(base({
    paceUnknown: true, goal: "Just finish it", goalMin: null, pastRaces: [],
  }), EMPTY_EXTRA).anchor;
  assert.equal(nothing, null, "no evidence, no invented pace");
});

test("the paces come from the 5 km where there is no race", () => {
  /*
   * Anchors only ever came from a benchmark, so an athlete who had given a real
   * 5 km time was prescribed zones and efforts — no session carried a pace at all.
   * The number exists and they ran it; the plan uses it, flagged as self-reported.
   */
  const a = paramsFrom(base({ paceMin: 21, paceSec: 30 }), EMPTY_EXTRA).anchor;
  assert.ok(a, "an anchor");
  assert.ok(a!.cv_pace_s_per_km > 250 && a!.cv_pace_s_per_km < 290, `${a!.cv_pace_s_per_km}`);
  assert.match(a!.flags[0].code, /five_k/);

  // Without the 5 km it drops to the next source down rather than to nothing.
  const noFiveK = paramsFrom(base({ paceUnknown: true }), EMPTY_EXTRA).anchor;
  assert.ok(noFiveK && noFiveK.flags[0].code !== "paces_from_five_k", "a weaker source");
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

test("weeks run Monday to Sunday, and a mid-week start makes week 1 short", () => {
  // The day indices every stage places on are 0 = Monday. Laying the block from a
  // Wednesday put the session the athlete was told was Monday's on a Wednesday —
  // so the block is anchored to the Monday of the start week instead, and the days
  // before they started are simply not written.
  const wed = paramsFrom(base({ startDate: "2026-08-19" }), EMPTY_EXTRA);
  assert.equal(wed.week_start(1), "2026-08-17", "the Monday of that week");
  assert.equal(wed.week_start(2), "2026-08-24");
  assert.equal(wed.first_day, "2026-08-19", "but the athlete starts on the Wednesday");

  const mon = paramsFrom(base({ startDate: "2026-08-17" }), EMPTY_EXTRA);
  assert.equal(mon.week_start(1), "2026-08-17");
  assert.equal(mon.first_day, "2026-08-17");
});
