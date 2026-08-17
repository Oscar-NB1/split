import { test } from "node:test";
import assert from "node:assert/strict";
import { continuousRun, easyHyrox, hyroxSession, qualityRun, readRung } from "../lib/plan/session";
import { EASY_MAX_KM, generate } from "../lib/plan/generate";
import { paramsFrom } from "../lib/plan/from-intake";
import type { Intake } from "../lib/intake";

/** A big week: 70 km at peak, seven sessions, which is where 15 km easy runs came from. */
const bigWeek = (o: Partial<Intake> = {}): Intake => ({
  hasRace: "Yes", discipline: "Hyrox doubles", raceDistance: null,
  raceDate: "2026-11-29", role: null, division: "Mixed doubles", longRunDay: "Sun",
  base: "Several years", runningSelf: "Runs regularly",
  paceMin: 19, paceSec: 30, paceUnknown: false,
  peakWeekKm: 70, longestRunKm: 24, volumeSource: "self",
  goal: "Compete", goalMin: 62, startDate: "2026-08-17",
  targetSessions: "7", allowDoubles: null, wantRestDay: "No, but keep one easy",
  sessionPref: "Written sessions", hyroxExp: "Weekly", runDelta: "About the same",
  stationDelta: "About the same", gymAccess: "Open floor, any time",
  runStationLink: "Yes, with a walk between",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  commitments: [], freq: {}, commitDay: {}, commitMode: {},
  equipment: ["Sled — race weight", "SkiErg", "Rower", "Wall balls", "Kettlebells", "Barbell"],
  sled: "Race weight and distance", injuries: "",
  volume: "Progressive", difficulty: "Hard", benchmark: "scheduled",
  pastRaces: [], bRaces: [],
  ...o,
} as Intake);
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

test("an easy run says one thing, and a Hyrox session is a list of things to do", () => {
  const easy = continuousRun(8, 310);
  assert.equal(parseSteps(easy.target).length, 1);
  assert.equal(easy.minutes, 41);

  /*
   * It used to end "1 station Z4", which is a note to a coach rather than an
   * instruction: it tells the athlete a station goes here without saying which one,
   * how much of it, or in what order.
   */
  const kit = { barbell: true, kettlebells: true, rig: true, sled: true };
  const hyrox = hyroxSession("Hyrox · transitions", 310);
  assert.doesNotMatch(hyrox.target, /1 station/, "no placeholder stations");
  const named = ["SkiErg", "Sled", "Row", "Wall balls", "burpee", "carry", "lunge"];
  assert.ok(
    named.filter((n) => new RegExp(n, "i").test(hyrox.target)).length >= 2,
    `stations are named and dosed:\n${hyrox.target}`);
  // Run, station, run, station — the shape of the race — inside a repeated round.
  const lines = hyrox.target.split("\n");
  /*
   * Compromised running repeats an identical round, so it states the count and the rest
   * between rounds. Transitions deliberately does neither — every round is a different
   * station and there is no rest anywhere, which is the session.
   */
  const compro = hyroxSession("Hyrox · compromised running", 310, 4, kit, 1).target
    .split("\n");
  assert.ok(compro.some((l) => /rest between rounds/.test(l)),
    "compromised running states the rest between its rounds");
  const body = lines.filter((l) => !/warm up|cool down|rest between|^- \dx$/.test(l));
  body.forEach((l, i) => {
    if (i % 2 === 0) assert.match(l, /^- \d+m Z3/, `line ${i} is a run`);
  });

  /*
   * And the four rungs are four different sessions.
   *
   * They were the same structure under four names — run 400 m, do a station, repeat —
   * which is the plan claiming a progression it does not have.
   */
  const shapeOf = (l: string) => hyroxSession(l, 310, 4, kit, 1).target;
  const compromised = shapeOf("Hyrox · compromised running");
  const transitions = shapeOf("Hyrox · transitions");
  const half = shapeOf("Hyrox · half simulation");
  assert.notEqual(compromised, transitions);
  assert.match(compromised, /600m|800m|1000m/, "long runs off heavy stations");
  assert.match(transitions, /200m/, "short runs, many changeovers");
  assert.doesNotMatch(transitions, /rest between rounds/, "and no rest in transitions");
  assert.match(half, /1000m/, "race distances in a simulation");
});

test("a Hyrox session rotates its stations, and respects the kit", () => {
  const kit = { barbell: true, kettlebells: true, rig: true, sled: true };
  const one = hyroxSession("Hyrox · transitions", 310, 4, kit, 1);
  const five = hyroxSession("Hyrox · transitions", 310, 4, kit, 5);
  assert.notEqual(one.target, five.target, "week 5 is not week 1's stations again");

  // No sled and no kettlebells: the pattern still gets trained, with what they have.
  const bare = hyroxSession("Hyrox · transitions", 310, 8,
    { barbell: false, kettlebells: false, rig: false, sled: false }, 2, null);
  assert.doesNotMatch(bare.target, /25 m Sled|100 m Farmers/, "nothing they cannot reach");
  assert.match(bare.target, /substituted/, "the substitution is stated, not silent");
});

