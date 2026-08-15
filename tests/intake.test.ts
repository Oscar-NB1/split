import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_VOLUME, COMMITMENT, DIVISION, RUNNING_CEILING, STANDARDS, UNLOADED_DIVISIONS,
  type Intake, standardsFor,
  allocationFor, heavyDays, needsStandards, rampRate, setClock, startVolume, validate,
} from "../lib/intake";
import {
  BASELINE_TEST, daysFor, flagsFor, generate, intentsFor, isBaseline, isDeload,
  phases, rungFor, stationsFor, strengthFor, volumeFor,
} from "../lib/generate";

setClock(() => "2026-08-10");

/**
 * The athlete the plan spec describes: over a year of consistent training, but
 * runs with walk breaks. Protected partner, mixed doubles, race Wed 28 Oct,
 * one weekly spin class on the Wednesday.
 */
const HER: Intake = {
  training_base: "over_1yr",
  running_self: "walk_breaks",
  current_km_week: null,
  longest_run_km: null,
  recent_5k_seconds: null,
  goal_kind: "hyrox_doubles",
  goal_race_name: "Hyrox Mixed Doubles",
  goal_date: "2026-10-28",
  goal_time_seconds: null,
  division: "mixed_doubles",
  partner_role: "protected",
  days_per_week: 4,
  preferred_days: [1, 2, 3, 4, 5],
  long_run_day: 5,
  commitments: [{ kind: "spin", name: "Rocycle", day: 2, per_week: 1 }],
  gym_access: "hyrox_gym",
  equipment: ["sled", "skierg", "rower", "wall_ball", "sandbag", "kettlebell", "barbell", "pull_up_bar"],
  sled_experience: "lighter",
  injuries: null,
  constraints_note: null,
};

// ------------------------------------------------- the correction that matters

test("running base caps training base, not the other way round", () => {
  // The bug: reading training_base alone prescribes 30 km in week 1 to someone
  // who cannot yet run 5 km continuously. A stress-fracture recipe.
  assert.equal(BASE_VOLUME.over_1yr, 30, "what training base alone would have said");
  assert.equal(RUNNING_CEILING.walk_breaks, 15, "what her running actually supports");
  assert.equal(startVolume(HER), 15, "the lower of the two wins");
});

test("each running self-description has its own ceiling", () => {
  const at = (running_self: Intake["running_self"]) =>
    startVolume({ ...HER, running_self });
  assert.equal(at("doesnt_run"), 8);
  assert.equal(at("walk_breaks"), 15);
  assert.equal(at("5k_nonstop"), 22);
  assert.equal(at("runs_regularly"), 30, "no cap — training base governs");
});

test("the ramp gets the same treatment as the volume", () => {
  // her engine is trained; her running tissue is not, and that gap is the
  // classic injury pattern because she will feel able to do more than she can absorb
  assert.equal(rampRate(HER), 0.08, "8%, not the 10% her training base alone implies");
  assert.equal(rampRate({ ...HER, running_self: "runs_regularly" }), 0.10);
  assert.equal(rampRate({ ...HER, training_base: "under_6mo" }), 0.06, "the lower still wins");
});

test("a stated weekly volume beats an inferred one", () => {
  // someone who says they run 10 km should not be handed 15 by a table
  assert.equal(startVolume({ ...HER, current_km_week: 10 }), 10);
  assert.equal(startVolume({ ...HER, current_km_week: 40 }), 15, "but cannot lift the ceiling");
});

// ------------------------------------------------------------------ the block

test("the block runs from the Monday after today to race day", () => {
  const p = generate(HER);
  assert.equal(p.start, "2026-08-17");
  assert.equal(p.weeks, 11, "10 weeks plus the race week");
  assert.equal(p.race_date, "2026-10-28");
});

