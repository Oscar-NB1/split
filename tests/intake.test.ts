import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOC, BASE_KM, BENCH_VARIANTS, COMMITMENT, DIVISION, RUN_CEIL, RUN_RAMP,
  STANDARDS, type Intake,
  allocationFor, divisionsFor, heavyDays, liveQuestions, needsStandards,
  setClock, standardsFor, validate,
} from "../lib/intake";
import {
  generate, phaseSplit, placeWeek, resolve, strengthFor, volumeFor,
} from "../lib/generate";

setClock(() => "2026-08-10");

/**
 * The athlete the plan spec describes: over a year of consistent training, but
 * runs with walk breaks. Protected partner in mixed doubles, race Wed 28 Oct,
 * a spin class fixed to Wednesday.
 */
const HER: Intake = {
  hasRace: "Yes",
  discipline: "Hyrox doubles",
  raceDistance: null,
  raceDate: "2026-10-28",
  role: "Protected",
  division: "Mixed doubles",
  base: "Over a year",
  runningSelf: "Runs with walk breaks",
  paceMin: 32, paceSec: 0, paceUnknown: false,
  peakWeekKm: null, longestRunKm: null, volumeSource: null,
  goal: null, goalMin: null, startDate: null, targetSessions: null,
  allowDoubles: null, wantRestDay: null, sessionPref: null, hyroxExp: null,
  runDelta: null, stationDelta: null, gymAccess: null,
  days: ["Tue", "Wed", "Thu", "Fri", "Sat"],
  commitments: ["Spin class"],
  freq: { "Spin class": 1 },
  commitDay: { "Spin class": ["Wed"] },
  equipment: ["Sled — race weight", "SkiErg", "Rower", "Wall balls"],
  sled: "Used a lighter sled",
  injuries: null,
  volume: "Progressive",
  difficulty: "Challenging",
  benchmark: "offered",
};

// ------------------------------------------------- the correction that matters

test("running self caps the training-base matrix, not the other way round", () => {
  // reading training base alone prescribes 30 km in week 1 to someone who cannot
  // yet run 5 km continuously — how people get hurt in week 3
  assert.equal(BASE_KM["Over a year"], 30, "what training base alone would say");
  assert.equal(RUN_CEIL["Runs with walk breaks"], 15, "what her running supports");
  const r = resolve(HER);
  assert.equal(r.rawStart, 15, "the lower of the two wins");
});

test("the running ladder has seven rungs, each with its own ceiling and ramp", () => {
  const ceilings = [8, 15, 22, 34, 48, 70, 999];
  const ramps = [6, 8, 9, 10, 10, 12, 12];
  const order = [
    "I do not run", "Runs with walk breaks", "5 km nonstop", "Runs regularly",
    "Half marathon fit", "Marathon runner", "Competitive",
  ] as const;
  order.forEach((k, i) => {
    assert.equal(RUN_CEIL[k], ceilings[i], `${k} ceiling`);
    assert.equal(RUN_RAMP[k], ramps[i], `${k} ramp`);
  });
});

test("the ramp is the lower of the base allowance and the running allowance", () => {
  // her engine is trained; her running tissue is not
  assert.equal(resolve(HER).baseRamp, 10);
  assert.equal(resolve(HER).runRamp, 8);
  assert.equal(resolve(HER).ramp, 8, "8, not the 10 her training history implies");
});

// -------------------------------------------------- the conservatism differential

test("without a benchmark, week 1 is held 15% below the ceiling and the ramp capped", () => {
  const r = resolve(HER);
  assert.ok(r.estimated);
  assert.equal(r.startKm, Math.round(15 * 0.85), "85% of the ceiling");
  assert.ok(r.ramp <= 8, "capped at 8%");
  assert.equal(r.planState, "estimated");
  assert.ok(r.corrections.some((c) => /15% below your ceiling/.test(c.title)));
});

test("a logged benchmark restores the full ceiling and lifts the ramp cap", () => {
  const r = resolve({ ...HER, benchmark: "logged", runningSelf: "Marathon runner" });
  assert.ok(r.measured);
  assert.equal(r.startKm, r.rawStart, "the full ceiling, not 85% of it");
  assert.equal(r.ramp, 10, "no longer held to 8");
  assert.equal(r.planState, "measured");
  assert.ok(!r.corrections.some((c) => /15% below/.test(c.title)));
});

