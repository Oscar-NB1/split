import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROX, SEED, TARGET, raceWorkoutText, sanitise, sanitiseRox, totals,
  seedFor,
} from "../lib/strategy";

test("the seeded plan is the plan's own projection", () => {
  const t = totals(SEED, DEFAULT_ROX);
  assert.equal(t.finish, 3344, "55:44");
  assert.ok(t.finish < TARGET, "inside the 56:30 target");
  // eight stations, so eight transitions — not sixteen segments' worth
  assert.equal(t.rox, DEFAULT_ROX * 8);
  assert.equal(SEED.filter((s) => s.kind === "Station").length, 8);
  assert.equal(SEED.filter((s) => s.kind === "Run").length, 8);
});

test("a stored plan keeps the race's structure and only the athlete's times", () => {
  // the payload comes from a client, so the names and kinds are taken from SEED
  const out = sanitise([{ sec: 200, name: "Nonsense", kind: "Run", note: "injected" }]);
  assert.equal(out[0].sec, 200, "the time is theirs");
  assert.equal(out[0].name, SEED[0].name, "the name is not");
  assert.equal(out[0].note, SEED[0].note);
  assert.equal(out.length, SEED.length, "a short payload does not shorten the race");
});

test("times outside the plausible range fall back rather than being stored", () => {
  assert.equal(sanitise([{ sec: 0 }])[0].sec, SEED[0].sec);
  assert.equal(sanitise([{ sec: -99 }])[0].sec, SEED[0].sec);
  assert.equal(sanitise([{ sec: 99999 }])[0].sec, SEED[0].sec);
  assert.equal(sanitise([{ sec: "fast" }])[0].sec, SEED[0].sec);
  assert.equal(sanitise(null)[0].sec, SEED[0].sec);
  assert.equal(sanitiseRox(9999), DEFAULT_ROX);
  assert.equal(sanitiseRox(25), 25);
});

test("the exported workout has a step per segment and per transition", () => {
  const text = raceWorkoutText(SEED, 30);
  const lines = text.split("\n");
  assert.equal(lines.length, SEED.length + 8, "sixteen segments, eight roxzones");
  assert.ok(lines.every((l) => l.startsWith("- ")), "every line is a step");
  assert.equal(lines[0], "- 3:52 Run 1 — Hold back. Everyone goes out hot.");
  assert.equal(lines[2], "- 0:30 Roxzone", "the transition follows the station");
});

// --- the seed, built for whoever is looking ------------------------------------

test("the starting plan comes from the athlete's own goal, not from one athlete's", () => {
  /*
   * SEED is one athlete's race: 56:30, with a note about which station they were
   * strongest at. Handed to somebody with a ninety-minute goal it is a stranger's
   * plan — which is what Sarah would have been shown.
   */
  const fast = seedFor({ goal_seconds: 55 * 60 });
  const slow = seedFor({ goal_seconds: 95 * 60 });
  assert.ok(Math.abs(totals(fast.segments, fast.rox_seconds).finish - 55 * 60) <= 20,
    `${totals(fast.segments, fast.rox_seconds).finish}s against a 55:00 goal`);
  assert.ok(Math.abs(totals(slow.segments, slow.rox_seconds).finish - 95 * 60) <= 30,
    `${totals(slow.segments, slow.rox_seconds).finish}s against a 95:00 goal`);

  // every segment is longer in the slower plan, and the shape is unchanged
  fast.segments.forEach((f, i) => {
    assert.ok(slow.segments[i].sec > f.sec, `${f.name} scales`);
    assert.equal(slow.segments[i].kind, f.kind);
    assert.equal(slow.segments[i].name, f.name);
  });
});

test("an athlete with no goal time gets the plan's own numbers, not a guess", () => {
  const none = seedFor({});
  const silly = seedFor({ goal_seconds: 4 * 60 });
  assert.deepEqual(silly.segments.map((s) => s.sec), none.segments.map((s) => s.sec),
    "a four-minute Hyrox is not a goal, it is a typo");
});

test("the limiter tilts the split without changing the finish", () => {
  const goal_seconds = 70 * 60;
  const runner = seedFor({ goal_seconds, role: "run_limiter" });
  const carrier = seedFor({ goal_seconds, role: "station_carrier" });

  const rt = totals(runner.segments, runner.rox_seconds);
  const ct = totals(carrier.segments, carrier.rox_seconds);
  /*
   * A run-limited athlete does not get a slower plan — they get an honest one: more
   * of their finish is in the eight runs, so planning them at everybody else's split
   * guarantees eight missed splits and a panic by run four.
   */
  assert.ok(rt.runs > ct.runs, `${rt.runs}s of running against ${ct.runs}s`);
  assert.ok(rt.stations < ct.stations);
  assert.ok(Math.abs(rt.finish - ct.finish) <= 30, "and both still finish at the goal");
});

test("a singles plan has no handover notes in it", () => {
  const pair = seedFor({ goal_seconds: 60 * 60, doubles: true });
  const solo = seedFor({ goal_seconds: 60 * 60, doubles: false });

  const ski = (s: { segments: { name: string; note: string }[] }) =>
    s.segments.find((r) => r.name === "SkiErg 1000 m")?.note ?? "";
  assert.match(ski(pair), /500\/500|who starts/i, "doubles agree the handover");
  assert.doesNotMatch(ski(solo), /500\/500|swap|each|who starts/i,
    "a note about a partner is advice for somebody who is not there");

  // and the race craft that is true for everybody survives both
  for (const rows of [pair.segments, solo.segments]) {
    assert.match(rows[0].note, /hold back/i);
  }
});
