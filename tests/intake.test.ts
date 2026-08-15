import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Intake, daysFor, generate, intentsFor, paceCue, setClock,
  stationsFor, strengthFor, validate, volumeFor,
} from "../lib/intake";

setClock(() => "2026-08-15");

/** A plausible set of answers. Individual tests vary one field at a time. */
const BASE: Intake = {
  experience: "returning",
  current_km_week: 20,
  longest_run_km: 8,
  recent_5k_seconds: null,
  goal_kind: "hyrox",
  goal_race_name: "Hyrox Rotterdam",
  goal_date: "2026-11-28",
  goal_time_seconds: null,
  days_per_week: 4,
  preferred_days: [0, 2, 4, 6],
  long_run_day: 6,
  gym_access: "basic_gym",
  equipment: ["kettlebell", "rower", "pull_up_bar"],
  injuries: null,
  constraints_note: null,
};

test("week 1 is never harder than the week they say they already run", () => {
  // the single most common way a plan is abandoned in week two
  for (const km of [8, 20, 45, 70]) {
    const v = volumeFor({ ...BASE, current_km_week: km }, 12);
    assert.ok(v[0].km <= Math.round(km), `starts at or below ${km} km, got ${v[0].km}`);
  }
});

test("the ceiling scales from their own volume, not from anyone else's", () => {
  const small = volumeFor({ ...BASE, current_km_week: 15 }, 14);
  const big = volumeFor({ ...BASE, current_km_week: 60 }, 14);
  assert.ok(Math.max(...small.map((v) => v.km)) <= 15 * 1.8 + 1);
  assert.ok(Math.max(...big.map((v) => v.km)) > Math.max(...small.map((v) => v.km)));
});

test("someone new climbs more gently than someone competitive", () => {
  const peak = (e: Intake["experience"]) =>
    Math.max(...volumeFor({ ...BASE, experience: e }, 14).map((v) => v.km));
  assert.ok(peak("new") < peak("returning"));
  assert.ok(peak("returning") < peak("consistent"));
  assert.ok(peak("consistent") < peak("competitive"));
});

test("every fourth week comes down, and the block tapers into the race", () => {
  const v = volumeFor(BASE, 14);
  assert.ok(v[3].km < v[2].km, "week 4 is a down week");
  assert.ok(v[13].km < v[11].km, "race week is the smallest of the end");
  assert.match(v[13].note, /Race week/);
});

test("the block ends on race day, and its length is not a round number by accident", () => {
  const p = generate(BASE);
  // start is the Monday after 15 Aug 2026, so 17 Aug; race 28 Nov
  assert.equal(p.start, "2026-08-17");
  assert.equal(p.weeks, 15);
  assert.equal(p.volume.length, 15);
  assert.equal(p.shapes.length, 15);
  assert.equal(p.race_date, "2026-11-28");
});