test("several years of training is what makes the 12% cap reachable", () => {
  // Before, the base allowance topped out at 10 for every answer, so a measured
  // plan "ramping up to 12%" was true of the ceiling and of nothing else.
  const best = resolve({
    ...HER, benchmark: "logged", runningSelf: "Competitive", base: "Several years",
  });
  assert.equal(best.baseRamp, 12);
  assert.equal(best.runRamp, 12);
  assert.equal(best.ramp, 12, "the cap is reachable now, and only here");
});

test("the ramp is still the lowest of the three, whichever binds", () => {
  const runBound = resolve({ ...HER, benchmark: "logged", base: "Several years" });
  assert.equal(runBound.baseRamp, 12);
  assert.equal(runBound.ramp, 8, "her running still binds at 8");
  const capBound = resolve({ ...HER, runningSelf: "Competitive", base: "Several years" });
  assert.equal(capBound.ramp, 8, "and without a benchmark the 8% cap binds");
});

// ------------------------------------------------------------ the safety gate

test("the gate fires on an injury note, a thin base, or not running yet", () => {
  assert.equal(resolve(HER).gate, null, "silent unless triggered");
  assert.match(resolve({ ...HER, injuries: "Achilles" }).gate ?? "", /Injury noted/);
  assert.match(resolve({ ...HER, base: "Under 3 months" }).gate ?? "", /under three months/);
  assert.match(resolve({ ...HER, runningSelf: "I do not run" }).gate ?? "", /Not yet running/);
});

test("a fired gate downgrades the benchmark to the submaximal variant", () => {
  const r = resolve({ ...HER, injuries: "Achilles" });
  assert.equal(r.variant, "submax");
  assert.equal(BENCH_VARIANTS.submax.stations.length, 3, "one round fewer");
  assert.ok(generate({ ...HER, injuries: "Achilles" }).flags
    .some((f) => /submaximal variant/.test(f)));
});

test("the variant comes from equipment, so a missing sled never blocks the test", () => {
  const at = (equipment: Intake["equipment"]) => resolve({ ...HER, equipment }).variant;
  assert.equal(at(["Sled — race weight", "SkiErg", "Rower", "Wall balls"]), "full");
  assert.equal(at(["Sled — lighter only"]), "gym");
  assert.equal(at(["Barbell"]), "gym");
  assert.equal(at([]), "field", "no equipment still gets a benchmark");
  assert.equal(BENCH_VARIANTS.field.stations.length, 4);
});

test("a race under three weeks away suppresses the offer entirely", () => {
  // too close to spend a session testing
  const soon = resolve({ ...HER, raceDate: "2026-08-28" });
  assert.ok(soon.offerSuppressed);
  assert.ok(!resolve(HER).offerSuppressed);
  assert.ok(generate({ ...HER, raceDate: "2026-08-28" }).flags
    .some((f) => /Too close to spend a session testing/.test(f)));
});

// ------------------------------------------------------------------ the block

test("the block runs from the Monday after today to race week", () => {
  const p = generate(HER);
  assert.equal(p.start, "2026-08-17");
  // 10 weeks plus race week: rounding to nearest gives 10 and leaves race day
  // two days outside the block it is the point of
  assert.equal(p.weeks, 11);
  assert.equal(p.race_date, "2026-10-28");
  assert.equal(p.volume.length, 11);
  assert.equal(p.shapes.length, 11);
});

test("phases split 30/30/25/15", () => {
  assert.deepEqual(phaseSplit(11), [3, 3, 3, 2]);
  for (const w of [4, 8, 12, 16, 24]) {
    assert.ok(phaseSplit(w).every((n) => n >= 1), `${w}: no empty phase`);
  }
});

test("deloads land every fourth week and never in the taper", () => {
  const r = resolve(HER);
  const v = volumeFor(HER, r);
  assert.equal(v[3].note, "Down week");
  assert.ok(v[3].km < v[2].km);
  assert.equal(v[v.length - 1].phase, "taper");
});

