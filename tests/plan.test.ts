import { test } from "node:test";
import assert from "node:assert/strict";
import { baseTitle, isDateString, isKind, lighten, scaledTitle } from "../lib/plan";
import { isDeloadWeek, minutesFor, type Rules } from "../lib/templates";
import { effortPoints, kindFor, pickClosest, statusFor, type StravaActivity } from "../lib/ingest";
import { eventBody, targetIsStructure, toWorkoutText } from "../lib/intervals";
import { kindFromTitle, minutesFromText, parseIcs } from "../lib/runna";
import { metricForWeek, weekStart } from "../lib/scoring";

const RULES: Required<Rules> = {
  long_run_delta_min: 5,
  long_run_max_min: 150,
  deload_every: 4,
  deload_factor: 0.7,
  fatigue_skips_to_deload: 2,
  fatigue_cut: 0.85,
};

// ----------------------------------------------------------------- validation

test("isDateString only accepts a plain calendar date", () => {
  assert.equal(isDateString("2026-08-14"), true);
  assert.equal(isDateString("2026-8-14"), false);
  assert.equal(isDateString("2026-08-14T06:00:00Z"), false);
  assert.equal(isDateString(undefined), false);
  assert.equal(isDateString(null), false);
});

test("isKind rejects anything the app can't score", () => {
  assert.equal(isKind("run_intervals"), true);
  assert.equal(isKind("swim"), false);
  assert.equal(isKind(""), false);
});

// -------------------------------------------------------------- scaling down

test("scaling twice does not nest the old title", () => {
  const once = scaledTitle("run_intervals", 55, "Thursday intervals");
  assert.equal(once, "Easy run (was: Thursday intervals)");
  const twice = scaledTitle("run_easy", 33, once);
  assert.equal(twice, "Thursday intervals - short");
  assert.equal(baseTitle(twice), "Thursday intervals");
});

test("a scaled session is 60% as long, floored at 20 minutes", () => {
  assert.equal(lighten("run_long", 80).minutes, 48);
  assert.equal(lighten("run_easy", 25).minutes, 20);
  assert.equal(lighten("run_intervals", 55).kind, "run_easy");
});

// ---------------------------------------------------------- template engine

test("deloads land on every 4th week, 0-indexed", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((w) => isDeloadWeek(w, 4)),
    [false, false, false, true, false, false, false, true],
  );
  assert.equal(isDeloadWeek(3, 0), false); // deloads switched off
});

test("long-run progression compounds, and a deload cuts the real volume", () => {
  const long = { day: 6, kind: "run_long", title: "Long run", minutes: 80 };

  assert.equal(minutesFor(long, 0, 1, RULES), 80);
  assert.equal(minutesFor(long, 4, 1, RULES), 100);

  // the old order dropped the accumulated progression on a deload week, so a
  // week-11 deload came out shorter than week 1. It should scale 80+55.
  const deloaded = minutesFor(long, 11, RULES.deload_factor, RULES);
  assert.equal(deloaded, Math.round((80 + 55) * 0.7));
  assert.ok(deloaded > 80 * 0.7);
});

test("progression is capped so it can't run away", () => {
  const long = { day: 6, kind: "run_long", title: "Long run", minutes: 80 };
  assert.equal(minutesFor(long, 500, 1, RULES), RULES.long_run_max_min);
});

test("only the long run progresses", () => {
  const easy = { day: 1, kind: "run_easy", title: "Easy", minutes: 40 };
  assert.equal(minutesFor(easy, 10, 1, RULES), 40);
  assert.equal(minutesFor(easy, 10, 0.85, RULES), 34);
});

// -------------------------------------------------------------- the matcher

const activity = (over: Partial<StravaActivity> = {}): StravaActivity => ({
  id: 1, name: "Morning Run", sport_type: "Run", type: "Run",
  start_date: "2026-08-14T05:00:00Z", start_date_local: "2026-08-14T07:00:00Z",
  moving_time: 2400, elapsed_time: 2500, distance: 8000, total_elevation_gain: 40,
  ...over,
});

test("under 70% of the plan is adjusted, at or over it is done", () => {
  assert.equal(statusFor(40, 40), "done");
  assert.equal(statusFor(28, 40), "done");      // exactly 70%
  assert.equal(statusFor(27, 40), "adjusted");
  assert.equal(statusFor(90, 40), "done");
  assert.equal(statusFor(35, null), "done");    // nothing was asked for
});

