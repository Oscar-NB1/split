import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOCATION, STATION_FLOOR, allocationFor, roleFrom,
} from "../lib/plan/allocate";
import { HYROX_RUN_CREDIT, allocateSlots, penaltyScale, placeWeek, type Commitment } from "../lib/plan/slots";
import { resolve, type ResolveInput } from "../lib/plan/resolve";
import { skeleton } from "../lib/plan/skeleton";
import { soften, validate, type PlanWeek } from "../lib/plan/validate";

const base = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  general_training_age: "intermediate", hyrox_experience: null,
  running_base: "runs_regularly", target_sessions: 5, available_days: 5,
  confidence: "estimated", ...over,
});

// ----------------------------------------------------------------- the role

test("role comes from the sign of the deltas, never their size", () => {
  assert.equal(roleFrom(2, 2), "protected", "partner faster and stronger");
  assert.equal(roleFrom(1, 1), "protected", "same signs, smaller gap, same role");
  assert.equal(roleFrom(2, -1), "run_limiter", "partner faster, you hold the stations");
  assert.equal(roleFrom(0, 2), "balanced");
  assert.equal(roleFrom(-2, 2), "station_carrier", "partner slower at running: any station delta");
  assert.equal(roleFrom(-1, -2), "station_carrier");
});

test("at finish, the role does not change the split", () => {
  // specialising someone who wants to enjoy the day narrows their training for
  // no return
  const splits = (["protected", "run_limiter", "balanced", "station_carrier"] as const)
    .map((r) => allocationFor(r, "finish", "specific"));
  for (const s of splits) assert.deepEqual(s, splits[0]);
});

test("protected and compete is the running-heaviest split there is", () => {
  const a = allocationFor("protected", "compete", "specific");
  assert.equal(a.running, 70);
  assert.equal(ALLOCATION.protected.compete.running, 70);
  assert.ok(a.running > allocationFor("station_carrier", "compete", "specific").running + 30);
});

test("station work never falls below the floor", () => {
  for (const role of ["protected", "run_limiter", "balanced", "station_carrier"] as const) {
    for (const goal of ["finish", "strong", "compete"] as const) {
      for (const phase of ["base", "build", "specific", "taper"] as const) {
        const a = allocationFor(role, goal, phase);
        assert.ok(a.station >= STATION_FLOOR - 0.05, `${role}/${goal}/${phase}: ${a.station}%`);
      }
    }
  }
});

test("specialisation ramps rather than arriving in week 1", () => {
  const b = allocationFor("protected", "compete", "base");
  const s = allocationFor("protected", "compete", "specific");
  const balanced = ALLOCATION.balanced.compete;
  assert.ok(b.running < s.running, "base is closer to balanced");
  assert.ok(b.running > balanced.running, "but already moving");
  assert.equal(s.running, 70, "specific arrives at the role's split");
});

test("singles ignores the doubles role entirely", () => {
  // there is no partner to be protected by
  const solo = allocationFor("protected", "compete", "specific", "singles");
  assert.deepEqual(solo, allocationFor("balanced", "compete", "specific", "singles"));
});

// ---------------------------------------------------------------- the slots

const slotsFor = (over: Partial<Parameters<typeof allocateSlots>[0]> = {}) =>
  allocateSlots({
    target_sessions: 5,
    allocation: allocationFor("balanced", "strong", "specific"),
    discipline: "doubles", commitments: [], max_hard: 3, ...over,
  });

test("a second Hyrox session outranks a second strength session", () => {
  // strength is a means; the Hyrox session is the sport, plus compromised
  // running, plus the only transition practice in the week
  const s = slotsFor({ target_sessions: 5 });
  assert.equal(s.counts.hyrox, 2);
  assert.ok(s.counts.strength <= 1);
});

