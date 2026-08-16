import { test } from "node:test";
import assert from "node:assert/strict";
import { continuousRun, hyroxSession, qualityRun, readRung } from "../lib/plan/session";
import { parseSteps, repCount } from "../lib/prescription";

test("a rung label is read back into what it asks for", () => {
  assert.deepEqual(readRung("6 × 800 m"), { shape: "reps", reps: 6, metres: 800 });
  assert.deepEqual(readRung("3 × 15 min"), { shape: "reps_time", reps: 3, seconds: 900 });
  assert.deepEqual(readRung("20 min continuous"), { shape: "continuous", seconds: 1200 });
  assert.deepEqual(readRung("8 × 100 m"), { shape: "strides", reps: 8, metres: 100 });
  assert.deepEqual(readRung("6 × (3 min run / 1 min walk)"),
    { shape: "alternating", reps: 6, onSeconds: 180, offSeconds: 60 });
  assert.equal(readRung("Something nobody wrote"), null);
});

test("a session is written out, and the app can read it back", () => {
  // The screen renders warm-up, the reps and the cool-down from this text. It used
  // to receive "13.4 km @ Zone 4", which is one line and nothing to do.
  const built = qualityRun("6 × 800 m", 250, 310);
  const groups = parseSteps(built.target);
  assert.deepEqual(groups.map((g) => g.label), ["Warm-up", "6 ×", "Cool-down"]);
  assert.equal(repCount(groups), 6, "six reps, not eight with the warm-up counted");
  // The rest scales with the rep: an 800 m rep at 4:10 /km is 200 seconds of work,
  // which earns two minutes rather than ninety seconds.
  assert.match(built.target, /\d+s Z1 walk/, "the rest between reps is prescribed");
});

test("two different sessions are two different sizes", () => {
  /*
   * Both of these used to come back at 13.4 km and 80 minutes, because the session
   * was sized by dividing the week rather than by looking at what was in it.
   */
  const reps = qualityRun("5 × 1000 m", 250, 310);
  const threshold = qualityRun("2 × 15 min", 250, 310);
  assert.notEqual(reps.km, threshold.km);
  assert.notEqual(reps.minutes, threshold.minutes);
  // 2 × 15 min is 30 minutes of work: with a warm-up and a cool-down that is under
  // an hour and under 12 km, whatever the week around it says.
  assert.ok(threshold.minutes < 60, `${threshold.minutes} min`);
  assert.ok(threshold.km < 12, `${threshold.km} km`);
});

test("the week can trim the session, and the title follows it", () => {
  // A race week of 22 km cannot hold a 12.6 km interval session. Reps come off,
  // and the name says what is actually prescribed.
  const full = qualityRun("6 × 1000 m", 250, 310);
  const trimmed = qualityRun("6 × 1000 m", 250, 310, 9);
  assert.ok(trimmed.km < full.km, `${trimmed.km} vs ${full.km}`);
  assert.equal(trimmed.title, "5 × 1000 m");
  assert.equal(repCount(parseSteps(trimmed.target)), 5);
  // Never below two: one rep is a different session, not a smaller one.
  assert.equal(qualityRun("6 × 1000 m", 250, 310, 4).title, "2 × 1000 m");
});

test("an easy run says one thing, and a Hyrox session alternates", () => {
  const easy = continuousRun(8, 310);
  assert.equal(parseSteps(easy.target).length, 1);
  assert.equal(easy.minutes, 41);

  const hyrox = hyroxSession("Hyrox · transitions", 310);
  const groups = parseSteps(hyrox.target);
  assert.ok(groups.some((g) => /×/.test(g.label)), "it repeats");
  assert.match(hyrox.target, /station/, "the station is in the session");
});