test("the matcher prefers a timed session over an untimed one", () => {
  const candidates = [
    { id: "untimed", planned_minutes: null },
    { id: "close", planned_minutes: 40 },
  ];
  // null used to score a perfect zero and win every time
  assert.equal(pickClosest(candidates, 41)?.id, "close");
  assert.equal(pickClosest([{ id: "only", planned_minutes: null }], 41)?.id, "only");
  assert.equal(pickClosest([], 41), undefined);
});

test("the matcher does not reorder its input", () => {
  const candidates = [{ id: "a", planned_minutes: 90 }, { id: "b", planned_minutes: 40 }];
  pickClosest(candidates, 41);
  assert.equal(candidates[0].id, "a");
});

test("Garmin's station-work types are not read as gym strength", () => {
  // this is the whole point of weighting effort by kind, and it was inverted:
  // Garmin Cardio/HIIT arrive as Workout/HighIntensityIntervalTraining
  assert.equal(kindFor(activity({ sport_type: "Workout" })), "hyrox");
  assert.equal(kindFor(activity({ sport_type: "HighIntensityIntervalTraining" })), "hyrox");
  assert.equal(kindFor(activity({ sport_type: "Crossfit" })), "hyrox");
  assert.equal(kindFor(activity({ sport_type: "WeightTraining" })), "strength");
  // and an unknown type is scored conservatively rather than as station work
  assert.equal(kindFor(activity({ sport_type: "Yoga" })), "strength");
});

test("effort points weight stations above easy running", () => {
  const run = effortPoints(activity({ sport_type: "Run", moving_time: 3600 }));
  const hyrox = effortPoints(activity({ sport_type: "Workout", type: "Workout", moving_time: 3600 }));
  assert.ok(hyrox > run, `${hyrox} should beat ${run}`);
});

test("a long run is classified by distance", () => {
  assert.equal(kindFor(activity({ distance: 18000 })), "run_long");
  assert.equal(kindFor(activity({ distance: 8000 })), "run_easy");
});

// ------------------------------------------------------------ watch pushing

test("structure is decided by provenance, not by the shape of the text", () => {
  assert.equal(targetIsStructure("manual"), true);
  assert.equal(targetIsStructure("template"), true);
  assert.equal(targetIsStructure("runna"), false);
});

test("hand-written structure reaches the watch untouched", () => {
  const steps = "- 10m Z2\n- 6x\n- 800m Z4\n- 2m Z1";
  assert.equal(toWorkoutText("run_intervals", 55, steps), steps);

  // and in the shorthand db/schema.sql documents, which has no dashes at all -
  // a shape-sniffing heuristic threw this away and pushed a canned session
  const shorthand = "10x400m @ 3:55, walk 90s";
  const body = eventBody({
    id: "abc", planned_date: "2026-08-14", title: "Thursday intervals",
    kind: "run_intervals", planned_minutes: 55, target: shorthand,
    coach_note: null, source: "manual",
  });
  assert.equal(body.description, shorthand);
  assert.equal(body.external_id, "split-abc");
  assert.equal(body.start_date_local, "2026-08-14T06:00:00");
});

test("Runna prose is not sent as workout syntax", () => {
  // this is the shape of a Runna calendar description
  const prose = "Easy run to build aerobic base. Keep the effort conversational.";
  const body = eventBody({
    id: "abc", planned_date: "2026-08-14", title: "Easy run", kind: "run_easy",
    planned_minutes: 40, target: prose, coach_note: null, source: "runna",
  });
  assert.match(body.description, /^- 40m Z2/);   // real structure first
  assert.ok(body.description.includes(prose));   // prose kept, as a note
});

test("Runna prose full of numbers is still prose", () => {
  // no text heuristic survives this: it reads exactly like a workout
  const prose = "Speed session: 8 x 400m with 90 sec recoveries, 45 min total.";
  const body = eventBody({
    id: "y", planned_date: "2026-08-14", title: "Speed", kind: "run_intervals",
    planned_minutes: 55, target: prose, coach_note: null, source: "runna",
  });
  assert.ok(body.description.includes(prose));
  assert.ok(!body.description.includes("Z4"), body.description);
});

test("an interval session we can't parse does not get invented reps", () => {
  // the canned 8x3min Z4 ladder is not a rough guess at "8 x 400m off 90s" -
  // it is three times the Z4 volume, at an intensity nobody prescribed
  const body = eventBody({
    id: "z", planned_date: "2026-08-14", title: "Intervals", kind: "run_intervals",
    planned_minutes: 50, target: "Reps at 5k effort with jog recoveries.",
    coach_note: null, source: "runna",
  });
  assert.match(body.description, /^- 50m Z2/);
  assert.ok(!/Z4|8x/.test(body.description), body.description);
});

