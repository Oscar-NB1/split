import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, weekKm } from "../lib/plan/import";
import { parseSteps } from "../lib/prescription";
import { prescribedPace } from "../lib/signals";

/*
 * A week of her document, as a word processor writes it: one cell per line, en dashes, and the
 * key run's structure in the session's name rather than in its detail. The paces are the part
 * that arrived later — her first four weeks were imported without any, so the session screen had
 * nothing to convert into a belt speed and nothing to compare a recorded run against.
 */
const WEEK = [
  "Sarah — 10-week block",
  "Week 1 · 17–23 Aug  —  Baseline test",
  "Base · 9 km",
  "Day", "Session", "Detail",
  "Tue",
  "Run/walk build — 6 × (3 min run @ 7:00–7:30/km · 8.0–8.6 km/h / 1 min walk)",
  "2.5 km total · Eighteen minutes of running, in pieces.",
  "Thu",
  "Easy run",
  "3.0 km @ 7:15–7:45/km · the genuinely easy day",
  "Sun",
  "Long run",
  "4.0 km @ 7:15–7:45/km · run 5 min / walk 1 min throughout",
].join("\n");

const week1 = () => parsePlan(WEEK).weeks[0];
const on = (day: number) => week1().sessions.find((s) => s.day === day)!;

test("a run/walk key run reads, with the pace stated inside the bracket", () => {
  /*
   * The slash before the walk is no longer the first slash in the bracket — "@ 7:00–7:30/km" put
   * two in front of it — and the day used to come back unreadable because of it.
   */
  const p = parsePlan(WEEK);
  assert.deepEqual(p.problems, []);
  const tue = on(1);
  assert.equal(tue.kind, "quality_run");
  assert.equal(tue.significance, "key", "it is the day the week is built around");
  assert.match(tue.target, /- 6x/);
  assert.match(tue.target, /- 3 min Z2 @ 7:00-7:30\/km/);
  assert.match(tue.target, /- 1 min Z1 walk/, "the walk is part of the rep, not a rest after it");
});

test("the band is a band, not its fast end", () => {
  /*
   * paceOf matches a hyphen and the document writes an en dash, so "7:00–7:30" came back as 7:00
   * alone: the fast end of the band prescribed for every rep, and the number the calibration
   * would then measure her against.
   */
  const steps = parseSteps(on(1).target);
  const work = steps.flatMap((g) => g.items).find((s) => s.pace);
  assert.equal(work?.pace, "7:00-7:30/km");
  assert.equal(prescribedPace(on(1).title), 435, "7:15/km — the middle of the band");
});

test("a run/walk session is the running the document states, with no warm-up invented", () => {
  /*
   * The stated total is the running in the blocks: 2.5 km against eighteen minutes is the same
   * number, and the minute of walking between them is the recovery. Forcing the quality-session
   * floor of a kilometre and a half in front of it turned a 2.5 km session into 4 — in the week
   * whose entire point is that it is small.
   */
  const tue = on(1);
  assert.equal(tue.km, 2.5);
  assert.doesNotMatch(tue.target, /warm up/);
  assert.doesNotMatch(tue.target, /cool down/);
  assert.equal(tue.minutes, 24, "eighteen minutes of running and six of walking");
});

test("an easy and a long run keep the author's distance and pace", () => {
  assert.equal(on(3).target, "- 3km Z2 @ 7:15-7:45/km");
  assert.equal(on(6).target, "- 4km Z2 @ 7:15-7:45/km");
  assert.equal(weekKm(week1()), 9.5, "2.5 + 3 + 4, the sessions this fixture states");
});

test("a stated recovery survives prose that mentions one", () => {
  /*
   * Week 6 says "full recovery — this is where speed starts" in its prose and "90 s walk" in its
   * name. Reading the rest from the first segment with a rest word in it found the prose, took no
   * duration out of it, and dropped the recovery: six 400s at race pace with nothing between them.
   */
  const doc = [
    "Week 6 · 21–27 Sep",
    "Build · 4.5 km",
    "Day", "Session", "Detail",
    "Tue",
    "KEY RUN — 6 × 400 m @ 6:30/km (9.2 km/h) · 90 s walk",
    "4.5 km total · First measured reps. Short, quick, full recovery — this is where speed starts.",
  ].join("\n");
  const [w] = parsePlan(doc).weeks;
  assert.match(w.sessions[0].target, /- 90s Z1 walk/);
  assert.match(w.sessions[0].target, /- 400m \w+ @ 6:30\/km/);
});

test("a half simulation is read, and is not called a full one", () => {
  /*
   * Her peak week rehearses running off a station as a "HALF SIM". An exact match on "full sim"
   * made it no session at all, and it is the one day in the block that rehearses the race.
   */
  const doc = [
    "Week 9 · 12–18 Oct  —  Peak",
    "Specific · 0 km",
    "Day", "Session", "Detail",
    "Fri",
    "HALF SIM",
    "4 × 500 m run, alternating with ski, sled push, wall balls, burpees.",
  ].join("\n");
  const [w] = parsePlan(doc).weeks;
  assert.equal(w.sessions[0].kind, "hyrox");
  assert.match(w.sessions[0].target, /half simulation/);
  assert.doesNotMatch(w.sessions[0].target, /full simulation/);
});
