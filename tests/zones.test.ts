import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HR_MAX, MIN_WIDTH, OPEN_TOP, fromMax, label, nudge, problems, sanitise,
} from "../lib/zones";

const ceilings = (z: ReturnType<typeof fromMax>) => z.slice(0, 4).map((x) => x.max);

test("a table from a maximum has no gaps and no overlaps", () => {
  for (const max of [150, 189, 205]) {
    const z = fromMax(max);
    assert.equal(z.length, 5);
    assert.deepEqual(problems(z), [], `${max} bpm`);
    for (let i = 1; i < 5; i++) {
      assert.equal(z[i].min, z[i - 1].max + 1, `${max}: no gap below ${z[i].tag}`);
    }
    assert.equal(z[4].max, OPEN_TOP, "the last zone has no ceiling");
  }
});

test("the boundaries are the plan's, for the plan's measured maximum", () => {
  assert.deepEqual(ceilings(fromMax(189)), [140, 152, 168, 181]);
});

test("a different maximum gives a different table", () => {
  // her max is not his, and applying his zones to her reports her easy runs as
  // threshold work
  assert.notDeepEqual(ceilings(fromMax(170)), ceilings(fromMax(189)));
  assert.ok(ceilings(fromMax(170))[1] < ceilings(fromMax(189))[1]);
});

test("labels always agree with the numbers beside them", () => {
  const z = fromMax(189);
  assert.equal(z[0].label, "≤ 140 bpm");
  assert.equal(z[1].label, "141–152");
  assert.equal(z[4].label, "182+");
});

test("a nudged ceiling stays between its neighbours", () => {
  const z = fromMax(189);
  // Z2 up by 40 cannot climb past Z3
  const up = nudge(z, 1, 40, 189);
  assert.ok(up[1].max <= z[2].max - MIN_WIDTH, "stops short of Z3");
  assert.deepEqual(problems(up), []);
  // and down by 40 cannot drop under Z1
  const down = nudge(z, 1, -40, 189);
  assert.ok(down[1].max >= z[0].max + MIN_WIDTH, "stays above Z1");
  assert.deepEqual(problems(down), []);
});

test("nudging one zone does not drag its neighbours along", () => {
  // an athlete who set Z4 deliberately should not lose it to a Z2 adjustment
  const z = fromMax(189);
  const after = nudge(z, 1, 5, 189);
  assert.equal(after[0].max, z[0].max);
  assert.equal(after[2].max, z[2].max);
  assert.equal(after[3].max, z[3].max);
});

test("the top zone can be pushed up to the maximum", () => {
  const z = fromMax(189);
  const up = nudge(z, 3, 20, 189);
  assert.ok(up[3].max >= z[3].max, "it moves");
  assert.deepEqual(problems(up), []);
});

test("a stored table is used when it is sane and ignored when it is not", () => {
  const good = label([130, 145, 160, 175]);
  assert.deepEqual(ceilings(sanitise(good, 189)), [130, 145, 160, 175]);

  // anything that is not four ascending ceilings falls back rather than being
  // half-repaired into something nobody chose
  const implied = ceilings(fromMax(189));
  assert.deepEqual(ceilings(sanitise(null, 189)), implied);
  assert.deepEqual(ceilings(sanitise([], 189)), implied);
  assert.deepEqual(ceilings(sanitise("nope", 189)), implied);
  assert.deepEqual(ceilings(sanitise(label([160, 145, 170, 180]), 189)), implied, "descending");
  assert.deepEqual(ceilings(sanitise([{ max: 1 }, { max: 2 }], 189)), implied, "too short");
});

test("problems names a gap rather than letting one through", () => {
  const broken = [
    { tag: "Z1", label: "", min: 0, max: 140, colour: "" },
    { tag: "Z2", label: "", min: 145, max: 152, colour: "" },
    { tag: "Z3", label: "", min: 153, max: 168, colour: "" },
    { tag: "Z4", label: "", min: 169, max: 181, colour: "" },
    { tag: "Z5", label: "", min: 182, max: OPEN_TOP, colour: "" },
  ];
  // a run that falls in the hole is reported as nothing at all
  assert.ok(problems(broken).some((p) => /gap between Z1 and Z2/.test(p)));
});

test("no maximum on file still gives a usable table", () => {
  assert.deepEqual(ceilings(fromMax(null)), ceilings(fromMax(DEFAULT_HR_MAX)));
  assert.deepEqual(ceilings(fromMax(40)), ceilings(fromMax(DEFAULT_HR_MAX)), "implausible is ignored");
});
