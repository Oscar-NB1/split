import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  classify, isResultUrl, parseHyroxResult, resultIdOf, toSeconds, validationError,
} from "../lib/hyrox";

/**
 * The fixture is a real results.hyrox.com detail page (scripts and comments
 * stripped), not a hand-written approximation. A parser tested against invented
 * HTML only proves the invented HTML matches the parser.
 */
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixtures/hyrox-detail.html"), "utf8");
const URL_ =
  "https://results.hyrox.com/season-8/?content=detail&fpid=list_overall" +
  "&pid=list_overall&idp=LR3MS4JI4ED4A2OV&lang=EN_CAP&event=HPRO_HYROXOVERALL";

test("only https results.hyrox.com URLs are fetchable", () => {
  assert.equal(isResultUrl(URL_), true);
  // the whole point: a prefix check would accept this one
  assert.equal(isResultUrl("https://results.hyrox.com.evil.test/?idp=x"), false);
  assert.equal(isResultUrl("https://evil.test/?u=https://results.hyrox.com/"), false);
  assert.equal(isResultUrl("http://results.hyrox.com/?idp=x"), false); // not https
  assert.equal(isResultUrl("file:///etc/passwd"), false);
  assert.equal(isResultUrl("http://169.254.169.254/latest/meta-data/"), false);
  assert.equal(isResultUrl("not a url"), false);
});

test("the result id is taken from the query string", () => {
  assert.equal(resultIdOf(URL_), "LR3MS4JI4ED4A2OV");
  assert.equal(resultIdOf("https://results.hyrox.com/season-8/"), null);
});

test("times parse, and dashes are not zero", () => {
  assert.equal(toSeconds("00:52:00"), 3120);
  assert.equal(toSeconds("00:02:42"), 162);
  assert.equal(toSeconds("02:42"), 162);
  assert.equal(toSeconds("1:00:45"), 3645); // the Mechelen finish time
  // a missing split must be null, never 0 — a zero would look like a world record
  assert.equal(toSeconds("–"), null);
  assert.equal(toSeconds("-"), null);
  assert.equal(toSeconds(""), null);
  assert.equal(toSeconds("DNF"), null);
});

test("the athlete and race panels are read", () => {
  const r = parseHyroxResult(html, URL_);
  assert.equal(r.athlete_name, "Roncevic, Alexander");
  assert.equal(r.bib, "M2");
  assert.equal(r.event_name, "Warsaw 2026");
  assert.equal(r.division, "HYROX PRO");
  assert.equal(r.age_group, "30-34");
  assert.equal(r.overall_seconds, 3120); // 00:52:00
  assert.equal(r.rank_overall, 1);
  assert.equal(r.rank_age_group, 1);
  assert.equal(r.external_id, "LR3MS4JI4ED4A2OV");
});

test("all eight runs and all eight stations come through", () => {
  const r = parseHyroxResult(html, URL_);
  const runs = r.splits.filter((s) => s.kind === "run");
  const stations = r.splits.filter((s) => s.kind === "station");
  assert.equal(runs.length, 8, "eight runs");
  assert.equal(stations.length, 8, "eight stations");
  assert.deepEqual(runs.map((s) => s.seconds), [162, 216, 248, 244, 241, 242, 247, 198]);
  assert.deepEqual(
    stations.map((s) => s.label),
    ["1000m SkiErg", "50m Sled Push", "50m Sled Pull", "80m Burpee Broad Jump",
     "1000m Row", "200m Farmers Carry", "100m Sandbag Lunges", "Wall Balls"],
  );
});

test("roxzone is captured, since it is where races are lost", () => {
  const r = parseHyroxResult(html, URL_);
  const rox = r.splits.find((s) => s.kind === "roxzone");
  assert.ok(rox, "roxzone present");
  assert.equal(rox!.seconds, 168); // 00:02:48
});

test("the summary table wins over the empty race-replay table", () => {
  // The page lists the same eight stations twice. The replay copy is all
  // dashes, and taking the first table found would store a race with no times.
  const r = parseHyroxResult(html, URL_);
  const ski = r.splits.filter((s) => /skierg/i.test(s.label));
  assert.equal(ski.length, 1, "SkiErg appears once, not twice");
  assert.equal(ski[0].seconds, 222); // 00:03:42, the real time
});

test("station places are kept and missing ones stay null", () => {
  const r = parseHyroxResult(html, URL_);
  assert.equal(r.splits.find((s) => /skierg/i.test(s.label))!.place, 446);
  // runs have no per-split place on this page; a dash must not become 0
  assert.equal(r.splits.find((s) => s.label === "Running 1")!.place, null);
});

test("run totals are separated from the runs themselves", () => {
  const r = parseHyroxResult(html, URL_);
  // 'Run Total' must not be counted as a ninth run, or the average is wrong
  assert.equal(classify("Run Total"), "total");
  assert.equal(classify("Best Run Lap"), "total");
  assert.equal(classify("Running 3"), "run");
  const runSum = r.splits.filter((s) => s.kind === "run").reduce((n, s) => n + s.seconds, 0);
  const stated = r.splits.find((s) => s.label === "Run Total")!.seconds;
  // NOT equal, and that is not a parsing error: each split is displayed rounded
  // to the second while Run Total is computed from the unrounded timings, so
  // eight splits drift by up to ~4s. Real numbers here: 1798 summed vs 1794
  // stated. Anything showing a run total must use the page's figure rather than
  // adding ours up, or it will disagree with the official result.
  assert.notEqual(runSum, stated);
  assert.ok(Math.abs(runSum - stated) <= 8, `drift ${runSum - stated}s is rounding, not a bug`);
});

test("a page with no result is rejected with a usable message", () => {
  const empty = parseHyroxResult("<html><body>nothing here</body></html>", URL_);
  const err = validationError(empty);
  assert.ok(err && /no splits found/i.test(err), err ?? "expected an error");
});

test("a valid race passes validation", () => {
  assert.equal(validationError(parseHyroxResult(html, URL_)), null);
});
