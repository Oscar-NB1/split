import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROX, SEED, TARGET, raceWorkoutText, sanitise, sanitiseRox, totals,
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
