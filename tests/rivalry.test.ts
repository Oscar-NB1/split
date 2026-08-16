import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSISTENT_AT, DENIED, MAX_ACTIVE, SHAREABLE, consistency, decide,
  pairKey, scoreSide, shareable, type Prescribed,
} from "../lib/rivalry";

const plan = (o: Partial<Prescribed> = {}): Prescribed =>
  ({ sessions: 5, km: 34, station_sessions: 2, has_plan: true, away: false, ...o });
const did = (sessions: number, km: number, station = 2) =>
  ({ sessions, km, station_sessions: station });

test("a score is a share of your own prescription", () => {
  const s = scoreSide(plan({ sessions: 5, km: 34 }), did(4, 30));
  assert.equal(s.adherence_pct, 0.8);
  assert.equal(s.volume_pct, Math.round((30 / 34) * 1000) / 1000);
});

test("the smaller plan can win, which is the whole point", () => {
  /*
   * The failure this model exists to avoid: 11 km against a 12 km week is a
   * better week than 9 km against a 34 km week, and loses on the raw number.
   */
  const small = scoreSide(plan({ sessions: 3, km: 12, station_sessions: 1 }), did(3, 11, 1));
  const big = scoreSide(plan({ sessions: 6, km: 34, station_sessions: 3 }), did(3, 9, 1));
  assert.ok(small.km_done < big.km_done === false || small.km_done > big.km_done);
  assert.equal(decide(small, big, true).winner, "requester");
  assert.ok(small.adherence_pct! > big.adherence_pct!);
});

test("absolutes are returned but never decide a row", () => {
  // identical adherence, wildly different volumes
  const a = scoreSide(plan({ sessions: 4, km: 40 }), did(2, 20));
  const b = scoreSide(plan({ sessions: 4, km: 10 }), did(2, 5));
  assert.equal(a.km_done, 20);
  assert.equal(b.km_done, 5);
  assert.equal(decide(a, b, true).winner, "tie");
});

test("a deload week is still scored, because it is a share of a lower plan", () => {
  const deload = scoreSide(plan({ sessions: 4, km: 20 }), did(4, 20));
  const loading = scoreSide(plan({ sessions: 6, km: 46 }), did(5, 40));
  assert.equal(decide(deload, loading, true).winner, "requester");
});

// ------------------------------------------------------------------- edges

test("nothing is declared until the week has had its extra day", () => {
  const a = scoreSide(plan(), did(5, 34));
  const b = scoreSide(plan(), did(1, 8));
  assert.equal(decide(a, b, false).winner, "undecided");
  assert.deepEqual(decide(a, b, false).points, { requester: 0, addressee: 0 });
  assert.equal(decide(a, b, true).winner, "requester");
});

test("no plan on one side is not a contest", () => {
  const a = scoreSide(plan(), did(5, 34));
  const b = scoreSide(plan({ has_plan: false }), did(0, 0));
  assert.equal(decide(a, b, true).winner, "undecided");
  assert.equal(b.adherence_pct, null, "there is nothing to be a share of");
});

test("a week away is a tie, not a win for whoever stayed home", () => {
  // beating someone who was on a plane is not a result
  const home = scoreSide(plan(), did(5, 34));
  const away = scoreSide(plan({ away: true }), did(0, 0));
  const out = decide(home, away, true);
  assert.equal(out.winner, "tie");
  assert.deepEqual(out.points, { requester: 1, addressee: 1 });
});

test("a tie is a point each and no week win", () => {
  const a = scoreSide(plan(), did(4, 30));
  const b = scoreSide(plan(), did(4, 12));
  const out = decide(a, b, true);
  assert.equal(out.winner, "tie");
  assert.deepEqual(out.points, { requester: 1, addressee: 1 });
});

test("adherence alone decides it — no tiebreak smuggles absolutes back in", () => {
  const a = scoreSide(plan({ sessions: 4, km: 40, station_sessions: 4 }), did(2, 40, 4));
  const b = scoreSide(plan({ sessions: 4, km: 40, station_sessions: 4 }), did(2, 5, 0));
  assert.equal(decide(a, b, true).winner, "tie", "volume and stations do not break it");
});

test("consistency counts weeks at eighty per cent or better", () => {
  assert.equal(CONSISTENT_AT, 0.8);
  assert.equal(consistency([
    { adherence_pct: 0.79 }, { adherence_pct: 0.8 }, { adherence_pct: 1.2 },
    { adherence_pct: null },
  ]), 2);
});

// ------------------------------------------------------- what may be read

test("only effort crosses the line", () => {
  const row = {
    adherence_pct: 0.8, sessions_done: 4, streak: 3, weeks_won: 7,
    hr: 172, paces: ["4:12"], injuries: "achilles", weight: 78,
    benchmark_results: [1], archetype: "thin_engine", plan_contents: {},
  };
  const out = shareable(row) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out).sort(), ["adherence_pct", "sessions_done", "streak", "weeks_won"]);
  for (const d of DENIED) assert.ok(!(d in out), `${d} does not cross`);
});

test("the allowlist and the denylist do not overlap", () => {
  for (const s of SHAREABLE) assert.ok(!(DENIED as readonly string[]).includes(s));
});

// ------------------------------------------------------------ pair identity

test("one row per pair, whichever way round it was made", () => {
  assert.deepEqual(pairKey("a", "b"), pairKey("b", "a"));
  assert.deepEqual(pairKey("b", "a"), ["a", "b"]);
});

test("active rivalries are capped so the hourly job stays bounded", () => {
  assert.equal(MAX_ACTIVE, 10);
});
