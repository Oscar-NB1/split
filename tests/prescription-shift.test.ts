import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSteps, shiftPaces } from "../lib/prescription";

test("a shift moves every pace in a prescription and nothing else", () => {
  const target = [
    "- 2km Z2 warm up @ 5:26-5:52/km",
    "- 6x",
    "- 800m Z4 @ 4:10/km",
    "- 90s Z1 walk",
    "- 1.6km Z1 cool down @ 5:56/km",
  ].join("\n");

  const faster = shiftPaces(target, -4);
  assert.match(faster, /@ 5:22-5:48\/km/);
  assert.match(faster, /@ 4:06\/km/);
  assert.match(faster, /@ 5:52\/km/);
  // The structure survives: same steps, same zones, same rest.
  assert.deepEqual(parseSteps(faster).map((g) => g.label),
    parseSteps(target).map((g) => g.label));
  assert.match(faster, /90s Z1 walk/, "a walking rest has no pace to move");
});

test("positive is slower, matching the engine's sign", () => {
  // The engine reports a positive shift when the athlete is behind prescription, and
  // a plan they are behind moves its targets away from them rather than toward them.
  assert.match(shiftPaces("- 1000m Z4 @ 4:10/km", 6), /4:16/);
});

test("nothing to shift, nothing changed", () => {
  const t = "- 8km Z2 @ 5:45-6:06/km";
  assert.equal(shiftPaces(t, 0), t);
  assert.equal(shiftPaces(null, -4), "");
  assert.equal(shiftPaces("Back squat 3x5 rest 180s", -4), "Back squat 3x5 rest 180s",
    "a strength prescription has no paces in it");
});

test("a pace cannot be shifted into nonsense", () => {
  // Two minutes a kilometre is faster than anyone reading this; the floor exists so a
  // runaway shift cannot produce a target nobody could hold.
  assert.match(shiftPaces("- 400m Z5 @ 2:10/km", -120), /2:00/);
});