test("the race session lands on the race date, not the preferred long-run day", () => {
  // 28 Nov 2026 is a Saturday; BASE prefers Sunday for long runs. Placing the race
  // on the long-run day put it on the 29th — a race on the wrong day, silently.
  for (const [date, label] of [["2026-11-28", "Saturday"], ["2026-10-28", "Wednesday"]] as const) {
    const p = generate({ ...BASE, goal_date: date });
    const race = p.shapes[p.shapes.length - 1].find((d) => d.significance === "race");
    assert.ok(race, `${label}: race week contains the race`);
    const monday = new Date(`${p.start}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() + (p.weeks - 1) * 7 + race!.day);
    assert.equal(monday.toISOString().slice(0, 10), date, `${label} race is on ${date}`);
  }
});

test("nothing else is scheduled on top of race day", () => {
  const p = generate(BASE);
  const last = p.shapes[p.shapes.length - 1];
  const raceDay = last.find((d) => d.significance === "race")!.day;
  const clash = last.filter((d) => d.day === raceDay && d.significance !== "race");
  assert.deepEqual(clash, [], "race day carries the race and nothing else");
});

test("no race date gives a block with no race and no countdown", () => {
  const p = generate({ ...BASE, goal_date: null, goal_race_name: null });
  assert.equal(p.race_date, null);
  assert.equal(p.race_name, null);
  assert.equal(p.weeks, 12, "a default length, since nothing pins the end");
  assert.ok(!p.shapes.flat().some((d) => d.significance === "race"));
});

test("no goal time means no goal, not a borrowed one", () => {
  const p = generate(BASE);
  assert.equal(p.goal_label, null);
  assert.equal(p.goal_seconds, null);
  assert.equal(generate({ ...BASE, goal_time_seconds: 3390 }).goal_label, "56:30");
  assert.equal(generate({ ...BASE, goal_time_seconds: 3600 }).goal_label, "1:00:00");
});

test("the days they say they can train are the days used", () => {
  const d = daysFor({ ...BASE, preferred_days: [1, 3, 5], days_per_week: 3, long_run_day: 5 });
  assert.deepEqual(d.run.concat(d.long).sort(), [1, 3, 5]);
  assert.equal(d.long, 5, "their chosen long-run day");
  const shapes = generate({ ...BASE, preferred_days: [1, 3, 5], days_per_week: 3, long_run_day: 5 }).shapes;
  const used = [...new Set(shapes[0].map((s) => s.day))].sort();
  for (const day of used) assert.ok([1, 3, 5].includes(day), `day ${day} was not chosen`);
});

test("a long-run day they did not pick as a training day is not used", () => {
  const d = daysFor({ ...BASE, preferred_days: [0, 1, 2], days_per_week: 3, long_run_day: 6 });
  assert.ok([0, 1, 2].includes(d.long), "falls back inside their stated days");
});

test("only equipment they have is programmed", () => {
  const none = stationsFor({ ...BASE, equipment: [] });
  assert.ok(!/Sled|SkiErg|Row|Wall/.test(none ?? ""), "nothing requiring kit");
  const sled = stationsFor({ ...BASE, equipment: ["sled"] });
  assert.match(sled ?? "", /Sled push/);
  assert.doesNotMatch(sled ?? "", /SkiErg|Row 500/);
});

test("no gym access means no strength session at all", () => {
  assert.equal(strengthFor({ ...BASE, gym_access: "none" }), null);
  const shapes = generate({ ...BASE, gym_access: "none" }).shapes;
  assert.ok(!shapes.flat().some((d) => d.kind === "strength"));
});

test("stations are only programmed for a Hyrox goal", () => {
  assert.equal(stationsFor({ ...BASE, goal_kind: "half" }), null);
  assert.ok(stationsFor({ ...BASE, goal_kind: "hyrox_doubles" }));
});

test("pace targets appear only when there is a benchmark to derive them from", () => {
  const blind = generate(BASE).shapes[0].find((d) => d.kind === "run_intervals");
  assert.doesNotMatch(blind!.title, /@/, "no invented pace");
  assert.match(blind!.coach_note ?? "", /by effort until you have a benchmark/);

  const known = generate({ ...BASE, recent_5k_seconds: 25 * 60 }).shapes[0]
    .find((d) => d.kind === "run_intervals");
  assert.match(known!.title, /@ 5:0\d/, "derived from the 5:00/km their 5K implies");
});

test("pace cues come off the stated 5K, slower for base weeks", () => {
  assert.equal(paceCue(25 * 60, 0), "5:00");
  assert.equal(paceCue(25 * 60, 8), "5:08");
  assert.equal(paceCue(20 * 60, 0), "4:00");
});

test("the phase ranges cover every week exactly once", () => {
  for (const weeks of [4, 8, 12, 15, 20]) {
    const ranges = [...intentsFor(BASE, weeks)].sort((a, b) => a.from - b.from);
    assert.equal(ranges[0].from, 1, `${weeks} weeks: starts at 1`);
    assert.equal(ranges[ranges.length - 1].to, weeks, `${weeks} weeks: ends at ${weeks}`);
    for (let i = 1; i < ranges.length; i++) {
      assert.equal(ranges[i].from, ranges[i - 1].to + 1, `${weeks} weeks: no gap or overlap`);
    }
  }
});

test("the phase text quotes their own starting volume back at them", () => {
  const [base] = intentsFor({ ...BASE, current_km_week: 23 }, 12);
  assert.match(base.purpose, /23 km/);
});

test("nonsense answers are refused, all problems at once", () => {
  const p = validate({ ...BASE, current_km_week: 4000, days_per_week: 99, experience: "elite" as never });
  const fields = p.map((x) => x.field);
  assert.ok(fields.includes("current_km_week"));
  assert.ok(fields.includes("days_per_week"));
  assert.ok(fields.includes("experience"));
  assert.equal(validate(BASE).length, 0, "a sane form passes");
});

test("a race too soon or too far out is refused", () => {
  assert.ok(validate({ ...BASE, goal_date: "2026-08-20" }).some((p) => p.field === "goal_date"));
  assert.ok(validate({ ...BASE, goal_date: "2028-08-20" }).some((p) => p.field === "goal_date"));
});

test("a longest run longer than the whole week is flagged", () => {
  const p = validate({ ...BASE, current_km_week: 10, longest_run_km: 30 });
  assert.ok(p.some((x) => x.field === "longest_run_km"));
});

test("generation is deterministic — the same answers give the same block", () => {
  const a = generate(BASE), b = generate(BASE);
  assert.deepEqual(a, b);
});
