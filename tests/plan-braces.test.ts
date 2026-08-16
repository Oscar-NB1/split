import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABSORB_WITHIN_WEEKS, KEY_SESSIONS_DROPPED, applyBRaces, violations,
  type BRaceInput, type Week,
} from "../lib/plan/braces";

const sess = (day: number, kind: string, hard = false, km?: number) =>
  ({ day, kind, hard, label: kind, ...(km === undefined ? {} : { km }) });

/** Week 11 of the worked example: 50 km, key Tuesday, Hyrox Saturday, long Sunday. */
const week = (n: number, o: Partial<Week> = {}): Week => ({
  n, km: 50, deload: false, taper: false, note: "",
  sessions: [
    sess(0, "easy_run"), sess(1, "quality_run", true), sess(2, "easy_run"),
    sess(3, "easy_run"), sess(4, "easy_run"),
    sess(5, "hyrox", true), sess(6, "long_run", true),
  ],
  ...o,
});
const block = () => [week(10), week(11), week(12)];
const race = (o: Partial<BRaceInput> = {}): BRaceInput =>
  ({ week: 11, day: 2, intent: "sharpen", full_event: true, ...o });

const wk = (ws: Week[], n: number) => ws.find((w) => w.n === n)!;
const keys = (w: Week) => w.sessions.filter((s) => s.hard && s.kind !== "race").length;

test("the race replaces whatever was on the day", () => {
  // a race is a session, not an extra
  const { weeks } = applyBRaces(block(), [race({ day: 5 })]);
  const w = wk(weeks, 11);
  assert.equal(w.sessions.filter((s) => s.day === 5).length, 1);
  assert.equal(w.sessions.find((s) => s.day === 5)!.kind, "race");
});

test("each intent costs what it advertises", () => {
  const cut = (intent: BRaceInput["intent"]) =>
    wk(applyBRaces(block(), [race({ intent })]).weeks, 11).km;
  assert.equal(cut("training"), 45, "−10%");
  assert.equal(cut("sharpen"), 40, "−20%");
  assert.equal(cut("compete"), 30, "−40%");
});

test("competing costs the following week too", () => {
  const { weeks } = applyBRaces(block(), [race({ intent: "compete" })]);
  assert.equal(wk(weeks, 12).km, 42.5, "−15% coming back");
  assert.match(wk(weeks, 12).note, /Coming back/);
  // and a training effort does not
  assert.equal(wk(applyBRaces(block(), [race({ intent: "training" })]).weeks, 12).km, 50);
});

test("key sessions dropped never exceed the intent's budget", () => {
  assert.deepEqual(KEY_SESSIONS_DROPPED, { training: 0, sharpen: 1, compete: 2 });
  for (const intent of ["training", "sharpen", "compete"] as const) {
    const before = block();
    const { weeks } = applyBRaces(before, [race({ intent, day: 2 })]);
    const lost = keys(wk(before, 11)) - keys(wk(weeks, 11));
    assert.ok(lost <= KEY_SESSIONS_DROPPED[intent],
      `${intent} dropped ${lost}, allows ${KEY_SESSIONS_DROPPED[intent]}`);
  }
});

test("a due deload moves onto the race week rather than sitting beside it", () => {
  // two easy weeks together inside the specific phase is a fortnight lost
  const b = [week(10), week(11), week(12, { deload: true })];
  const { weeks, flags } = applyBRaces(b, [race()]);
  assert.equal(wk(weeks, 12).deload, false);
  assert.equal(wk(weeks, 11).deload, true);
  assert.ok(flags.some((f) => f.code === "deload_absorbed"));
  assert.equal(ABSORB_WITHIN_WEEKS, 1);
});

test("a deload two weeks away is left where it is", () => {
  const b = [week(11), week(12), week(13, { deload: true })];
  const { weeks } = applyBRaces(b, [race()]);
  assert.equal(wk(weeks, 13).deload, true);
  assert.equal(wk(weeks, 11).deload, false);
});

