import { test } from "node:test";
import assert from "node:assert/strict";
import { continuousRun, hyroxSession, qualityRun, readRung } from "../lib/plan/session";
import { parseSteps, parseStrength, repCount } from "../lib/prescription";
import { kitFrom, strengthTarget } from "../lib/plan/strength";

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
  /*
   * Never below two reps: one rep is a different session, not a smaller one. So
   * when two still will not fit, the reps themselves come down — 2 × 500 m rather
   * than a session that quietly overruns the week it is in.
   */
  const tiny = qualityRun("6 × 1000 m", 250, 310, 4);
  assert.equal(tiny.title, "2 × 500 m");
  assert.ok(tiny.km <= 4.6, `${tiny.km} km`);
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

test("a strength session prescribes lifts, from the kit the athlete has", () => {
  // The screen said "no lifts prescribed for this one" above a session the plan had
  // put in the week and told the athlete to protect.
  const full = strengthTarget("build", 3, kitFrom(["Barbell", "Kettlebells", "Rig or pull-up bar"]));
  const lifts = parseStrength(full);
  assert.ok(lifts.length >= 4, full);
  for (const l of lifts) {
    assert.ok(l.sets > 0 && l.reps > 0, `${l.name} has a set scheme`);
  }
  assert.ok(lifts.some((l) => /deadlift|squat/i.test(l.name)), "a main lift");

  // Nothing but a floor: the session still exists, with what can be done on it.
  const bodyweight = parseStrength(strengthTarget("base", 2, kitFrom([])));
  assert.ok(bodyweight.length >= 4);
  assert.ok(!bodyweight.some((l) => /barbell|back squat/i.test(l.name)), "no barbell");
});

test("the phase decides the scheme, not the exercise list", () => {
  const kit = kitFrom(["Barbell"]);
  const base = parseStrength(strengthTarget("base", 1, kit))[0];
  const build = parseStrength(strengthTarget("build", 1, kit))[0];
  const taper = parseStrength(strengthTarget("taper", 1, kit))[0];
  assert.ok(base.reps > build.reps, `${base.reps} vs ${build.reps}`);
  assert.ok(taper.sets < build.sets, `${taper.sets} vs ${build.sets}`);
});
