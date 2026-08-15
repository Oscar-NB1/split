import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK, badDay, best, confidenceFrom, type Capability } from "../lib/plan/capability";
import { type Kit, deriveVariant, equipmentFlags, resolveSessionPreference } from "../lib/plan/variant";
import {
  ABSENCE_EFFECT, checkIntake, mergeAbsences, needsReEntry, type Absence, type IntakeCheck,
} from "../lib/plan/intake-rules";

// ------------------------------------------------------- the source hierarchy

const cap = (field: string, value: number, source: Capability["source"], at: string): Capability =>
  ({ field, value, source, captured_at: at });

test("a quiz retake never clobbers a measured benchmark", () => {
  // the whole reason this is a hierarchy rather than a last-write-wins column
  const rows = [
    cap("cv_pace_s", 300, "measured_benchmark", "2026-01-01"),
    cap("cv_pace_s", 260, "reported_self", "2026-08-01"),
  ];
  assert.equal(best(rows).cv_pace_s.value, 300, "the older measurement wins");
  assert.equal(best(rows).cv_pace_s.source, "measured_benchmark");
});

test("within one source, the most recent capture wins", () => {
  const rows = [
    cap("cv_pace_s", 300, "measured_benchmark", "2026-01-01"),
    cap("cv_pace_s", 288, "measured_benchmark", "2026-06-01"),
  ];
  assert.equal(best(rows).cv_pace_s.value, 288);
});

test("an official race outranks everything", () => {
  assert.ok(RANK.measured_race < RANK.measured_benchmark);
  assert.ok(RANK.measured_benchmark < RANK.reported_race);
  assert.ok(RANK.reported_race < RANK.reported_self);
});

test("roxzone can only ever come from a measurement", () => {
  // nobody self-reports their transition time, and a made-up one is confidently
  // wrong about the 90–110 seconds it decides
  const rows = [
    cap("roxzone_s", 400, "reported_self", "2026-08-01"),
    cap("roxzone_s", 95, "measured_race", "2026-03-01"),
  ];
  assert.equal(best(rows).roxzone_s.value, 95);
  assert.equal(best([cap("roxzone_s", 400, "reported_self", "2026-08-01")]).roxzone_s, undefined,
    "a self-reported roxzone is not stored as one at all");
});

test("confidence follows whether anything was measured", () => {
  assert.equal(confidenceFrom([cap("x", 1, "reported_self", "2026-01-01")]), "estimated");
  assert.equal(confidenceFrom([cap("x", 1, "measured_benchmark", "2026-01-01")]), "measured");
});

test("a retest much worse than the last is not silently accepted", () => {
  // a bad night's sleep and a real decline look identical in the number
  assert.equal(badDay(300, 360), true, "20% slower");
  assert.equal(badDay(300, 315), false, "5% slower is noise");
  assert.equal(badDay(300, 280), false, "faster is not a bad day");
});

// ------------------------------------------------------------- the variant

const kitFull: Kit[] = ["race_weight_sled", "ski", "row", "wall_balls"];

test("full needs race weight, every station, an open floor and attached running", () => {
  assert.equal(deriveVariant({ kit: kitFull, access: "open_floor", run_attachment: "attached" }), "full");
  assert.equal(deriveVariant({ kit: kitFull, access: "queue", run_attachment: "attached" }), "gym",
    "queuing is not an open floor");
  assert.equal(deriveVariant({ kit: kitFull, access: "open_floor", run_attachment: "separate" }), "gym",
    "runs elsewhere is not full");
  assert.equal(deriveVariant({
    kit: ["light_sled", "ski", "row", "wall_balls"] as Kit[], access: "open_floor", run_attachment: "attached",
  }), "gym", "a lighter sled is not race weight");
});

test("no facility is field, and classes beat everything", () => {
  assert.equal(deriveVariant({ kit: [], access: "open_floor", run_attachment: "attached" }), "field");
  assert.equal(deriveVariant({ kit: kitFull, access: "classes_only", run_attachment: "attached" }), "class");
});