test("a deload does not reset the climb", () => {
  // the failure this prevents is a later peak lower than an earlier one
  const v = volumeFor(HER, resolve(HER));
  assert.ok(v[4].km > v[2].km, `week 5 (${v[4].km}) resumes above week 3 (${v[2].km})`);
});

test("week 1 says whether the benchmark is in it, and 5 and 9 are retests", () => {
  const scheduled = volumeFor({ ...HER, benchmark: "scheduled" }, resolve({ ...HER, benchmark: "scheduled" }));
  assert.match(scheduled[0].note, /Benchmark test/);
  assert.match(scheduled[4].note, /retest · identical protocol/);
  assert.match(scheduled[8].note, /retest · identical protocol/);
  const skipped = volumeFor(HER, resolve(HER));
  assert.match(skipped[0].note, /Conservative start — run the benchmark to lift it/);
});

test("an accepted benchmark is session 1 of week 1, not a separate flow", () => {
  const p = generate({ ...HER, benchmark: "scheduled" });
  const first = p.shapes[0].find((d) => d.significance === "benchmark");
  assert.ok(first, "week 1 carries the test");
  assert.match(first!.target ?? "", /400 m run/);
  // and the retests use the identical protocol, or the comparison is meaningless
  const five = p.shapes[4].find((d) => d.significance === "benchmark");
  const nine = p.shapes[8].find((d) => d.significance === "benchmark");
  assert.equal(five!.target, first!.target);
  assert.equal(nine!.target, first!.target);
  // every other week goes back to a key session rather than testing forever
  const weeksWithTest = p.shapes
    .map((w, i) => (w.some((d) => d.significance === "benchmark") ? i + 1 : 0))
    .filter(Boolean);
  assert.deepEqual(weeksWithTest, [1, 5, 9]);
});

// ---------------------------------------------------------------- the branching

test("only the questions that apply are asked", () => {
  const doubles = liveQuestions({ discipline: "Hyrox doubles", hasRace: "Yes" });
  assert.ok(doubles.includes("role"), "doubles is asked which partner");
  assert.ok(doubles.includes("division") && doubles.includes("sled"));
  assert.ok(!doubles.includes("raceDistance"));

  const singles = liveQuestions({ discipline: "Hyrox singles", hasRace: "Yes" });
  assert.ok(!singles.includes("role"), "singles carries the whole race");

  const road = liveQuestions({ discipline: "Running race", hasRace: "Yes" });
  assert.ok(road.includes("raceDistance"));
  assert.ok(!road.includes("division") && !road.includes("sled"));

  assert.ok(!liveQuestions({ discipline: "General fitness", hasRace: "No" }).includes("raceDate"));
});

test("a question never put is never demanded", () => {
  // requiring a division from a marathon runner makes the form impossible, not safe
  const road: Intake = {
    ...HER, discipline: "Running race", raceDistance: "Half marathon",
    role: null, division: null, sled: null,
  };
  assert.deepEqual(validate(road), []);
});

test("division options depend on the discipline", () => {
  assert.ok(divisionsFor("Hyrox doubles").includes("Mixed doubles"));
  assert.ok(!divisionsFor("Hyrox singles").includes("Mixed doubles"));
  assert.ok(divisionsFor("Hyrox singles").includes("Women · open"));
});

// ---------------------------------------------------------------- allocation

test("the protected partner's week is weighted to running", () => {
  assert.deepEqual(ALLOC.Protected, [60, 25, 15]);
  assert.deepEqual(ALLOC.Engine, [45, 35, 20], "the engine takes the sled and lunges");
  assert.deepEqual(allocationFor(HER), [60, 25, 15]);
});

test("the disciplines that are not a pair have their own split", () => {
  assert.deepEqual(allocationFor({ ...HER, discipline: "Running race", role: null }), [80, 0, 20]);
  assert.deepEqual(allocationFor({ ...HER, discipline: "Hyrox singles", role: null }), [45, 35, 20]);
});

// ---------------------------------------------------------------- the goal time