test("an easy Hyrox session carries no running volume and no heavy stations", () => {
  const built = easyHyrox();
  assert.equal(built.km, 0, "compromised work never counts as running volume");
  assert.doesNotMatch(built.target, /[Ss]led|[Ss]andbag|[Ff]armers/, "nothing heavy on an easy day");
  assert.match(built.target, /row/i);
  assert.match(built.target, /Ski/i);
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

test("the strength session lifts, and leaves the stations to the Hyrox session", () => {
  /*
   * It used to prescribe wall balls and sandbag lunges — stations, not strength.
   * That spends the one session a week that can make an athlete stronger on
   * movements the Hyrox session already rehearses, and leaves the thing that limits
   * the sled, the lunge and the carry untrained.
   */
  const kit = kitFrom(["Barbell", "Kettlebells", "Rig or pull-up bar"]);
  for (const phase of ["base", "build", "specific", "taper"] as const) {
    for (const week of [1, 2]) {
      const lifts = parseStrength(strengthTarget(phase, week, kit));
      const names = lifts.map((l) => l.name.toLowerCase()).join(" | ");
      assert.ok(!/wall ball|sandbag/.test(names), `${phase} w${week}: ${names}`);
      // Every session: something heavy on two legs or a hinge, something on one
      // leg, and grip. Those are what a Hyrox takes out of the gym.
      assert.match(names, /squat|deadlift/, names);
      assert.match(names, /split squat|step-up|lunge/, names);
      assert.match(names, /carry|hang|hold/, names);
    }
  }
});

test("no kit still produces a session anyone can do", () => {
  const lifts = parseStrength(strengthTarget("build", 1, kitFrom([])));
  assert.ok(lifts.length >= 4);
  const names = lifts.map((l) => l.name.toLowerCase()).join(" | ");
  assert.ok(!/barbell|kettlebell|pull-up/.test(names), names);
  assert.match(names, /lunge|squat/, names);
});

test("an easy run is never a long run wearing an easy label", () => {
  /*
   * Filling the week's volume from the easy sessions produced 15 km "easy runs":
   * two thirds of a 22 km long run is still 14.7, which needs its own recovery day
   * and eats into the next hard session. Eleven is the ceiling, whatever the
   * arithmetic wants.
   */
  const g = generate(paramsFrom(bigWeek(), {
    recent: null, absences: [], max_hr: 185, measured: false,
  }));
  for (const w of g.weeks) {
    for (const s of w.sessions) {
      if (String(s.kind) !== "easy_run") continue;
      assert.ok((s.km ?? 0) <= EASY_MAX_KM + 0.1,
        `week ${w.n}: a ${s.km} km easy run`);
    }
  }
});

test("a first week never halves the longest run the athlete has already done", () => {
  /*
   * The long run was a flat 32% of the week's volume, so a 34 km first week produced a
   * 10.9 km "long run" for somebody whose longest run on file is 19 km. Nothing about
   * starting a block makes a person forget how to run for two hours.
   *
   * The share still shapes the ramp; their own longest run is the floor under it, at
   * 90% — and the weekly ramp still outranks both, because that curve is a safety
   * rule and a long-run floor is not.
   */
  const g = generate(paramsFrom(bigWeek({ peakWeekKm: 38, longestRunKm: 19 }), {
    recent: null, absences: [], max_hr: 185, measured: false,
  }));
  const w1 = g.weeks[0];
  const long = w1.sessions.find((s) => String(s.kind) === "long_run");
  assert.ok((long?.km ?? 0) >= 12,
    `week 1's long run is ${long?.km} km against a 19 km longest run`);
  assert.ok((long?.km ?? 0) <= w1.km * 0.42,
    `and ${long?.km} km is not most of a ${w1.km} km week`);

  // it still grows, and still stops at the cap
  const longs = g.weeks.map((w) =>
    (w.sessions.find((s) => String(s.kind) === "long_run")?.km ?? 0));
  assert.ok(Math.max(...longs) > (long?.km ?? 0), "it grows across the block");
  assert.ok(Math.max(...longs) <= 22.1, "and never past 22 km");
});

test("an athlete with no history is not given a long run out of nowhere", () => {
  // The floor only exists where there is a number behind it. Without one the share
  // decides, which is the conservative answer and the correct one.
  const g = generate(paramsFrom(bigWeek({
    peakWeekKm: 12, longestRunKm: null, runningSelf: "I do not run",
  }), { recent: null, absences: [], max_hr: 185, measured: false }));
  const w1 = g.weeks[0];
  const long = w1.sessions.find((s) => String(s.kind) === "long_run");
  assert.ok((long?.km ?? 0) <= w1.km * 0.45, `${long?.km} km of a ${w1.km} km week`);
});

test("somebody who cannot run yet is not given four times eight hundred metres", () => {
  /*
   * The session shapes describe an athlete who runs. Handed to somebody who does not,
   * 4 × 800 m at threshold off a race-weight sled is not a hard session — it is an
   * impossible one, and the honest response to an impossible session is to stop
   * training rather than to fail it every Saturday.
   *
   * The skill still matters: meeting fatigue before a run is exactly what a beginner
   * needs early, and it does not take eight hundred metres to teach it.
   */
  const kit = { barbell: true, kettlebells: true, rig: true, sled: true };
  const loads = {
    sled_push_total_kg: 152, sled_pull_total_kg: 103,
    farmers_kg: 24, lunge_kg: 20, wall_ball_kg: 6,
  };
  const runner = hyroxSession("Hyrox · compromised running", 380, 4, kit, 1, loads,
    "runs_regularly");
  const walker = hyroxSession("Hyrox · compromised running", 380, 4, kit, 1, loads,
    "doesnt_run");

  assert.match(runner.target, /600m|800m|1000m/, "a runner gets a real run");
  assert.match(walker.target, /200m/, "short enough to run without stopping");
  assert.doesNotMatch(walker.target, /600m|800m|1000m/);
  assert.ok(walker.km < runner.km, `${walker.km} km against ${runner.km} km`);

  /*
   * And no race weight. "25 m sled push at 152 kg" to somebody in their first month is
   * how people get hurt; the cue tells them how to pick a load instead.
   */
  assert.match(runner.target, /152 kg/);
  assert.doesNotMatch(walker.target, /kg/, "no prescribed weight for a beginner");
  assert.match(walker.note ?? "", /walk it if you cannot/i);

  // Rest, and enough of it. Continuous work is a later problem.
  assert.match(walker.target, /120s Z1 rest/);
});

test("a simulation is not prescribed to somebody who cannot run it", () => {
  const kit = { barbell: true, kettlebells: true, rig: true, sled: true };
  const sim = hyroxSession("Hyrox · full simulation", 380, 4, kit, 1, null, "doesnt_run");
  assert.doesNotMatch(sim.target, /1000m/, "no kilometre repeats");
  assert.ok(sim.km <= 2, `${sim.km} km of running in a beginner's simulation`);
});

test("a race-specific session builds across the block", () => {
  /*
   * Week 1's compromised running was week 14's: 4 × 800 m off two stations, every week,
   * with only the choice of station rotating — which is a different session in the way
   * that a different colour of shirt is a different outfit.
   */
  const kit = { barbell: true, kettlebells: true, rig: true, sled: true };
  const at = (phase: string, wk: number) =>
    hyroxSession("Hyrox · compromised running", 310, 4, kit, wk + 1, null,
      "runs_regularly", phase, wk);

  const early = at("base", 0);
  const mid = at("build", 1);
  const late = at("specific", 1);

  assert.match(early.target, /600m/, "the run starts shorter");
  assert.match(mid.target, /800m/);
  assert.match(late.target, /1000m/, "and finishes at a kilometre");
  assert.ok(early.km < mid.km && mid.km < late.km,
    `${early.km} → ${mid.km} → ${late.km} km`);
  assert.ok(early.minutes < late.minutes);
});

test("transitions builds by adding changeovers, not by lengthening the runs", () => {
  // The changeover is the session, so more of them is what harder means.
  const kit = { barbell: true, kettlebells: true, rig: true, sled: true };
  const at = (phase: string, wk: number) =>
    hyroxSession("Hyrox · transitions", 310, 4, kit, 1, null, "runs_regularly", phase, wk);
  const early = at("base", 0);
  const late = at("specific", 1);
  /*
   * Measured as work, not as printed lines. There are only eight stations in a Hyrox, so
   * a sixteen-slot session writes one round and a repeat count — the same total work,
   * written more compactly.
   */
  assert.ok(late.minutes > early.minutes,
    `${early.minutes} → ${late.minutes} minutes of work`);
  assert.match(early.target, /200m/, "and the runs stay short throughout");
  assert.match(late.target, /200m/);
  assert.doesNotMatch(late.target, /800m|1000m/);
});

test("the stations change between rounds rather than repeating one", () => {
  /*
   * This was backwards: a repeat count was used whenever there were *enough* stations
   * to fill every round, so "4 ×" meant the same sled push and the same ski, four
   * times. A race has eight different stations and no repeats.
   */
  const kit = { barbell: true, kettlebells: true, rig: true, sled: true };
  const s = hyroxSession("Hyrox · compromised running", 310, 4, kit, 1, null,
    "runs_regularly", "build", 1);
  const names = s.target.split("\n")
    .filter((l) => !/Z[0-9]|warm|cool|^- \dx$/.test(l))
    .map((l) => l.replace(/^- \S+\s*(m|reps)?\s*/, ""));
  assert.ok(new Set(names).size >= 3,
    `only ${new Set(names).size} distinct stations in ${names.length}: ${names.join(", ")}`);
  assert.doesNotMatch(s.target, /^- \dx$/m, "no repeat count where the rounds differ");
});
