import { strict as assert } from "node:assert";
import test from "node:test";
import { clean, kindFromSport, suggestionsFor, type Structured } from "../lib/session-log";

const full = {
  summary: "Hyrox class — sled push and pull, wall balls, a couple of km between stations.",
  kind: "hyrox", duration_min: 90, rpe: 8,
  stations: [{ name: "Sled push", detail: "2 × 25 m" }, { name: "Wall balls", detail: "50 at 6kg" }],
  lifts: [{ name: "Goblet squat", sets: 3, reps: 10, load_kg: 16 }],
  running_km: 2, notes: "Left knee a bit tight on the lunges.",
};

test("a complete reading survives intact", () => {
  const s = clean(full)!;
  assert.equal(s.kind, "hyrox");
  assert.equal(s.duration_min, 90);
  assert.equal(s.rpe, 8);
  assert.equal(s.stations.length, 2);
  assert.equal(s.lifts[0].load_kg, 16);
  assert.equal(s.running_km, 2);
});

test("no summary is no log: the one field that has to be there", () => {
  assert.equal(clean({ ...full, summary: "  " }), null);
  assert.equal(clean(null), null);
  assert.equal(clean("a sentence"), null);
});

test("an implausible load costs that lift its number, not the whole log", () => {
  const s = clean({ ...full, lifts: [{ name: "Goblet squat", sets: 3, reps: 10, load_kg: 800 }] })!;
  assert.equal(s.lifts.length, 1);
  assert.equal(s.lifts[0].load_kg, null, "800 kg is a mis-hearing, not a personal best");
  assert.equal(s.summary, full.summary, "and the rest of the log is untouched");
});

test("out-of-range durations and efforts become null rather than nonsense", () => {
  assert.equal(clean({ ...full, duration_min: 5400 })!.duration_min, null); // seconds, not minutes
  assert.equal(clean({ ...full, duration_min: 0 })!.duration_min, null);
  assert.equal(clean({ ...full, rpe: 80 })!.rpe, null);
  assert.equal(clean({ ...full, running_km: 400 })!.running_km, null);
});

test("an unknown kind is null, not invented", () => {
  assert.equal(clean({ ...full, kind: "hyrox-ish" })!.kind, null);
  assert.equal(clean({ ...full, kind: null })!.kind, null);
});

test("nameless stations and lifts are dropped", () => {
  const s = clean({
    ...full,
    stations: [{ name: "", detail: "50" }, { name: "Rowing", detail: null }],
    lifts: [{ name: "   ", sets: 3, reps: 10, load_kg: 20 }],
  })!;
  assert.equal(s.stations.length, 1);
  assert.equal(s.stations[0].name, "Rowing");
  assert.equal(s.lifts.length, 0);
});

test("what Strava called it, in our own words", () => {
  assert.equal(kindFromSport("WeightTraining"), "strength");
  assert.equal(kindFromSport("Run"), "easy_run");
  assert.equal(kindFromSport("VirtualRide"), "spin");
  assert.equal(kindFromSport("Crossfit"), "other");
  assert.equal(kindFromSport(null), null);
});

test("a Hyrox class filed as weights is worth offering to correct", () => {
  const s = clean(full) as Structured;
  const out = suggestionsFor(s, "strength");
  assert.deepEqual(out[0], {
    type: "reclassify", from: "strength", to: "hyrox", why: "Strava called this strength",
  });
  assert.deepEqual(out[1], { type: "save_lifts", count: 1 });
});

test("nothing is suggested when the app already agrees", () => {
  const s = clean({ ...full, kind: "hyrox", lifts: [] }) as Structured;
  assert.deepEqual(suggestionsFor(s, "hyrox"), []);
});

test("a lift with no load is not offered as a set to save", () => {
  const s = clean({
    ...full, kind: "strength",
    lifts: [{ name: "Pull-up", sets: 3, reps: 8, load_kg: null }],
  }) as Structured;
  assert.deepEqual(suggestionsFor(s, "strength"), []);
});

test("and no log means no suggestions", () => {
  assert.deepEqual(suggestionsFor(null, "strength"), []);
});