test("the race session lands on race day, and race week carries nothing else heavy", () => {
  const p = generate(HER);
  const last = p.shapes[p.shapes.length - 1];
  const race = last.find((d) => d.significance === "race");
  assert.ok(race, "race week contains the race");
  const monday = new Date(`${p.start}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + (p.weeks - 1) * 7 + race!.day);
  assert.equal(monday.toISOString().slice(0, 10), "2026-10-28", "Wednesday, as the race is");
  assert.ok(!last.some((d) => d.significance === "key"), "no key session in race week");
  assert.ok(!last.some((d) => d.day > race!.day), "nothing scheduled after the race");
});

test("phases split 30/30/25/15 and the last week is always taper", () => {
  assert.deepEqual(phases(11), [
    "base", "base", "base", "build", "build", "build",
    "specific", "specific", "specific", "taper", "taper",
  ]);
  for (const w of [2, 4, 6, 8, 12, 15, 20]) {
    const p = phases(w);
    assert.equal(p.length, w, `${w} weeks gets ${w} phases`);
    assert.equal(p[p.length - 1], "taper", `${w} weeks ends in taper`);
  }
});

test("deloads fall on weeks 4 and 8, never on the last week", () => {
  assert.ok(isDeload(4, 11) && isDeload(8, 11));
  assert.ok(!isDeload(11, 11) && !isDeload(5, 11));
  const v = volumeFor(HER, 11, 2);
  assert.ok(v[3].km < v[2].km, "week 4 comes down");
  assert.ok(v[7].km < v[6].km, "week 8 comes down");
  assert.match(v[3].note, /Deload|Baseline/);
});

test("a deload does not reset the climb", () => {
  // the failure this prevents: a week-9 peak lower than week 7, because the
  // progression restarted from the down week
  const v = volumeFor(HER, 11, 2);
  assert.ok(v[8].km > v[6].km, `week 9 (${v[8].km}) peaks above week 7 (${v[6].km})`);
  assert.ok(v[4].km > v[2].km, "and week 5 resumes above week 3");
});

test("week 1 is never above the starting volume, and race week is the smallest", () => {
  const v = volumeFor(HER, 11, 2);
  assert.equal(v[0].km, startVolume(HER));
  assert.equal(v[10].km, Math.min(...v.map((w) => w.km)));
});

test("baseline tests fall in week 1 and after each deload, on one protocol", () => {
  assert.ok(isBaseline(1, 11), "week 1");
  assert.ok(isBaseline(5, 11), "the week after the week-4 deload");
  assert.ok(isBaseline(9, 11), "the week after the week-8 deload");
  assert.ok(!isBaseline(2, 11) && !isBaseline(4, 11));

  const p = generate(HER);
  const tests = p.shapes
    .map((w, i) => ({ i: i + 1, d: w.find((s) => s.significance === "benchmark") }))
    .filter((x) => x.d);
  assert.deepEqual(tests.map((t) => t.i), [1, 5, 9]);
  // identical protocol, or the comparison is meaningless
  for (const t of tests) assert.equal(t.d!.target, BASELINE_TEST);
});

// -------------------------------------------------------------- the running

test("run/walk becomes continuous by the specific phase", () => {
  assert.match(rungFor(HER, "base").quality, /3 min run \/ 1 min walk/);
  assert.match(rungFor(HER, "build").quality, /6–8 min run \/ 1 min walk/);
  assert.match(rungFor(HER, "specific").quality, /800 m continuous/);
});

test("someone who already runs continuously does not start on run/walk", () => {
  const runner = { ...HER, running_self: "runs_regularly" as const };
  assert.doesNotMatch(rungFor(runner, "base").quality, /walk/);
});

test("no benchmark means no pace target, and the session says why", () => {
  const blind = generate(HER).shapes[1].find((d) => d.kind === "run_intervals");
  assert.doesNotMatch(blind!.title, /@/, "no invented pace");
  assert.match(blind!.coach_note ?? "", /no pace target until the baseline/);
});

// ------------------------------------------------------------- commitments

test("a spin class is classified, not treated as steady cycling", () => {
  const spin = COMMITMENT.spin;
  assert.equal(spin.volume_multiplier, 0.3);
  assert.equal(spin.leg_cost, "high");
  assert.ok(COMMITMENT.cycling.volume_multiplier > spin.volume_multiplier,
    "steady cycling counts for more than a spin class");
});

test("a high-leg-cost commitment never gets a session on top of it", () => {
  assert.deepEqual(heavyDays(HER), [2], "Wednesday is spent");
  const d = daysFor(HER);
  for (const day of [d.quality, d.easy, d.hyrox, d.strength]) {
    assert.notEqual(day, 2, "nothing is scheduled on the spin day");
  }
});

test("the week lands on the template the plan spec describes", () => {
  // Tue quality · Wed Rocycle · Thu easy · Fri strength+sled · Sat Hyrox
  const d = daysFor(HER);
  assert.equal(d.quality, 1, "Tuesday carries the quality run");
  assert.equal(d.easy, 3, "Thursday absorbs the day after spin");
  assert.equal(d.strength, 4, "Friday is strength and sled");
  assert.equal(d.hyrox, 5, "Saturday is the Hyrox session");
});

test("the easy run absorbs the day after a heavy commitment", () => {
  // Thursday follows the Wednesday spin class, so the legs are already spent.
  // Assigning strength before easy took that day and pushed the easy run to the
  // fresh Friday — the right sessions, the wrong way round.
  const d = daysFor(HER);
  assert.equal(d.easy, 3, "Thursday takes the easy run");
  assert.notEqual(d.quality, 3, "and never the key session");
});

test("race week carries a shakeout before the race and nothing after", () => {
  const last = generate(HER).shapes[10];
  const race = last.find((s) => s.significance === "race")!;
  const shake = last.find((s) => s.kind === "run_easy");
  assert.ok(shake, "a shakeout");
  assert.ok(shake!.day < race.day, "before the race");
  assert.ok(!last.some((s) => s.day > race.day), "nothing after it");
});

test("the commitment still appears on the week, with what it costs", () => {
  const week = generate(HER).shapes[0];
  const spin = week.find((d) => d.title === "Rocycle");
  assert.ok(spin, "it is on the calendar — it is part of her week");
  assert.equal(spin!.day, 2);
  assert.match(spin!.coach_note ?? "", /0\.3x aerobic volume/);
});

test("in the specific phase the high-cost commitment goes to alternate weeks", () => {
  const p = generate(HER);
  const specific = p.shapes[6].find((d) => d.title === "Rocycle");
  assert.match(specific!.coach_note ?? "", /Alternate weeks/);
  const base = p.shapes[0].find((d) => d.title === "Rocycle");
  assert.doesNotMatch(base!.coach_note ?? "", /Alternate weeks/);
});

test("a commitment with no fixed day constrains nothing", () => {
  const loose = { ...HER, commitments: [{ kind: "spin" as const, name: "Rocycle", day: null, per_week: 1 }] };
  assert.deepEqual(heavyDays(loose), []);
});

// --------------------------------------------------------- role and standards

test("the protected partner's week is weighted to running", () => {
  const a = allocationFor(HER);
  assert.equal(a.run, 0.60);
  assert.equal(a.station, 0.25);
  assert.equal(a.strength, 0.15);
  assert.match(intentsFor(HER, 11)[0].purpose, /60% running/);
});

test("a solo athlete does not get a doubles split", () => {
  const solo = allocationFor({ ...HER, goal_kind: "hyrox", partner_role: null });
  assert.notEqual(solo.run, 0.60);
});

test("without a division, loads are a share of race weight rather than invented kilos", () => {
  const nodiv = { ...HER, division: "unknown" as const };
  assert.ok(needsStandards(nodiv));
  const work = strengthFor(nodiv, "base") ?? "";
  assert.match(work, /% of race weight/, "expressed as a share");
  assert.doesNotMatch(work, /\d+ kg loaded/, "no weight nobody verified");
  assert.ok(generate(nodiv).flags.some((f) => /No division chosen/.test(f)),
    "and the plan says so rather than staying quiet");
});

test("sled loading climbs by phase, and starts lower for someone who never has", () => {
  // mixed doubles is men's open: 152 kg loaded at race weight
  const loaded = (p: Parameters<typeof strengthFor>[1], x = HER) =>
    Number((strengthFor(x, p) ?? "").match(/Sled push (\d+) kg loaded/)?.[1] ?? 0);
  assert.equal(loaded("base"), Math.round(152 * 0.6), "60% in base");
  assert.equal(loaded("build"), Math.round(152 * 0.8), "80% in build");
  assert.equal(loaded("specific"), 152, "race weight in the specific phase");
  assert.ok(loaded("base", { ...HER, sled_experience: "never" }) < loaded("base"),
    "someone who has never pushed one starts lower still");
});

test("sandbag lunges are introduced last", () => {
  assert.doesNotMatch(strengthFor(HER, "base") ?? "", /Sandbag/);
  assert.match(strengthFor(HER, "specific") ?? "", /Sandbag lunges/);
});

test("only equipment they have is programmed", () => {
  const bare = { ...HER, equipment: [], gym_access: "home" as const };
  const stations = stationsFor(bare) ?? "";
  assert.doesNotMatch(stations, /Sled|SkiErg|Row 500|Wall/);
  assert.match(stations, /Burpee broad jump/, "the one that needs nothing");
  assert.doesNotMatch(strengthFor(bare, "specific") ?? "", /Sled|Sandbag/);
});

test("no gym access means no strength session at all", () => {
  const none = { ...HER, gym_access: "none" as const };
  assert.equal(strengthFor(none, "base"), null);
  assert.ok(!generate(none).shapes.flat().some((d) => d.kind === "strength"));
});

// ----------------------------------------------------------------- the flags

test("what the plan cannot decide is named rather than hidden", () => {
  const flags = flagsFor(HER, 11);
  assert.ok(flags.some((f) => /No pace anchor/.test(f)));
  assert.ok(flags.some((f) => /locked commitment/.test(f)));
  assert.ok(flags.some((f) => /protected partner/.test(f)));
});

test("a ceiling that overrode their stated volume is said out loud", () => {
  const flags = flagsFor({ ...HER, current_km_week: 30 }, 11);
  assert.ok(flags.some((f) => /below what you said you run/.test(f)),
    "she is told why week 1 is lower than she expected");
});

// ------------------------------------------------------------------ the rest

test("nonsense answers are refused, all problems at once", () => {
  const p = validate({ ...HER, training_base: "elite" as never, days_per_week: 99 });
  const fields = p.map((x) => x.field);
  assert.ok(fields.includes("training_base"));
  assert.ok(fields.includes("days_per_week"));
  assert.equal(validate(HER).length, 0, "a complete form passes");
});

test("a doubles athlete must say which role they are", () => {
  const p = validate({ ...HER, partner_role: null });
  assert.ok(p.some((x) => x.field === "partner_role"));
  assert.equal(validate({ ...HER, goal_kind: "hyrox", partner_role: null }).length, 0,
    "a solo athlete does not need one");
});

test("phase ranges cover every week exactly once", () => {
  for (const weeks of [4, 8, 11, 15, 20]) {
    const r = [...intentsFor(HER, weeks)].sort((a, b) => a.from - b.from);
    assert.equal(r[0].from, 1);
    assert.equal(r[r.length - 1].to, weeks);
    for (let i = 1; i < r.length; i++) assert.equal(r[i].from, r[i - 1].to + 1);
  }
});

test("generation is deterministic", () => {
  assert.deepEqual(generate(HER), generate(HER));
});

// ------------------------------------------------------------- the standards

test("the standards table matches the official one, both sled numbers", () => {
  // added weight vs total including the sled: confusing them is a 52 kg error
  assert.deepEqual(STANDARDS.womens_open, {
    sled_push_kg: 50, sled_push_total_kg: 102,
    sled_pull_kg: 25, sled_pull_total_kg: 78,
    farmers_kg: 16, lunge_kg: 10, wall_ball_kg: 4,
  });
  assert.equal(STANDARDS.mens_pro!.sled_push_total_kg, 202);
  assert.equal(STANDARDS.mens_pro!.sled_pull_total_kg, 153);
  // women's pro and men's open are the same load on every station
  assert.deepEqual(STANDARDS.womens_pro, STANDARDS.mens_open);
});

test("every loaded division scales upward across the four of them", () => {
  const order = ["womens_open", "womens_pro", "mens_pro"] as const;
  for (const key of ["sled_push_kg", "sled_pull_kg", "farmers_kg", "lunge_kg", "wall_ball_kg"] as const) {
    for (let i = 1; i < order.length; i++) {
      assert.ok(STANDARDS[order[i]]![key] > STANDARDS[order[i - 1]]![key],
        `${key} climbs from ${order[i - 1]} to ${order[i]}`);
    }
  }
});

test("real weights are printed once the division is known", () => {
  const her = { ...HER, division: "womens_open" as const };
  assert.ok(!needsStandards(her));
  const specific = strengthFor(her, "specific") ?? "";
  assert.match(specific, /Sled push 102 kg loaded, 50 m/, "total weight and race distance");
  assert.match(specific, /Sled pull 78 kg loaded, 50 m/);
  assert.match(specific, /Wall balls 4 kg/);
  assert.match(specific, /Sandbag lunges 10 kg/);
  assert.match(specific, /Farmers carry 2 x 16 kg/);
  // and the build phase scales the same load rather than inventing another
  assert.match(strengthFor(her, "build") ?? "", /Sled push 82 kg loaded/);
});

test("mixed doubles carries the men's open loads, by reference", () => {
  // confirmed as the same weights rather than inferred from them, and shared by
  // reference so an edit to one can never leave the other behind
  assert.deepEqual(STANDARDS.mixed_doubles, STANDARDS.mens_open);
  assert.ok(!needsStandards(HER), "her division has real numbers");
  assert.match(strengthFor(HER, "specific") ?? "", /Sled push 152 kg loaded, 50 m/);
  assert.match(strengthFor(HER, "specific") ?? "", /Sled pull 103 kg loaded, 50 m/);
  assert.match(strengthFor(HER, "specific") ?? "", /Wall balls 6 kg/);
  assert.match(strengthFor(HER, "specific") ?? "", /Sandbag lunges 20 kg/);
  assert.match(strengthFor(HER, "specific") ?? "", /Farmers carry 2 x 24 kg/);
  assert.ok(!generate(HER).flags.some((f) => /race weight/.test(f)),
    "and no longer flags a missing standard");
});

test("a division either has confirmed loads or is listed as not having them", () => {
  // the failure this prevents is a division quietly falling back to percentages
  // because nobody noticed it was never filled in
  for (const d of DIVISION) {
    const loaded = !!STANDARDS[d];
    const known = !UNLOADED_DIVISIONS.includes(d);
    assert.equal(loaded, known, `${d}: loads and the unloaded list must agree`);
  }
});

test("division is asked, never derived from sex", () => {
  // a woman racing mixed doubles pushes the mixed doubles sled, whatever a
  // sex-by-division table would have inferred for her
  const her = { ...HER, division: "mixed_doubles" as const };
  const him = { ...HER, division: "mixed_doubles" as const, partner_role: "lead" as const };
  assert.deepEqual(standardsFor(her), standardsFor(him),
    "the same division is the same load, whoever is entered in it");
  assert.notDeepEqual(standardsFor(her), STANDARDS.womens_open);
});

test("an unloaded division says what it needs instead of guessing", () => {
  const dbl = { ...HER, division: "womens_doubles" as const };
  assert.ok(needsStandards(dbl));
  assert.match(strengthFor(dbl, "specific") ?? "", /race weight/);
  assert.ok(generate(dbl).flags.some((f) => /do not have confirmed loads/.test(f)));
});

test("stations are introduced in order of soreness cost, not all at once", () => {
  const at = (p: Parameters<typeof strengthFor>[1]) => strengthFor(HER, p) ?? "";
  // base: technique and base strength, plus the sled at a reduced load
  assert.match(at("base"), /Back squat/);
  assert.match(at("base"), /Sled push/);
  assert.doesNotMatch(at("base"), /Wall ball|Farmers|Sandbag/,
    "front-loading every station leaves week 1 too sore to run");
  // build: farmers and wall ball technique
  assert.match(at("build"), /Wall ball technique/);
  assert.match(at("build"), /Farmers carry/);
  assert.doesNotMatch(at("build"), /Sandbag/);
  // specific: sandbag lunges last, the highest soreness cost of any station
  assert.match(at("specific"), /Sandbag lunges/);
});