test("a running goal is Riegel-scaled to the actual distance", () => {
  // multiplying a 5 km time by thirteen was passing as a marathon goal
  const half = resolve({ ...HER, discipline: "Running race", raceDistance: "Half marathon" });
  const five = resolve({ ...HER, discipline: "Running race", raceDistance: "5 km" });
  assert.equal(five.goalSeconds, 32 * 60, "a 5 km goal is the 5 km time");
  assert.ok(half.goalSeconds! > five.goalSeconds! * 4, "a half is more than four 5Ks");
  assert.ok(half.goalSeconds! < five.goalSeconds! * 5, "and less than five of them");
});

test("Hyrox has no goal time until the baseline lands", () => {
  // it comes from station capability, not from a 5 km time
  assert.equal(resolve(HER).goalSeconds, null);
  assert.equal(generate(HER).goal_seconds, null);
});

test("no 5 km time means no pace anchor and sessions by effort", () => {
  const blind = generate({ ...HER, paceUnknown: true });
  assert.equal(blind.easy_pace, null);
  const key = blind.shapes[1].find((d) => d.kind === "run_intervals");
  assert.doesNotMatch(key!.title, /@/, "no invented pace");
  assert.match(key!.coach_note ?? "", /By effort until the baseline/);
  assert.ok(blind.flags.some((f) => /No pace anchor/.test(f)));
});

// --------------------------------------------------------------- commitments

test("a spin class is classified rather than treated as steady cycling", () => {
  assert.equal(COMMITMENT["Spin class"].volume_multiplier, 0.3);
  assert.equal(COMMITMENT["Spin class"].leg_cost, "high");
});

test("a fixed commitment keeps its day and nothing is scheduled on top of it", () => {
  assert.deepEqual(heavyDays(HER), [2], "Wednesday is spent");
  const placed = placeWeek(HER, resolve(HER));
  const spin = placed.filter((p) => String(p.template).startsWith("commit:"));
  assert.equal(spin.length, 1);
  assert.equal(spin[0].day, 2, "on the day she fixed it to");
});

test("the commitment appears on the week with what it costs", () => {
  const spin = generate(HER).shapes[0].find((d) => d.title === "Spin class");
  assert.ok(spin, "it is part of her week, so it is on the calendar");
  assert.match(spin!.coach_note ?? "", /0\.3× aerobic volume/);
});

test("commitments are counted in the share of the week that is not race-specific", () => {
  const r = resolve(HER);
  const c = r.corrections.find((x) => /kept in/.test(x.title));
  assert.ok(c, "stated rather than hidden");
  assert.match(c!.body, /not race-specific/);
});

test('"Nothing fixed" is the absence of commitments, not one of them', () => {
  const none = { ...HER, commitments: ["Nothing fixed" as const], freq: {}, commitDay: {} };
  assert.deepEqual(heavyDays(none), []);
  assert.ok(!resolve(none).corrections.some((c) => /kept in/.test(c.title)));
});

// --------------------------------------------------------------- the standards

test("the standards table matches the official one, both sled numbers", () => {
  assert.deepEqual(STANDARDS["Women · open"], {
    sled_push_kg: 50, sled_push_total_kg: 102,
    sled_pull_kg: 25, sled_pull_total_kg: 78,
    farmers_kg: 16, lunge_kg: 10, wall_ball_kg: 4,
  });
  assert.equal(STANDARDS["Men · pro"]!.sled_push_total_kg, 202);
  assert.deepEqual(STANDARDS["Women · pro"], STANDARDS["Men · open"],
    "identical on every station, which reads like a copy-paste bug until asserted");
});

test("mixed doubles carries the men's open loads, by reference", () => {
  assert.deepEqual(STANDARDS["Mixed doubles"], STANDARDS["Men · open"]);
  assert.ok(!needsStandards(HER));
  assert.match(strengthFor(HER, "specific") ?? "", /Sled push 152 kg loaded, 50 m/);
  assert.match(strengthFor(HER, "specific") ?? "", /Wall balls 6 kg/);
});

