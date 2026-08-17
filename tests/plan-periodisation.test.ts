import { test } from "node:test";
import assert from "node:assert/strict";
import { paramsFrom } from "../lib/plan/from-intake";
import { generate, type GeneratedWeek, type Session } from "../lib/plan/generate";
import type { Intake } from "../lib/intake";

/**
 * Down weeks and tapers: three faults that were all the same fault.
 *
 * Each of these came from two cycles that never agreed with each other — the ladder's
 * counter against the skeleton's down weeks, and the volume curve against what the week's
 * sessions could actually carry. Nobody chose any of the results; they were what happened
 * when two correct rules met.
 */

const x = (o: Partial<Intake> = {}): Intake => ({
  hasRace: "Yes", discipline: "Hyrox doubles", raceDistance: null,
  raceDate: "2026-11-29", role: null, division: "Mixed doubles", longRunDay: "Sun",
  base: "Several years", runningSelf: "Runs regularly",
  paceMin: 22, paceSec: 30, paceUnknown: false,
  peakWeekKm: 38, longestRunKm: 19, volumeSource: "self",
  goal: "Compete", goalMin: 70, startDate: "2026-08-17",
  targetSessions: "6", allowDoubles: null, wantRestDay: "Yes, keep one",
  sessionPref: "Mix", hyroxExp: "Weekly", runDelta: "About the same",
  stationDelta: "About the same", gymAccess: "Open floor, any time",
  runStationLink: "Yes, with a walk between",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  commitments: [], freq: {}, commitDay: {}, commitMode: {},
  equipment: ["Sled — race weight", "SkiErg", "Rower", "Wall balls"],
  sled: "Race weight and distance", injuries: "",
  volume: "Progressive", difficulty: "Hard", benchmark: "scheduled",
  pastRaces: [], bRaces: [],
  ...o,
} as Intake);

const built = (o: Partial<Intake> = {}) =>
  generate(paramsFrom(x(o), { recent: null, absences: [], max_hr: 185, measured: false }));

/*
 * `GeneratedWeek` intersects two session types, and the intersection resolves to the leaner
 * one. Read through here so a test asserting on a label is not asserting on `never`.
 */
const of = (w: GeneratedWeek): Session[] => w.sessions as unknown as Session[];
const hard = (w: GeneratedWeek) => of(w).filter((s) => s.hard).length;
const quality = (w: GeneratedWeek) =>
  of(w).filter((s) => s.kind === "quality_run" || s.kind === "benchmark");

test("a down week steps the interval work back, not only the easy running", () => {
  /*
   * Week 7 carried the two hardest quality sessions in the block — 3 × 15 min and
   * 5 × 2000 m — because the rung climbed on the block week and knew nothing about the
   * skeleton's down weeks. Lower volume around the same hard sessions is a normal week
   * with fewer easy kilometres, and the absorption the week exists for never happened.
   */
  const g = built();
  const downs = g.weeks.filter((w) => w.deload);
  assert.ok(downs.length > 0, "the block has a down week to check");

  for (const d of downs) {
    const prev = g.weeks[d.n - 2];
    assert.ok(quality(d).length <= 1,
      `week ${d.n} is a down week and carries ${quality(d).length} quality sessions`);
    /*
     * Compared inside a phase only. Across a phase boundary the session type changes by
     * design — the base ladder and the build ladder are different sessions — so a down week
     * that opens a phase is allowed to look new.
     */
    if (prev && !prev.deload && prev.phase === d.phase) {
      assert.ok(hard(d) <= hard(prev),
        `week ${d.n} has ${hard(d)} hard days against ${hard(prev)} the week before`);
      /* The session is the same shape, not a harder one at lower volume. */
      const labels = quality(d).map((s) => s.label);
      const before = quality(prev).map((s) => s.label);
      for (const l of labels) {
        assert.ok(before.includes(l),
          `week ${d.n} introduces "${l}", which week ${prev.n} did not have`);
      }
    }
  }
});