test("with no target at all, the kind's default structure still applies", () => {
  // nothing to contradict: a session we programmed as intervals and left blank
  const body = eventBody({
    id: "w", planned_date: "2026-08-14", title: "Intervals", kind: "run_intervals",
    planned_minutes: 55, target: null, coach_note: null, source: "template",
  });
  assert.match(body.description, /^- 10m Z2 warm up/);
  assert.ok(body.description.includes("Z4"));
});

test("a coach note rides along with the workout", () => {
  const body = eventBody({
    id: "x", planned_date: "2026-08-14", title: "Intervals", kind: "run_intervals",
    planned_minutes: 55, target: null, coach_note: "Cut the last rep if the legs go.",
    source: "template",
  });
  assert.ok(body.description.includes("Cut the last rep"));
  assert.match(body.description, /^- 10m Z2 warm up/);
});

// ------------------------------------------------------------- the ics feed

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:runna-1",
  "DTSTART;VALUE=DATE:20260817",
  "SUMMARY:45 min easy run",
  "DESCRIPTION:Keep it conversational.",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:runna-2",
  "DTSTART:20260819T060000Z",
  "SUMMARY:Interval session: 8 x 400m",
  "END:VEVENT",
  "END:VCALENDAR",
];

test("parseIcs reads uid, date, summary and description", () => {
  const events = parseIcs(ICS.join("\r\n"));
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    uid: "runna-1", date: "2026-08-17",
    summary: "45 min easy run", description: "Keep it conversational.",
  });
  assert.equal(events[1].date, "2026-08-19");
});

test("folded lines are unfolded whether the feed uses CRLF or bare LF", () => {
  const folded = [
    "BEGIN:VEVENT",
    "UID:runna-3",
    "DTSTART;VALUE=DATE:20260820",
    "SUMMARY:Long run with a very long titl",
    " e that got folded",
    "END:VEVENT",
  ];
  const expected = "Long run with a very long title that got folded";
  assert.equal(parseIcs(folded.join("\r\n"))[0].summary, expected);
  // a feed served with bare LF used to keep the fold and break the title
  assert.equal(parseIcs(folded.join("\n"))[0].summary, expected);
});

test("kindFromTitle maps Runna's wording onto our kinds", () => {
  assert.equal(kindFromTitle("Long run"), "run_long");
  assert.equal(kindFromTitle("Threshold intervals"), "run_intervals");
  assert.equal(kindFromTitle("Easy 5k"), "run_easy");
  assert.equal(kindFromTitle("Rest day"), "rest");
  assert.equal(kindFromTitle("Core strength"), "strength");
});

test("minutesFromText prefers stated minutes over a distance guess", () => {
  assert.equal(minutesFromText("45 min easy run"), 45);
  assert.equal(minutesFromText("12km long run"), 72);
  assert.equal(minutesFromText("Intervals"), null);
});

// -------------------------------------------------------------- the contest

test("weekStart returns a Monday even just after local midnight", () => {
  // 00:30 on Monday 10 August in Berlin: UTC still says Sunday
  assert.equal(weekStart(new Date(2026, 7, 10, 0, 30)), "2026-08-10");
  assert.equal(weekStart(new Date(2026, 7, 16, 23, 30)), "2026-08-10");
});

test("the challenge metric advances by one every week", () => {
  const weeks = ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"];
  const metrics = weeks.map(metricForWeek);
  assert.equal(new Set(metrics.slice(0, 4)).size, 4); // all four, no repeats
  assert.equal(metrics[4], metrics[0]);               // then it rotates round
});

test("the rotation keeps the phase the first implementation had", () => {
  // pinned so that redeploying can't change the metric mid-week under them
  const order = ["sessions_done", "zone2_minutes", "effort_points", "longest_session"];
  const asFirstWritten = (ws: string) =>
    order[Math.floor(Date.parse(ws) / (7 * 864e5)) % order.length];
  for (const ws of ["2026-08-10", "2026-08-17", "2026-03-30", "2026-10-26", "2027-01-04"]) {
    assert.equal(metricForWeek(ws), asFirstWritten(ws), ws);
  }
});

test("any day of the week resolves to that week's metric", () => {
  // /api/week accepts a date; a Wednesday must not score as its own week
  assert.equal(metricForWeek("2026-08-12"), metricForWeek("2026-08-10"));
});