test("division is asked, never derived from sex", () => {
  // a woman racing mixed doubles pushes the mixed doubles sled
  const her = standardsFor(HER);
  const him = standardsFor({ ...HER, role: "Engine" });
  assert.deepEqual(her, him, "the same division is the same load, whoever entered it");
  assert.notDeepEqual(her, STANDARDS["Women · open"]);
});

test("every division has loads — there is no division that silently falls back", () => {
  for (const d of DIVISION) assert.ok(STANDARDS[d], `${d} has standards`);
});

test("a doubles division carries its singles equivalent's loads", () => {
  // the pair share the work, not a lighter sled
  assert.deepEqual(STANDARDS["Women’s doubles · open"], STANDARDS["Women · open"]);
  assert.deepEqual(STANDARDS["Women’s doubles · pro"], STANDARDS["Women · pro"]);
  assert.deepEqual(STANDARDS["Men’s doubles · open"], STANDARDS["Men · open"]);
  assert.deepEqual(STANDARDS["Men’s doubles · pro"], STANDARDS["Men · pro"]);
  // mixed is the exception, and is men's open rather than a blend of the two
  assert.deepEqual(STANDARDS["Mixed doubles"], STANDARDS["Men · open"]);
  assert.notDeepEqual(STANDARDS["Mixed doubles"], STANDARDS["Women · open"]);
});

test("a women's doubles athlete gets women's open kilos, not a percentage", () => {
  const dbl = { ...HER, division: "Women’s doubles · open" as const };
  assert.ok(!needsStandards(dbl));
  assert.match(strengthFor(dbl, "specific") ?? "", /Sled push 102 kg loaded/);
  assert.match(strengthFor(dbl, "specific") ?? "", /Wall balls 4 kg/);
  assert.ok(!generate(dbl).flags.some((f) => /race weight/.test(f)));
});

test("only an unanswered division falls back to a share of race weight", () => {
  const none = { ...HER, division: null };
  assert.ok(needsStandards(none));
  assert.match(strengthFor(none, "base") ?? "", /% of race weight/);
  assert.ok(generate(none).flags.some((f) => /No division picked/.test(f)));
});

test("sled loading climbs by phase and starts lower for someone who never has", () => {
  const kg = (p: Parameters<typeof strengthFor>[1], x = HER) =>
    Number((strengthFor(x, p) ?? "").match(/Sled push (\d+) kg loaded/)?.[1] ?? 0);
  assert.equal(kg("base"), Math.round(152 * 0.6));
  assert.equal(kg("build"), Math.round(152 * 0.8));
  assert.match(strengthFor(HER, "specific") ?? "", /Sled push 152 kg loaded/);
  assert.ok(kg("base", { ...HER, sled: "Never used one" }) < kg("base"));
});

test("stations are introduced in order of soreness cost", () => {
  const at = (p: Parameters<typeof strengthFor>[1]) => strengthFor(HER, p) ?? "";
  assert.doesNotMatch(at("base"), /Wall ball|Farmers|Sandbag/,
    "front-loading every station leaves week 1 too sore to run");
  assert.match(at("build"), /Wall ball technique/);
  assert.match(at("specific"), /Sandbag lunges/);
});

// ------------------------------------------------------- volume and difficulty

test("the volume preference does what the screen says it does", () => {
  const conservative = resolve({ ...HER, volume: "Conservative" });
  assert.equal(conservative.ramp, 5, "about 5% a week");
  assert.equal(conservative.deloadEvery, 3, "a down week every third");
  assert.equal(resolve({ ...HER, volume: "Progressive" }).ramp, 8, "the resolved ramp");
});

test("a preference can lower the ramp freely and raise it only to the cap", () => {
  // the cap is there for the connective tissue; a checkbox does not change that
  const aggressive = resolve({ ...HER, volume: "Aggressive" });
  assert.equal(aggressive.ramp, 8, "still capped at her resolved 8%");
  assert.ok(aggressive.corrections.some((c) => /as far as it goes/.test(c.body)));
});

test("difficulty decides how many hard days the guardrails promise", () => {
  assert.ok(generate({ ...HER, difficulty: "Steady" }).guardrails.some((g) => /1 hard day/.test(g)));
  assert.ok(generate({ ...HER, difficulty: "Hard" }).guardrails.some((g) => /2 hard days/.test(g)));
});