test("the minimums hold as sessions are added", () => {
  assert.equal(slotsFor({ target_sessions: 2 }).counts.quality_run, 1, "always a quality run");
  const three = slotsFor({ target_sessions: 3 });
  assert.equal(three.counts.long_run, 1);
  assert.equal(three.counts.hyrox, 1);
  assert.ok(slotsFor({ target_sessions: 4 }).counts.strength >= 1);
});

test("two days gets quality and long, and no strength", () => {
  const s = slotsFor({ target_sessions: 2 });
  assert.equal(s.counts.strength, 0);
  assert.equal(s.slots.length, 2);
});

test("the Hyrox session pays half into running", () => {
  // booking it wholly against stations is why a running-heavy athlete wrongly
  // ends up with only one
  assert.equal(HYROX_RUN_CREDIT, 0.5);
  const running = slotsFor({
    target_sessions: 6, allocation: allocationFor("protected", "compete", "specific"),
  });
  assert.ok(running.counts.hyrox >= 1, "still gets the sport");
  assert.ok(running.counts.quality_run + running.counts.long_run + running.counts.easy_run >= 3,
    "and the running the 70% split bought");
});

test("commitments that replace a session consume a slot and say so", () => {
  const spin: Commitment = {
    activity: "Spin", per_week: 3, fixed_days: [1, 3, 5],
    intensity: "high", mode: "replace", locked: true,
  };
  const s = slotsFor({ target_sessions: 5, commitments: [spin] });
  assert.equal(s.slots.length, 2, "five sessions, three of them already spoken for");
  assert.ok(s.flags.some((f) => /commitments you already keep/.test(f)));
});

test("hard days are capped by training age, and the cap outranks the second Hyrox", () => {
  const s = slotsFor({ target_sessions: 7, max_hard: 2 });
  assert.ok(s.counts.quality_run + s.counts.hyrox <= 2,
    `${s.counts.quality_run} quality + ${s.counts.hyrox} hyrox against a budget of 2`);
  assert.equal(s.counts.quality_run, 1, "the quality run is never the one dropped");
  assert.ok(s.flags.some((f) => /hard-day budget/.test(f)), "and it says why");
  // an elite athlete with the same week keeps both
  const elite = slotsFor({ target_sessions: 7, max_hard: 5 });
  assert.ok(elite.counts.hyrox >= 2, `${elite.counts.hyrox} Hyrox sessions`);
  assert.ok(!elite.flags.some((f) => /hard-day budget/.test(f)));
});

test("penalties soften as the athlete gets stronger", () => {
  assert.equal(penaltyScale("novice"), 1);
  assert.equal(penaltyScale("advanced"), 0.5);
  assert.equal(penaltyScale("elite"), 0.25);
});

test("a fixed commitment day is never moved", () => {
  const spin: Commitment = {
    activity: "Spin", per_week: 1, fixed_days: [2],
    intensity: "high", mode: "add", locked: true,
  };
  const { week } = placeWeek({
    slots: slotsFor().slots, available_days: [0, 1, 2, 3, 4, 5],
    commitments: [spin], training_age: "intermediate",
    rest_day: "full", long_run_day: null, allow_doubles: false,
  });
  assert.equal(week.find((p) => p.kind === "Spin")?.day, 2);
});

test("a week that breaks a preference says so rather than refusing to schedule", () => {
  const { flags } = placeWeek({
    slots: ["quality_run", "hyrox", "long_run", "strength", "easy_run"],
    available_days: [5, 6], // a real life with two days
    commitments: [], training_age: "novice", rest_day: "full", long_run_day: null, allow_doubles: false,
  });
  assert.ok(flags.length > 0, "the violation is surfaced, not hidden");
});

// ------------------------------------------------------------- the assertions