test("the down week is the test week, and the timed long run exists at all", () => {
  /*
   * It was moved to the down week and then could not fire: `absorbWeek` already excluded
   * deloads and the call forced "steady" on any easing week, so the shape had not appeared
   * in a plan since. A dead branch reads exactly like a working one in review.
   */
  const g = built();
  const timed = g.weeks.filter((w) =>
    of(w).some((s) => s.kind === "long_run"
      && (s.target_text ?? "").split("\n").length === 1
      && /Z3/.test(s.target_text ?? "")));
  assert.ok(timed.length > 0, "no week in the block has a timed long run");
  for (const w of timed) {
    assert.ok(w.deload, `week ${w.n} is timed and is not a down week`);
    assert.ok(!w.taper, "nothing to prove in a taper");
    assert.ok(w.phase === "build" || w.phase === "specific",
      `week ${w.n} is in ${w.phase}, where there is nothing to measure yet`);
  }
});

test("a taper never goes up", () => {
  /*
   * The curve's taper factors multiplied a `working` volume that climbed whether or not
   * the weeks below it could carry the climb: a prescribed peak of 56 km in week 9, the
   * specific weeks capped at 36–40 by how many runs are in them, and then 0.75 of the
   * curve made week 14 a 45 km "taper" — bigger than any of the four weeks before it.
   */
  const g = built();
  for (const w of g.weeks) {
    if (!w.taper) continue;
    const prev = g.weeks[w.n - 2];
    assert.ok(prev, `week ${w.n} has a week before it`);
    assert.ok(w.km <= prev.km + 0.1,
      `taper week ${w.n} is ${w.km} km against ${prev.km} the week before`);
  }
});

test("the taper descends across its own weeks", () => {
  const tapers = built().weeks.filter((w) => w.taper);
  for (let i = 1; i < tapers.length; i++) {
    assert.ok(tapers[i].km < tapers[i - 1].km,
      `taper week ${tapers[i].n} is not below week ${tapers[i - 1].n}`);
  }
});

test("volume still ramps where the sessions can carry it", () => {
  /* The fixes above only ever lower a week. The loading curve is untouched. */
  const g = built();
  const loading = g.weeks.filter((w) => !w.taper && !w.deload);
  const peak = Math.max(...loading.map((w) => w.km));
  assert.ok(peak > loading[0].km * 1.3,
    `${loading[0].km} → ${peak} km is not a ramp`);
});

test("the easy Hyrox session holds volume rather than costing it", () => {
  /*
   * In the specific phase this session is paid for by a quality run, and it used to report
   * zero running — so a 12 km session became a 0 km one and his weeks fell from 56 km to 36
   * in the four weeks where race-specific running matters most. The volume was not
   * reallocated, it was lost, and the taper then measured itself against the loss.
   */
  const g = built();
  const easy = g.weeks.flatMap((w) => of(w).filter((s) => s.kind === "easy_hyrox")
    .map((s) => ({ n: w.n, taper: w.taper, s })));
  assert.ok(easy.length >= 3, "the specific phase carries one of these a week");
  for (const e of easy) {
    if (e.taper) continue;
    assert.ok((e.s.km ?? 0) > 0, `week ${e.n}: easy Hyrox carries no running`);
    assert.ok((e.s.km ?? 0) <= 6.1, `week ${e.n}: ${e.s.km} km is a run with rowing attached`);
    /* Written as easy running, which is the only reason it is allowed to count. */
    assert.match(e.s.target_text ?? "", /Z2 easy run/);
    /* And the machine work still says nothing about pace, because it is not running. */
    assert.match(e.s.target_text ?? "", /500m row Z2/);
  }

  const specific = g.weeks.filter((w) => w.phase === "specific");
  const build = g.weeks.filter((w) => w.phase === "build" && !w.deload);
  const peak = Math.max(...build.map((w) => w.km));
  const worst = Math.min(...specific.map((w) => w.km));
  /*
   * The specific phase does trade running for station work, deliberately. What it must not
   * do is halve the running: a third off the peak was the fault, not the design.
   */
  assert.ok(worst > peak * 0.6,
    `specific bottoms at ${worst} km against a build peak of ${peak}`);
});

