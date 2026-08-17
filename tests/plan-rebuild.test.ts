import { test } from "node:test";
import assert from "node:assert/strict";
import { LONG_RUN_FLOOR, rebuildWeek, type WeekSession } from "../lib/plan/rebuild";

/** The worked example from the brief: week 1, 34 km. */
const week = (): WeekSession[] => [
  { id: "q", day: 0, kind: "quality_run", label: "Quality 8 km", km: 8, hard: true },
  { id: "e", day: 1, kind: "easy_run", label: "Easy 8 km", km: 8 },
  { id: "kb1", day: 1, kind: "kickboxing", label: "Kickboxing" },
  { id: "h1", day: 2, kind: "hyrox", label: "Hyrox class", hard: true },
  { id: "st", day: 3, kind: "strength", label: "Strength" },
  { id: "kb2", day: 3, kind: "kickboxing", label: "Kickboxing" },
  { id: "h2", day: 5, kind: "hyrox", label: "Hyrox class", hard: true },
  { id: "l", day: 6, kind: "long_run", label: "Long run 16 km", km: 16 },
];

test("the key session is the last thing anybody loses", () => {
  /*
   * Strength goes first because one missed session is maintenance lost, not fitness lost.
   * The key session goes last because dropping it blinds the adaptation engine for a
   * fortnight — it is the only source of pace evidence the plan has.
   */
  const r = rebuildWeek(week(), {
    day_availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, available: "none" as const })),
  });
  const kinds = r.dropped.map((d) => d.kind);
  assert.ok(kinds.indexOf("strength") < kinds.indexOf("quality_run"),
    `strength should go before the key session: ${kinds.join(", ")}`);
});

test("a lost day drops the lowest priority, not the nearest session", () => {
  const r = rebuildWeek(week(), {
    day_availability: [{ day: 3, available: "none" }],
  });
  assert.deepEqual(r.dropped.filter((d) => d.kind === "strength").length, 1);
  assert.ok(!r.dropped.some((d) => d.kind === "quality_run"), "the key session survives");
  assert.ok(r.volume_delta <= 0);
});

test("the long run moves before it is dropped, and is cut rather than deleted", () => {
  /*
   * A long run relocated to a Friday evening and cut to 12 km beats a long run deleted —
   * which is what the athlete would choose if asked, so it is what the rebuild tries.
   */
  const r = rebuildWeek(week(), {
    day_availability: [
      { day: 2, available: "am" }, { day: 3, available: "none" }, { day: 4, available: "pm" },
    ],
    week_intent: { no_long_run: true },
  });
  const long = r.sessions.find((s) => s.kind === "long_run");
  assert.ok(long, "it is still in the week");
  assert.notEqual(long!.day, 6, "and no longer on Sunday");
  assert.ok(long!.km! >= 16 * LONG_RUN_FLOOR - 0.1, "cut to the floor, not below it");
  assert.ok(long!.km! < 16, "and genuinely shortened");
});

test("the week never gains volume", () => {
  /*
   * Cramming a lost week into the days that are left is how people get hurt, and it is the
   * instinct this feature exists to resist on the athlete's behalf.
   */
  const r = rebuildWeek(week(), { day_availability: [{ day: 3, available: "none" }] });
  assert.ok(r.volume_delta <= 0, `${r.volume_delta} km gained`);
});

test("a logged day is never touched", () => {
  // Forward only: rewriting a session somebody has done changes the record of their week.
  const w = week();
  w[0].logged = true;
  const r = rebuildWeek(w, {
    day_availability: [{ day: 0, available: "none" }],
  });
  assert.ok(r.sessions.some((s) => s.id === "q"), "the logged session stays");
  assert.ok(!r.dropped.some((d) => d.id === "q"));
});

test("an explicit skip outranks inference", () => {
  const r = rebuildWeek(week(), {
    session_actions: [{ day: 5, session_type: "hyrox", action: "skip" }],
  });
  assert.ok(r.dropped.some((d) => d.id === "h2"));
  assert.match(r.dropped.find((d) => d.id === "h2")!.why, /asked to skip/);
});

test("a protected session stays put, and the refusal says why", () => {
  /*
   * A rebuild may keep something on an unavailable day where the athlete asked for it —
   * but it must say so, which is what the screen turns into "we've kept Saturday where it
   * is".
   */
  const r = rebuildWeek(week(), {
    day_availability: [{ day: 5, available: "none" }],
    week_intent: { protect: ["hyrox"] },
  });
  assert.ok(r.sessions.some((s) => s.id === "h2"), "it is still there");
  assert.ok(r.refusals.some((f) => /protect/.test(f.why)), "and the refusal explains it");
});