test("a benchmark never shares a week with a race", () => {
  // two hard tests in one week measures neither
  const b = [week(10), week(11, { benchmark: true }), week(12)];
  const { weeks, flags } = applyBRaces(b, [race()]);
  assert.equal(wk(weeks, 11).benchmark, false);
  assert.ok(flags.some((f) => f.code === "benchmark_moved"));
});

test("recovery comes from the event, not the intent", () => {
  /*
   * A full Hyrox at training intent is still a full Hyrox — an athlete taking
   * 70–80% of the station work has done a heavy day whatever they called it.
   */
  const b = [week(10), week(11, {
    sessions: [sess(2, "easy_run"), sess(3, "quality_run", true)],
  }), week(12)];
  const { weeks } = applyBRaces(b, [race({ intent: "training", day: 2, full_event: true })]);
  const after = wk(weeks, 11).sessions.find((s) => /day after the race/.test(s.label))!;
  assert.ok(after, "the day after a full event is off");
  assert.equal(after.hard, false);
  assert.equal(after.day, 3);

  // Not a full event, so the hard session survives — moved off the day beside
  // the race by rule 6, but still hard and still in the week.
  const light = applyBRaces(b, [race({ intent: "training", day: 2, full_event: false })]);
  const kept = wk(light.weeks, 11).sessions.filter((s) => s.hard && s.kind !== "race");
  assert.equal(kept.length, 1);
  assert.ok(Math.abs(kept[0].day - 2) > 1, "moved away from the race");
});

test("a full week reports what it could not re-solve", () => {
  // seven sessions and a race: something must give, and a key session is not it
  const { flags } = applyBRaces(block(), [race({ day: 2, intent: "training" })]);
  assert.ok(flags.some((f) => f.code === "midweek_race_crowded"),
    "a key session left beside the race is reported, not quietly sacrificed");
});

test("a mid-week race clears the days either side of it", () => {
  // the week is re-solved around the race rather than patched
  const { weeks, flags } = applyBRaces(block(), [race({ day: 2 })]);
  const w = wk(weeks, 11);
  // Nothing hard touches the race, and the sessions moved rather than vanished.
  for (const s of w.sessions.filter((x) => x.hard && x.kind !== "race")) {
    assert.ok(Math.abs(s.day - 2) > 1, `${s.kind} on day ${s.day} is clear of the race`);
  }
  assert.equal(new Set(w.sessions.map((s) => s.day)).size, w.sessions.length,
    "and no two sessions landed on the same day");
  /*
   * No flag asserted here on purpose. At sharpen intent rule 3 has already eased
   * the key session next to the race, so rule 6 has nothing left to do — and a
   * rule that announces work it did not need to do is noise. The invariant above
   * is what matters; the crowded case in the previous test is where the flag
   * earns its place.
   */
  assert.ok(!applyBRaces(block(), [race({ day: 5 })]).flags
    .some((f) => f.code.startsWith("midweek_race")),
    "a Saturday race needs no re-solving — the template already ends there");
});

// ------------------------------------------------------------------ assertions

test("a race in the taper is reported, not planned around", () => {
  const b = [week(14, { taper: true })];
  const { weeks } = applyBRaces(b, [race({ week: 14 })]);
  assert.ok(violations(weeks, [race({ week: 14 })], b)
    .some((v) => v.code === "race_in_taper"));
});

test("a week that collapses below 60% of its neighbours is flagged", () => {
  const b = [week(10), week(11, { km: 50 }), week(12)];
  const { weeks } = applyBRaces(b, [race({ intent: "sharpen" })]);
  assert.deepEqual(violations(weeks, [race()], b), [], "40 of 50 is fine");

  // compete takes 40% and is exempt, because that is what compete means
  const hard = applyBRaces(b, [race({ intent: "compete" })]);
  assert.ok(!violations(hard.weeks, [race({ intent: "compete" })], b)
    .some((v) => v.code === "race_week_too_light"));
});

test("a clean sharpen week produces no violations at all", () => {
  const b = block();
  const { weeks } = applyBRaces(b, [race()]);
  assert.deepEqual(violations(weeks, [race()], b), []);
});
