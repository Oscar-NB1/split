import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWeekWith, usable } from "../lib/plan/parse-week-llm";
import { parseWeek } from "../lib/plan/parse-week";

/**
 * What is tested here is the fallback and the gate, not the model.
 *
 * A model's reading of a sentence is not something an assertion can pin down, and pretending
 * otherwise would give a suite that passes on prompts it has never run. What can be pinned
 * down is that a missing key, a refusal or malformed output all end at the same place — the
 * deterministic parser, whose ten tests still stand — and that nothing which fails the shape
 * check reaches the generator.
 */

test("without a key it reads the sentence with the rules, and says so", async () => {
  const before = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const p = await parseWeekWith("Out Wednesday to Friday. No long run this week.");
    assert.equal(p.by, "rules");
    assert.equal(p.day_availability?.find((d) => d.day === 3)?.available, "none");
    assert.equal(p.week_intent?.no_long_run, true);
    /* Identical to calling the parser directly: the wrapper adds a route, not a behaviour. */
    const direct = parseWeek("Out Wednesday to Friday. No long run this week.");
    assert.deepEqual({ ...p, by: undefined }, { ...direct, by: undefined });
  } finally {
    if (before) process.env.ANTHROPIC_API_KEY = before;
  }
});

test("a day outside the week is rejected rather than passed on", () => {
  assert.equal(usable({
    day_availability: [{ day: 9, available: "none" }],
    session_actions: [], week_intent: {}, ambiguities: [], confidence: "high",
  }), false, "day 9 would be placed nowhere and drop a session silently");
});

test("an availability the generator does not know is rejected", () => {
  assert.equal(usable({
    day_availability: [{ day: 1, available: "maybe" }],
    session_actions: [], week_intent: {}, ambiguities: [], confidence: "high",
  }), false);
});

test("prose, null and a bare array all fail the gate", () => {
  assert.equal(usable("I could not work that out"), false);
  assert.equal(usable(null), false);
  assert.equal(usable([]), false);
  assert.equal(usable({ day_availability: [] }), false, "missing session_actions");
});

test("a well-formed reading passes, including an empty one", () => {
  assert.equal(usable({
    day_availability: [], session_actions: [], week_intent: {},
    ambiguities: [], confidence: "low",
  }), true, "understanding nothing is a legal answer — it rebuilds nothing");
  assert.equal(usable({
    day_availability: [{ day: 0, available: "pm" }, { day: 6, available: "full" }],
    session_actions: [{ day: 2, session_type: "hyrox", action: "skip" }],
    week_intent: { reduce_volume: true }, ambiguities: [], confidence: "high",
  }), true);
});