test("a lighter sled is flagged as bigger than a variant downgrade", () => {
  const f = equipmentFlags({
    kit: ["light_sled", "ski"] as Kit[], access: "open_floor", run_attachment: "attached",
  });
  assert.ok(f.some((x) => x.code === "light_sled_only"));
  assert.ok(f.find((x) => x.code === "light_sled_only")!.message.includes("first time"));
});

test("classes-only overrides a stated preference, once, at intake", () => {
  const r = resolveSessionPreference("prescribed", "classes_only");
  assert.equal(r.resolved, "flexible");
  assert.ok(r.flag, "and the athlete is told rather than handed sessions they cannot run");
  assert.equal(resolveSessionPreference("prescribed", "open_floor").resolved, "prescribed");
});

// -------------------------------------------------------------- the absences

const check = (over: Partial<IntakeCheck> = {}): IntakeCheck => ({
  start_date: "2026-08-17", race_date: "2026-11-28", absences: [],
  target_sessions: 4, available_days: [0, 1, 2, 3, 4], allow_doubles: false,
  kit: kitFull, run_attachment: "attached", ...over,
});

test("a block that starts after its race is rejected", () => {
  const r = checkIntake(check({ start_date: "2026-12-01" }));
  assert.ok(r.problems.some((p) => p.field === "start_date"));
});

test("overlapping absences of the same kind merge", () => {
  const { merged } = mergeAbsences([
    { from_date: "2026-09-01", to_date: "2026-09-07", type: "no_training" },
    { from_date: "2026-09-05", to_date: "2026-09-12", type: "no_training" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].to_date, "2026-09-12");
});

test("overlapping absences that disagree are a clash, named", () => {
  // "no training" and "training as normal" cannot both be true of one week
  const { problems } = mergeAbsences([
    { from_date: "2026-09-01", to_date: "2026-09-07", type: "no_training" },
    { from_date: "2026-09-05", to_date: "2026-09-12", type: "normal" },
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].why, /overlaps/);
});

test("a trip running past race day is truncated, not rejected", () => {
  const r = checkIntake(check({
    absences: [{ from_date: "2026-11-20", to_date: "2026-12-10", type: "no_training" }],
  }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.absences[0].to_date, "2026-11-28");
  assert.ok(r.flags.some((f) => f.code === "absence_truncated"));
});

test("a trip inside the last three weeks is accepted and flagged", () => {
  // it reshapes the plan rather than one week
  const r = checkIntake(check({
    absences: [{ from_date: "2026-11-15", to_date: "2026-11-20", type: "no_training" }],
  }));
  assert.deepEqual(r.problems, []);
  assert.ok(r.flags.some((f) => f.code === "absence_near_race"));
});

test("more sessions than days needs doubles", () => {
  assert.ok(checkIntake(check({ target_sessions: 6 })).problems
    .some((p) => p.field === "target_sessions"));
  assert.deepEqual(checkIntake(check({ target_sessions: 6, allow_doubles: true })).problems, []);
});

test("training as normal does not consume a down week", () => {
  // someone who kept training on a work trip has not had a recovery week
  assert.equal(ABSENCE_EFFECT.normal.consumesDeload, false);
  assert.equal(ABSENCE_EFFECT.no_training.consumesDeload, true);
  assert.equal(ABSENCE_EFFECT.no_training.volume, 0.35);
  assert.equal(ABSENCE_EFFECT.some_access.volume, 0.60);
});

test("ten days away or more earns a return week", () => {
  // resuming at full volume after two weeks off is where the injuries are
  const away = (d: number, type: Absence["type"] = "no_training"): Absence => ({
    from_date: "2026-09-01",
    to_date: new Date(Date.UTC(2026, 8, d)).toISOString().slice(0, 10), type,
  });
  assert.equal(needsReEntry(away(10)), true);
  assert.equal(needsReEntry(away(5)), false);
  assert.equal(needsReEntry(away(20, "normal")), false, "not if they kept training");
});
