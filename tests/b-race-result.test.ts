import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldUsability, usableFields } from "../lib/race/brace";
import { paramsFrom } from "../lib/plan/from-intake";
import type { Intake } from "../lib/intake";

/*
 * What a B-race is allowed to prove.
 *
 * A secondary race is potentially the best data in the block — a real event, and the
 * only in-plan source of a roxzone now that benchmark retests are gone. It is also
 * the easiest way to poison every prescription downstream, which is what these
 * guards are for.
 */

test("a race run as training measures the transitions and nothing else", () => {
  const u = fieldUsability({ doubles: false, intent: "training" });
  assert.equal(u.run_paces, "distorted", "training intensity is not a ceiling");
  assert.equal(u.roxzone, "usable", "crossing a venue is the same job either way");
  assert.deepEqual(usableFields(u), ["roxzone", "station_times"]);
  assert.match(u.reason!, /training/);
});

test("a pair running at the partner's pace has not measured this athlete's running", () => {
  const u = fieldUsability({ doubles: true, intent: "compete", partner_slower: true });
  assert.equal(u.run_paces, "distorted");
  assert.equal(u.station_times, "usable", "their own stations are still their own");
  assert.match(u.reason!, /partner/);
});

test("an uneven station split is not comparable with a solo target", () => {
  const heavy = fieldUsability({ doubles: true, intent: "compete", my_share: 0.72 });
  assert.equal(heavy.station_times, "distorted");
  assert.equal(heavy.run_paces, "usable", "the running was still theirs");
  assert.match(heavy.reason!, /72%/, "and it says the number back");

  // Inside the band, it counts.
  const even = fieldUsability({ doubles: true, intent: "compete", my_share: 0.52 });
  assert.equal(even.station_times, "usable");
  assert.equal(even.reason, undefined);
});

test("a raced solo event proves all three", () => {
  const u = fieldUsability({ doubles: false, intent: "compete" });
  assert.deepEqual(usableFields(u), ["roxzone", "run_paces", "station_times"]);
  assert.equal(u.reason, undefined);
});

test("the roxzone survives every distortion there is", () => {
  /*
   * Deliberate: it is the one field a B-race always measures. Queueing for a sled
   * and crossing a venue is the same job whatever the intent or the split — and
   * without it there is no in-plan source of a roxzone at all.
   */
  for (const c of [
    { doubles: true, intent: "training" as const, partner_slower: true, my_share: 0.9 },
    { doubles: false, intent: "training" as const },
    { doubles: true, intent: "sharpen" as const, my_share: 0.1 },
  ]) {
    assert.equal(fieldUsability(c).roxzone, "usable", JSON.stringify(c));
  }
});

// --- and what it does to the plan ---------------------------------------------

const x = (o: Partial<Intake> = {}): Intake => ({
  hasRace: "Yes", discipline: "Hyrox doubles", raceDistance: null,
  raceDate: "2026-11-29", role: null, division: "Mixed doubles", longRunDay: "Sun",
  base: "Several years", runningSelf: "Runs regularly",
  paceMin: 22, paceSec: 30, paceUnknown: false,
  peakWeekKm: 38, longestRunKm: 19, volumeSource: "self",
  goal: "Compete", goalMin: 70, startDate: "2026-08-17",
  targetSessions: "6", allowDoubles: null, wantRestDay: "Yes, keep one",
  sessionPref: "Written sessions", hyroxExp: "Weekly", runDelta: "About the same",
  stationDelta: "About the same", gymAccess: "Open floor, any time",
  runStationLink: "Yes, with a walk between",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  commitments: [], freq: {}, commitDay: {}, commitMode: {},
  equipment: ["Sled — race weight", "SkiErg", "Rower", "Wall balls"],
  sled: "Race weight and distance", injuries: "",
  volume: "Progressive", difficulty: "Hard", benchmark: "scheduled",
  pastRaces: [], bRaces: [],
  ...o,
} as Intake);

const base = { recent: null, absences: [], max_hr: 185, measured: false };

test("a race measured inside the block outranks the one they remembered at signup", () => {
  /*
   * Both are race splits, so both take the same path — but one was measured by the
   * app in September and the other was recalled in August, and the athlete has been
   * training in between.
   */
  const remembered = paramsFrom(x(), base);
  const measured = paramsFrom(x(), { ...base, measured_race_run_split_s: 268 });

  assert.equal(measured.anchor?.race_pace_s_per_km, 268);
  assert.notEqual(measured.anchor?.race_pace_s_per_km, remembered.anchor?.race_pace_s_per_km);
  // Fresh running is quicker than compromised running, and the anchor still says so.
  assert.ok(measured.anchor!.cv_pace_s_per_km < 268);
});

test("a distorted result never reaches the anchor, because it never gets sent", () => {
  // measuredFor filters on the stored verdict, so the generator's contract is
  // simply: a number here is a number that passed.
  const none = paramsFrom(x(), { ...base, measured_race_run_split_s: null });
  assert.deepEqual(none.anchor, paramsFrom(x(), base).anchor);
});

test("an implausible split is refused rather than believed", () => {
  // 40 s/km is a typo. The anchor falls through to the next-best evidence instead
  // of prescribing intervals nobody can run.
  const silly = paramsFrom(x(), { ...base, measured_race_run_split_s: 40 });
  assert.deepEqual(silly.anchor, paramsFrom(x(), base).anchor);
});
