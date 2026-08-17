import { test } from "node:test";
import assert from "node:assert/strict";
import { applyToLifts, blocks, sayConstraints, type TrainingConstraint } from "../lib/plan/constraints";
import { readByWords } from "../lib/plan/read-injuries";
import { liftsFor, kitFrom, strengthTarget } from "../lib/plan/strength";
import { describe } from "../lib/plan/exercises";

/**
 * Training around something.
 *
 * What is worth testing here is not whether a sentence is read well — that is a model's job
 * and the keyword reader's floor. It is that the vocabulary cannot do anything except remove
 * and substitute, that a substitution keeps the session a session, and that a constraint
 * nobody confirmed changes nothing.
 */

const pattern = (name: string) => describe(name)?.pattern ?? null;
const KIT = kitFrom(["Barbell and plates", "Kettlebells", "Pull-up rig"]);

const knee: TrainingConstraint = {
  avoid_pattern: "single_leg",
  quote: "left knee hates deep lunging",
  because: "every single-leg lift is a lunge",
};

test("a confirmed constraint replaces the lift rather than leaving a hole", () => {
  const before = liftsFor("build", 1, KIT);
  const after = liftsFor("build", 1, KIT, 0, [knee]);

  assert.ok(before.some((l) => pattern(l.name) === "single_leg"),
    "the session has single-leg work to begin with");
  assert.equal(after.filter((l) => pattern(l.name) === "single_leg").length, 0,
    "and none after");
  assert.equal(after.length, before.length,
    "the session is the same length: 200 m of race lunges still has to be trained");
  assert.ok(after.some((l) => /split squat, short range/i.test(l.name)));
});

test("the swap says whose words it came from", () => {
  const swapped = liftsFor("build", 1, KIT, 0, [knee])
    .find((l) => /split squat, short range/i.test(l.name));
  assert.match(swapped?.note ?? "", /left knee hates deep lunging/,
    "an unexplained substitution reads as the plan having forgotten what it was doing");
});

test("no constraints changes nothing at all", () => {
  assert.deepEqual(liftsFor("build", 3, KIT, 1, []), liftsFor("build", 3, KIT, 1));
  assert.deepEqual(liftsFor("base", 2, KIT, 0, []), liftsFor("base", 2, KIT, 0));
});

test("a named movement is dropped rather than replaced with an invention", () => {
  const lifts = [
    { name: "Back squat", sets: 3, reps: 5, rest: 180 },
    { name: "Pull-up", sets: 3, reps: 6, rest: 120 },
  ];
  const out = applyToLifts(lifts, [{
    avoid_movement: "pull-up", quote: "no pull-ups", because: "you said so",
  }], pattern);
  assert.deepEqual(out.map((l) => l.name), ["Back squat"],
    "'no pull-ups' is a clear instruction; a pull-up-shaped replacement is not what was asked");
});

test("two constraints on the same pattern do not lengthen the session", () => {
  const out = liftsFor("build", 1, KIT, 0, [
    knee,
    { avoid_pattern: "single_leg", quote: "and the step-ups", because: "same knee" },
  ]);
  assert.equal(out.filter((l) => /split squat, short range/i.test(l.name)).length, 1);
});

test("the written prescription carries the substitution through", () => {
  const target = strengthTarget("build", 1, KIT, 0, [knee]);
  assert.match(target, /Split squat, short range 3x10 rest 90s/);
  assert.doesNotMatch(target, /Rear-foot elevated split squat/);
  /* Still parseable as the app's strength syntax: name, sets x reps, rest. */
  for (const line of target.split("\n")) {
    assert.match(line, /^[A-Za-z].* \d+x\d+ rest \d+s( rpe \d+)?$/, line);
  }
});

test("blocks matches a pattern and a name, and nothing else", () => {
  assert.equal(blocks(knee, "Weighted step-up", "single_leg"), true);
  assert.equal(blocks(knee, "Back squat", "squat"), false);
  assert.equal(blocks({ avoid_movement: "burpee", quote: "q", because: "b" },
    "Burpee broad jump", null), true);
});

test("the keyword reader says nothing about a note that says nothing", () => {
  for (const s of ["", "  ", "none", "No", "nothing", "n/a", "all good"]) {
    const r = readByWords(s);
    assert.equal(r.constraints.length, 0, JSON.stringify(s));
    assert.equal(r.unactionable.length, 0);
  }
});

test("'knee is fine' is not read as a complaint", () => {
  /*
   * The failure that matters most: reading what does NOT hurt as what does removes the one
   * thing the athlete can still do. Where it is unsure it says nothing, and the plan behaves
   * exactly as it did before any of this existed.
   */
  assert.equal(readByWords("Knee is fine now, fully healed.").constraints.length, 0);
});

test("a qualified all-clear is still a complaint", () => {
  /*
   * "Left knee is fine straight but hates deep lunging" is the exact sentence this feature
   * exists for, and a bare search for "fine" threw it away — the reassurance is about one
   * range of motion and the complaint is about another. Caught end to end against a real
   * intake, not here first.
   */
  const r = readByWords("Left knee is fine straight but hates deep lunging.");
  assert.equal(r.constraints[0]?.avoid_pattern, "single_leg");
  assert.equal(r.constraints[0]?.quote, "Left knee is fine straight but hates deep lunging.",
    "quoted as a sentence: a character window produced 'aight but hates deep lunging'");
});

test("two niggles in two sentences are read as two constraints", () => {
  const r = readByWords(
    "Left knee is fine straight but hates deep lunging. Achilles grumbling since April.",
  );
  assert.deepEqual(r.constraints.map((c) => c.avoid_pattern), ["single_leg", "calf"]);
});

test("a common phrasing is read into a pattern", () => {
  const r = readByWords("Dodgy left shoulder, overhead is a no.");
  assert.equal(r.constraints[0]?.avoid_pattern, "press");
  assert.match(r.constraints[0]?.because ?? "", /overhead/);
});

test("something medical is surfaced, not silently ignored and not diagnosed", () => {
  const r = readByWords("Get a bit dizzy and short of breath on hard efforts.");
  assert.equal(r.constraints.length, 0, "there is no substitution for this");
  assert.equal(r.unactionable.length, 1);
  const why = r.unactionable[0].why;
  assert.match(why, /not medical advice|someone qualified/i);
  /* It must not name a condition or tell them what to do beyond seeing a person. */
  assert.doesNotMatch(why, /asthma|anaemia|heart condition|you should take|rest for/i);
});

test("what is being trained around is said in one line", () => {
  assert.equal(sayConstraints([]), "");
  assert.match(sayConstraints([knee]), /single-leg/);
  assert.match(sayConstraints([knee]), /change this any time/);
});
