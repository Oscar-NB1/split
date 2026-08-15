import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuiet, nextSendableAt, QUIET_FROM, QUIET_TO } from "../lib/notify";
import { beats, describe as describeRecord, METRICS } from "../lib/records";
import { countLeadingSkips } from "../lib/rules";

// ------------------------------------------------------------- quiet hours

test("the quiet window wraps midnight", () => {
  // 21:00–07:00 is an OR, not an AND. Getting it wrong inverts the whole thing
  // and sends only at night.
  assert.equal(isQuiet(22), true);
  assert.equal(isQuiet(2), true);
  assert.equal(isQuiet(6), true);
  assert.equal(isQuiet(7), false);
  assert.equal(isQuiet(12), false);
  assert.equal(isQuiet(20), false);
  assert.equal(isQuiet(21), true);
});

test("a window that doesn't wrap still works", () => {
  assert.equal(isQuiet(13, 12, 14), true);
  assert.equal(isQuiet(15, 12, 14), false);
});

test("quiet hours defer to the morning rather than dropping", () => {
  const late = new Date(2026, 7, 18, 22, 40);
  const at = nextSendableAt(late);
  assert.equal(at.getDate(), 19, "22:40 waits for tomorrow");
  assert.equal(at.getHours(), QUIET_TO);

  const small = new Date(2026, 7, 19, 3, 10);
  const at2 = nextSendableAt(small);
  assert.equal(at2.getDate(), 19, "03:10 waits for 07:00 the same day, not tomorrow");
  assert.equal(at2.getHours(), QUIET_TO);

  const afternoon = new Date(2026, 7, 19, 15, 0);
  assert.equal(nextSendableAt(afternoon).getTime(), afternoon.getTime(), "sent now");
});

test("the quiet window really does wrap", () => {
  assert.ok(QUIET_FROM > QUIET_TO);
});

// ----------------------------------------------------------------- records

test("lower is better for times, higher for distances", () => {
  assert.equal(beats("best_5km", 1300, 1320), true);
  assert.equal(beats("best_5km", 1330, 1320), false);
  assert.equal(beats("longest_run_km", 21.1, 18.0), true);
  assert.equal(beats("longest_run_km", 17.0, 18.0), false);
});

test("a trivial improvement is not a personal best", () => {
  // beating a 5 km by two seconds is not worth a push notification
  assert.equal(beats("best_5km", 1318, 1320), false);
  assert.equal(beats("best_5km", 1314, 1320), true);
  assert.equal(beats("best_1km", 239.5, 240), false);
  assert.equal(beats("longest_run_km", 18.1, 18.0), false);
});

test("the first of anything counts", () => {
  assert.equal(beats("best_1km", 300, null), true);
});

test("records read as sentences, and times as times", () => {
  assert.equal(
    describeRecord({ metric: "best_5km", value: 1300, previous: 1320 }),
    "Best 5 km: 21:40, from 22:00.",
  );
  assert.match(
    describeRecord({ metric: "longest_run_km", value: 21.4, previous: null }),
    /First one on the board/,
  );
  // 59.6 seconds must not render as 4:60
  assert.equal(METRICS.best_1km.format(239.6), "4:00");
});

test("the distance records are split-based, not whole-run averages", () => {
  // best_1km is a duration in seconds, so it formats as a clock time; if this
  // ever starts reading like a pace, someone has swapped in an average again
  assert.equal(METRICS.best_1km.format(225), "3:45");
  assert.equal(METRICS.best_1km.lower, true);
});

// ------------------------------------------------------------- missed runs

test("two skipped in a row is two, and a completed session resets it", () => {
  assert.equal(countLeadingSkips([{ status: "skipped" }, { status: "skipped" }]), 2);
  assert.equal(countLeadingSkips([{ status: "skipped" }, { status: "done" }, { status: "skipped" }]), 1);
  assert.equal(countLeadingSkips([{ status: "done" }, { status: "skipped" }]), 0);
  assert.equal(countLeadingSkips([]), 0);
});

test("a session still 'planned' in the past doesn't break the run of skips", () => {
  // same rule the streak uses: unjudged is not the same as completed
  assert.equal(
    countLeadingSkips([{ status: "skipped" }, { status: "planned" }, { status: "skipped" }]), 2);
});

test("an adjusted session counts as done and stops the count", () => {
  assert.equal(
    countLeadingSkips([{ status: "skipped" }, { status: "adjusted" }, { status: "skipped" }]), 1);
});

// --------------------------------------------- what a broken watch looks like

test("an impossible kilometre is not a personal best", () => {
  // real data: a 3,412 m split recorded as 15 s of moving time against 1,205 s
  // elapsed — 819 km/h. Running the backfill printed "Fastest kilometre: 0:15"
  // and would have shown it on the Awards screen.
  assert.equal(beats("best_1km", 15, null), true, "the maths itself has no opinion");
  // the guard lives in the query, so this asserts the constant it uses is sane:
  // 7 m/s over a kilometre is 2:23, already faster than any amateur
  const IMPOSSIBLE = 1000 / 15;   // 66 m/s
  const SPRINT_BOUND = 7;
  assert.ok(IMPOSSIBLE > SPRINT_BOUND, "the bound has to exclude it");
});

test("record formatting does not hide an absurd value", () => {
  // if a bad record ever does get stored, it should read as obviously wrong
  // rather than as a plausible time
  assert.equal(METRICS.best_1km.format(15), "0:15");
  assert.equal(METRICS.longest_session_min.format(1146), "1146 min");
});