const planFrom = (r: ReturnType<typeof resolve>, length: number): PlanWeek[] =>
  skeleton(r, length).weeks.map((w) => ({
    ...w,
    // a realistic week: nothing carries more than a third of it
    sessions: [
      { kind: "long_run", km: Math.round(w.km * 0.32 * 10) / 10, hard: false },
      { kind: "quality_run", km: Math.round(w.km * 0.24 * 10) / 10, hard: true },
      { kind: "easy_run", km: Math.round(w.km * 0.22 * 10) / 10, hard: false },
      { kind: "easy_run", km: Math.round(w.km * 0.22 * 10) / 10, hard: false },
    ],
  }));

test("a plan built from the skeleton passes every assertion", () => {
  for (const age of ["novice", "intermediate", "advanced", "elite"] as const) {
    const r = resolve(base({ general_training_age: age, confidence: "measured" }));
    assert.deepEqual(validate(planFrom(r, 12), r), [], age);
  }
});

test("the assertions actually catch a broken plan", () => {
  const r = resolve(base({ general_training_age: "novice" }));
  const weeks = planFrom(r, 12);
  // one session carrying most of the week
  weeks[3].sessions.push({ kind: "long_run", km: weeks[3].km * 0.9, hard: false });
  // and a second hard day beyond what a novice takes
  weeks[3].sessions.push({ kind: "quality_run", km: 5, hard: true });
  weeks[3].sessions.push({ kind: "hyrox", km: 5, hard: true });
  const v = validate(weeks, r);
  assert.ok(v.some((x) => x.assertion === "single session share"));
  assert.ok(v.some((x) => x.assertion === "hard days per week"));
});

test("softening lowers the ramp and the peak, and nothing else", () => {
  const r = resolve(base({ confidence: "measured" }));
  const s = soften(r);
  assert.ok(s.ramp_rate < r.ramp_rate);
  assert.ok(s.peak_ceiling < r.peak_ceiling);
  assert.equal(s.start_volume, r.start_volume, "week 1 is not what was wrong");
  assert.equal(s.max_block, r.max_block);
});

test("the station share buys Hyrox sessions, it does not multiply them", () => {
  // Dividing station demand by the run credit — 1.8 sessions of station work,
  // each session delivering half, so 3.6 sessions — put three Hyrox sessions in
  // a week whose station share was 30%. Three-quarters of the week spent on the
  // thing that is under a third of it.
  const even = slotsFor({
    target_sessions: 6, allocation: { running: 50, station: 30, strength: 20 },
  });
  assert.equal(even.counts.hyrox, 2, "two, which is the brief's minimum at five slots");

  // a genuinely station-dominant athlete gets the third
  const carrier = slotsFor({
    target_sessions: 6, allocation: allocationFor("station_carrier", "compete", "specific"),
    max_hard: 5,
  });
  assert.ok(carrier.counts.hyrox >= 3, `${carrier.counts.hyrox} for a 40% station share`);
});

test("Hyrox sessions never take most of the week", () => {
  for (const sessions of [4, 5, 6, 7]) {
    const s = slotsFor({
      target_sessions: sessions, allocation: { running: 50, station: 30, strength: 20 },
      max_hard: 5,
    });
    assert.ok(s.counts.hyrox <= Math.ceil(sessions / 2),
      `${s.counts.hyrox} of ${sessions} sessions`);
  }
});

test("the long run goes on the day it was asked for", () => {
  // Asked rather than assumed: whichever day the spread happened to land on was
  // an accident of the arithmetic, and Sunday is often the only day with two
  // hours in it.
  const week = placeWeek({
    slots: ["quality_run", "long_run", "easy_run", "strength"],
    available_days: [0, 2, 4, 5, 6], commitments: [],
    training_age: "intermediate", rest_day: "none", allow_doubles: false,
    long_run_day: 6,
  });
  assert.equal(week.week.find((p) => p.kind === "long_run")?.day, 6);
  assert.equal(week.week.filter((p) => p.kind === "long_run").length, 1,
    "and only once — it is removed from the pool, not filtered from half of it");
});