/*
 * A beginner's first block. Sarah gave no peak week and no longest run, asked for seven
 * sessions and is racing in ten weeks — which is the case that exposed both of these.
 */
const beginner = () => built({
  base: "3 to 12 months", runningSelf: "Runs with walk breaks",
  peakWeekKm: null, longestRunKm: null, targetSessions: "7",
  raceDate: "2026-10-28", difficulty: "Challenging",
  commitments: [], freq: {}, commitDay: {}, commitMode: {},
});

test("the long run climbs towards what the race contains, not towards a share of a small week", () => {
  /*
   * Hers sat at 5.0 km for five weeks and reached 6.1 by week 8, ten weeks out from a race
   * with 8 km of running in it, because the long run was sized as a share of a 20 km week
   * and nothing in the arithmetic knew what she had entered. A share is the right way to
   * grow a long run and the wrong way to decide whether it is long enough.
   */
  const g = beginner();
  const loading = g.weeks.filter((w) => !w.taper && !w.deload);
  const longest = Math.max(...loading.map((w) =>
    of(w).find((s) => s.kind === "long_run")?.km ?? 0));
  assert.ok(longest >= 7.5, `her longest run in the block is ${longest} km against a race with 8`);
  assert.ok(longest <= 8.1, `${longest} km is past what the race contains — no reason to go there`);
});

test("an athlete who asks for seven sessions gets seven", () => {
  /*
   * She got four, every week, because a 12 km week cannot hold three easy runs above their
   * floor and the shed runs were deleted. "Fewer runs, not shorter ones" answered the volume
   * question correctly and quietly broke a different promise.
   */
  const g = beginner();
  for (const w of g.weeks) {
    /* Race week is deliberately two sessions and two clear days. It is not a broken promise. */
    if (of(w).some((s) => String(s.kind) === "race")) continue;
    assert.ok(w.sessions.length >= 6,
      `week ${w.n} has ${w.sessions.length} sessions against the seven she asked for`);
    /* And the slot that is no longer a run is machine work, not a gap. */
    const runs = of(w).filter((s) =>
      ["long_run", "easy_run", "quality_run", "benchmark"].includes(String(s.kind))).length;
    const machines = of(w).filter((s) => s.kind === "easy_hyrox").length;
    if (runs < 4) {
      assert.ok(machines > 0,
        `week ${w.n} has ${runs} runs and no machine session to hold the slot`);
    }
  }
});

test("the reallocation does not raise the week past what the curve allowed", () => {
  /* A bigger long run takes from the easy runs. It must not take from the safety rule. */
  const g = beginner();
  for (const w of g.weeks) {
    if (of(w).some((s) => String(s.kind) === "race")) continue;
    assert.ok(w.km <= (w.target_km ?? w.km) + 2.5,
      `week ${w.n}: ${w.km} km prescribed against a curve asking ${w.target_km}`);
  }
});

test("race day is inside the block", () => {
  /*
   * It was not, for her. Sarah starts Monday 17 August and races Wednesday 28 October: 71
   * days, which the block length rounded to 10 weeks ending on 25 October — three days
   * before the gun. There was no race session, no race-week taper and no last hard week,
   * because the race-week rebuild is gated on the race falling inside the block and so
   * silently did nothing. A plan week is a Monday; what matters is how many Mondays there
   * are between the one she starts in and the one she races in, counting both.
   */
  for (const race of ["2026-10-28", "2026-11-29", "2026-10-31", "2026-11-02"]) {
    const g = built({ startDate: "2026-08-17", raceDate: race });
    const has = g.weeks.some((w) => of(w).some((s) => String(s.kind) === "race"
      && (s.label ?? "").toLowerCase().includes("race day")));
    assert.ok(has, `no race day in a block starting 2026-08-17 and racing ${race}`);
    /* And it is in the last week, not somewhere in the middle. */
    const last = g.weeks[g.weeks.length - 1];
    assert.ok(of(last).some((s) => String(s.kind) === "race"),
      `racing ${race}: the block does not end on race week`);
  }
});
