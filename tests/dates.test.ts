import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, diffDays, diffWeeks, dow, fmt, iso, mondayOf } from "../lib/dates";

/**
 * These run under TZ=Europe/Berlin (see package.json). Every case here failed
 * before lib/dates existed, because the old helpers went through
 * toISOString() - which is UTC - or divided milliseconds to count days.
 */

test("iso() reports the local calendar date, not the UTC one", () => {
  // 00:30 on 3 August in Berlin is still 2 August in UTC
  const justAfterMidnight = new Date(2026, 7, 3, 0, 30);
  assert.equal(iso(justAfterMidnight), "2026-08-03");
  assert.notEqual(iso(justAfterMidnight), justAfterMidnight.toISOString().slice(0, 10));
});

test("iso() survives local midnight exactly", () => {
  assert.equal(iso(new Date(2026, 0, 1, 0, 0, 0)), "2026-01-01");
});

test("mondayOf() returns the Monday of that week", () => {
  assert.equal(mondayOf("2026-08-14"), "2026-08-10"); // a Friday
  assert.equal(mondayOf("2026-08-10"), "2026-08-10"); // already Monday
  assert.equal(mondayOf("2026-08-16"), "2026-08-10"); // Sunday belongs to it
});

test("dow() is 0 for Monday and 6 for Sunday", () => {
  assert.equal(dow("2026-08-10"), 0);
  assert.equal(dow("2026-08-16"), 6);
});

test("addDays() crosses month, year and DST boundaries", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  // spring forward in the EU: 29 March 2026
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-03-28", 7), "2026-04-04");
  // autumn back: 25 October 2026
  assert.equal(addDays("2026-10-24", 7), "2026-10-31");
});

test("diffDays() counts whole days across a DST change", () => {
  assert.equal(diffDays("2026-03-30", "2026-03-23"), 7); // a 167-hour week
  assert.equal(diffDays("2026-10-26", "2026-10-19"), 7); // a 169-hour week
  assert.equal(diffDays("2026-08-14", "2026-08-14"), 0);
  assert.equal(diffDays("2026-08-13", "2026-08-14"), -1);
});

test("diffWeeks() does not lose a week to DST", () => {
  // the bug: (167 hours / 168) floors to 0, so plan week 1 read as week 0
  assert.equal(diffWeeks("2026-03-30", "2026-03-23"), 1);
  assert.equal(diffWeeks("2026-10-26", "2026-10-19"), 1);
  assert.equal(diffWeeks("2026-11-23", "2026-08-10"), 15);
  assert.equal(diffWeeks("2026-08-03", "2026-08-10"), -1);
});

test("fmt() shows the intended day, not the one before", () => {
  assert.equal(fmt("2026-08-14", { weekday: "long" }), "Friday");
  assert.equal(fmt("2026-01-01", { day: "numeric", month: "short" }), "1 Jan");
});