test("a fixed commitment on that day wins, and the week says so", () => {
  const week = placeWeek({
    slots: ["quality_run", "long_run", "easy_run"],
    available_days: [0, 2, 4, 6],
    commitments: [{
      activity: "Padel", per_week: 1, fixed_days: [6], intensity: "medium",
      mode: "add", locked: true,
    }],
    training_age: "intermediate", rest_day: "none", allow_doubles: false,
    long_run_day: 6,
  });
  const long = week.week.find((p) => p.kind === "long_run")!;
  assert.notEqual(long.day, 6, "the day was already spoken for");
  assert.ok(week.cost > 0, "and that is charged rather than hidden");
});

test("'no rest day, but keep one easy' is not seven hard days", () => {
  const all = [0, 1, 2, 3, 4, 5, 6];
  const slots = ["quality_run", "long_run", "easy_run", "easy_run", "hyrox",
    "strength", "easy_run"] as const;
  const easy = placeWeek({
    slots: [...slots], available_days: all, commitments: [],
    training_age: "intermediate", rest_day: "easy", allow_doubles: false,
    long_run_day: null,
  });
  const byDay = new Map<number, number>();
  for (const p of easy.week) byDay.set(p.day, (byDay.get(p.day) ?? 0) + 1);
  const soloEasy = easy.week.filter((p) =>
    p.kind === "easy_run" && !p.hard && byDay.get(p.day) === 1);
  assert.ok(soloEasy.length > 0, "at least one day is only an easy run");
});

test("two key sessions never share a day", () => {
  /*
   * A double day is one real session plus, at most, an easy run. Strength was
   * being dropped onto the first day with room — routinely the day already holding
   * the interval session — so a key session was done on tired legs and both were
   * read afterwards as though they had been done properly.
   */
  const KEY = ["quality_run", "hyrox", "long_run", "strength", "benchmark", "race"];
  const cases: { days: number[]; slots: string[] }[] = [
    { days: [0, 1, 2, 3, 4, 5, 6],
      slots: ["quality_run", "quality_run", "hyrox", "hyrox", "strength", "long_run", "easy_run"] },
    { days: [0, 2, 4, 6], slots: ["quality_run", "strength", "long_run", "easy_run"] },
    { days: [1, 3, 5], slots: ["quality_run", "hyrox", "strength", "long_run"] },
    { days: [0, 1], slots: ["quality_run", "strength", "long_run"] },
  ];

  for (const c of cases) {
    const out = placeWeek({
      slots: c.slots as never, available_days: c.days, commitments: [],
      training_age: "intermediate", rest_day: "none", allow_doubles: true,
      long_run_day: c.days[c.days.length - 1],
    });
    const byDay = new Map<number, string[]>();
    for (const p of out.week) {
      byDay.set(p.day, [...(byDay.get(p.day) ?? []), String(p.kind)]);
    }
    for (const [day, kinds] of byDay) {
      const keys = kinds.filter((k) => KEY.includes(k));
      // The only case where two are allowed to land together is a week with more
      // key sessions than days, and it says so out loud.
      if (keys.length > 1) {
        assert.ok(c.slots.filter((k) => KEY.includes(k)).length > c.days.length,
          `day ${day}: ${kinds.join(" + ")} with ${c.days.length} days`);
        assert.ok(out.flags.some((f) => /key session/.test(f)), out.flags.join(" | "));
      }
    }
  }
});

test("an easy run is the one thing that may share a day", () => {
  const out = placeWeek({
    slots: ["quality_run", "long_run", "strength", "easy_run"],
    available_days: [0, 2, 4], commitments: [],
    training_age: "intermediate", rest_day: "none", allow_doubles: true,
    long_run_day: 4,
  });
  const doubled = [0, 2, 4].filter((d) => out.week.filter((p) => p.day === d).length > 1);
  for (const d of doubled) {
    const kinds = out.week.filter((p) => p.day === d).map((p) => String(p.kind));
    assert.ok(kinds.includes("easy_run"), `day ${d}: ${kinds.join(" + ")}`);
  }
});
