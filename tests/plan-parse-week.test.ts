import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWeek } from "../lib/plan/parse-week";

const av = (p: ReturnType<typeof parseWeek>, day: number) =>
  p.day_availability?.find((d) => d.day === day)?.available;

test("a range of days off becomes three unavailable days", () => {
  const p = parseWeek("Out Wednesday to Friday.");
  assert.equal(av(p, 2), "none");
  assert.equal(av(p, 3), "none");
  assert.equal(av(p, 4), "none");
  assert.equal(av(p, 1), undefined, "and nothing is said about Tuesday");
});

test("a later statement overrides an earlier one", () => {
  /*
   * People self-correct mid-sentence. "Out Wednesday to Friday. Friday night I can run"
   * resolves to Friday PM available — the naive read produces a contradiction instead of an
   * answer, which is the whole reason this is ordered rather than collected.
   */
  const p = parseWeek("Out Wednesday to Friday. Friday night I can run.");
  assert.equal(av(p, 2), "none");
  assert.equal(av(p, 3), "none");
  assert.equal(av(p, 4), "pm", "Friday narrowed to the evening rather than staying gone");
});

test("the brief's own sentence parses whole", () => {
  const p = parseWeek(
    "Out Wed to Fri, can run Friday night. Skipping the Hyrox class. No long run Sunday.");
  assert.equal(av(p, 2), "none");
  assert.equal(av(p, 4), "pm");
  assert.equal(p.week_intent?.no_long_run, true);
  assert.equal(p.confidence, "high");
});

test("a named session on a named day becomes a skip", () => {
  const p = parseWeek("Skipping the strength session on Thursday.");
  assert.deepEqual(p.session_actions, [{ day: 3, session_type: "strength", action: "skip" }]);
});

test("a named session with no day asks rather than guesses", () => {
  /*
   * Two Hyrox sessions in a week and no day given. Returning an ambiguity is the honest
   * move; picking one and being wrong deletes the session they meant to keep.
   */
  const p = parseWeek("Skipping the Hyrox class.");
  assert.equal(p.ambiguities.length, 1);
  assert.match(p.ambiguities[0].question, /which/i);
  assert.ok(p.ambiguities[0].options.length >= 2);
});

test("never more than one question", () => {
  // If two things are unclear, resolve the bigger one and leave the smaller as-is.
  const p = parseWeek("Skipping the Hyrox class. Also skipping strength.");
  assert.ok(p.ambiguities.length <= 1);
});

test("a half day off leaves the other half", () => {
  const p = parseWeek("Away Tuesday morning.");
  assert.equal(av(p, 1), "pm", "an absence names what is gone, not what is left");
});

test("protecting a session is an intent, not a skip", () => {
  const p = parseWeek("I need to keep the long run.");
  assert.deepEqual(p.week_intent?.protect, ["long_run"]);
  assert.equal(p.session_actions?.length ?? 0, 0);
});

test("nothing understood is reported as low confidence rather than as nothing", () => {
  const p = parseWeek("it has been a weird one honestly");
  assert.equal(p.confidence, "low");
  assert.equal(p.day_availability?.length ?? 0, 0);
});

test("a list of days is not read as a range", () => {
  const p = parseWeek("Away Tuesday and Thursday.");
  assert.equal(av(p, 1), "none");
  assert.equal(av(p, 3), "none");
  assert.equal(av(p, 2), undefined, "Wednesday is untouched");
});

/**
 * Rearranging, which is the commonest thing anybody wants from this and the one thing the
 * vocabulary could not say.
 *
 * It could skip, shorten and mark a day unavailable. A session that simply belongs on a
 * different day had no expression, so "I would rather do my easy run today" came back as no
 * change at all — the engine could always perform the swap; the reading was missing.
 */

test("bringing a session forward is a swap, not a move", () => {
  const p = parseWeek("I'd rather do my easy run today and move the quality session.", 0);
  assert.equal(p.session_actions?.length, 1, "one exchange, not two half-moves");
  const a = p.session_actions![0];
  assert.equal(a.action, "swap");
  assert.equal(a.session_type, "easy_run");
  assert.equal(a.to_day, 0, "today, which the caller had to supply");
  assert.equal(a.day, undefined, "where it currently sits is looked up, not guessed");
});

test("two named days trade places", () => {
  const p = parseWeek("Swap Monday and Tuesday.");
  assert.deepEqual(p.session_actions, [{ day: 0, action: "swap", to_day: 1 }]);
});

test("a named destination is read from the sentence", () => {
  const p = parseWeek("Move my long run to Saturday.");
  assert.deepEqual(p.session_actions, [{ session_type: "long_run", action: "swap", to_day: 5 }]);
});

test("today means nothing unless the caller says what day it is", () => {
  /* The parser is pure. Without the day, "today" is a word rather than a destination. */
  const p = parseWeek("I'd rather do my easy run today.");
  assert.equal(p.session_actions?.length ?? 0, 0);
});

test("skipping is still skipping", () => {
  const p = parseWeek("Skip the Hyrox class on Wednesday.", 0);
  assert.deepEqual(p.session_actions, [{ day: 2, session_type: "hyrox", action: "skip" }]);
});