// ------------------------------------------------------------------ the plan

test("the plan carries its state and its benchmark configuration", () => {
  const p = generate({ ...HER, benchmark: "scheduled" });
  assert.equal(p.plan_state, "awaiting");
  assert.equal(p.benchmark.variant, "full");
  assert.equal(p.benchmark.submaximal, false);
  assert.equal(p.benchmark.protocol_version, 1, "a result is only comparable within its protocol");
  assert.deepEqual(p.benchmark.retests, [5, 9]);
});

test("the week template puts the long run last and the key session first", () => {
  const placed = placeWeek(HER, resolve(HER)).filter((p) => !String(p.template).startsWith("commit:"));
  assert.equal(placed[0].template, "keySession");
  assert.equal(placed[placed.length - 1].template, "longRun");
});

test("scarce days keep the sessions the block cannot do without", () => {
  const two = placeWeek({ ...HER, days: ["Tue", "Sat"] }, resolve(HER));
  const kinds = two.filter((p) => !String(p.template).startsWith("commit:")).map((p) => p.template);
  assert.deepEqual(kinds, ["keySession", "longRun"]);
});

test("race week carries a shakeout and the race, and nothing after it", () => {
  const p = generate(HER);
  const last = p.shapes[p.weeks - 1];
  const race = last.find((d) => d.significance === "race");
  assert.ok(race, "the race is on the calendar");
  assert.equal(race!.day, 2, "Wednesday, as the race is");
  assert.ok(!last.some((d) => d.day > race!.day), "nothing after it");
  assert.ok(!last.some((d) => d.significance === "key"), "and no key session");
});

test("phase ranges cover every week exactly once", () => {
  for (const weeks of [4, 8, 11, 16, 24]) {
    const r = { ...resolve(HER), weeks, phaseSplit: phaseSplit(weeks) };
    const ranges = generate(HER) && intents(r);
    assert.equal(ranges[0].from, 1);
    assert.equal(ranges[ranges.length - 1].to, weeks);
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i].from, ranges[i - 1].to + 1);
  }
});

function intents(r: ReturnType<typeof resolve>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../lib/generate").intentsFor(HER, r) as { from: number; to: number }[];
}

test("nonsense answers are refused, all problems at once", () => {
  const p = validate({ ...HER, base: "elite" as never, days: [], volume: "Turbo" as never });
  const fields = p.map((x) => x.field);
  assert.ok(fields.includes("base"));
  assert.ok(fields.includes("days"));
  assert.ok(fields.includes("volume"));
  assert.deepEqual(validate(HER), [], "a complete form passes");
});

test("generation is deterministic", () => {
  assert.deepEqual(generate(HER), generate(HER));
});

test("race week drops below the taper rather than matching it", () => {
  const v = generate(HER).volume;
  const race = v[v.length - 1], taper = v[v.length - 2];
  assert.ok(race.km < taper.km,
    `race week ${race.km} km sits below the taper's ${taper.km} km`);
  assert.match(race.note, /Race week/);
});

test("the shakeout survives a scheduled benchmark", () => {
  // in race week the first slot is a shakeout whatever template it holds; keying
  // on "keySession" removed it entirely once the benchmark took that slot
  for (const benchmark of ["scheduled", "skipped"] as const) {
    const p = generate({ ...HER, benchmark });
    const last = p.shapes[p.weeks - 1];
    assert.ok(last.some((d) => d.kind === "run_easy"), `${benchmark}: a shakeout`);
    assert.ok(last.some((d) => d.significance === "race"), `${benchmark}: the race`);
  }
});

test("the allocation is a copy, so adjusting it cannot rewrite the table", () => {
  // Handing out the row itself means anything that adjusts the result rewrites
  // ALLOC for every athlete after it — a split that drifts on each render and
  // never comes back.
  const a = allocationFor(HER);
  a[0] = 99;
  assert.deepEqual(allocationFor(HER), [60, 25, 15], "the table is untouched");
  assert.deepEqual(ALLOC.Protected, [60, 25, 15]);
});
