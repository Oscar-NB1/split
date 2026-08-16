import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROXZONE_FLOOR_S, STRETCH_MARGIN, confidenceOf, deltasToClose, distribute,
  prefill, project, realism, roxzoneFrom, sensitivity, type RacePlan, type Source,
} from "../lib/race/plan";

const STATIONS = ["ski", "sled_push", "sled_pull", "burpees", "row", "carry", "lunges", "wall_balls"];

const plan = (o: Partial<RacePlan> = {}): RacePlan => ({
  mode: "components_up",
  target_total_s: null,
  runs: Array.from({ length: 8 }, () => ({ target_pace_s_per_km: 270, source: "race" as Source })),
  stations: STATIONS.map((id) => ({
    station_id: id, target_time_s: 180, my_share: 0.5, source: "race" as Source,
  })),
  roxzone: { per_transition_s: 30, source: "race" as Source },
  ...o,
});

test("components add up, with the share applied to the stations", () => {
  const p = project(plan());
  assert.equal(p.run_total_s, 8 * 270);
  assert.equal(p.station_total_s, 8 * 180 * 0.5, "half of each station is theirs");
  assert.equal(p.roxzone_total_s, 8 * 30);
  assert.equal(p.projected_total_s, 2160 + 720 + 240);
});

test("the gap is signed, so it says which way it is wrong", () => {
  const slow = project(plan({ target_total_s: 3000 }));
  assert.equal(slow.gap_to_target_s, 120, "positive means slower than target");
  const fast = project(plan({ target_total_s: 3200 }));
  assert.equal(fast.gap_to_target_s, -80);
  assert.equal(project(plan()).gap_to_target_s, null, "no target, no gap");
});

test("one second per kilometre is eight seconds of race", () => {
  // the line that reframes where to spend six weeks of effort
  const s = sensitivity();
  assert.equal(s.run_pace_1s_per_km, 8);
  assert.equal(s.each_station_5s, 40);
  assert.equal(s.roxzone_5s, 40);
});

test("the gap comes back as what would close it, per component", () => {
  const ds = deltasToClose(plan({ target_total_s: 3000 }));
  const byName = Object.fromEntries(ds.map((d) => [d.component, d]));
  assert.equal(byName.run_pace.change_s, -15, "120 s over eight km is 15 s/km");
  assert.equal(byName.stations.change_s, -15, "or 15 s off each station");
  assert.equal(byName.roxzone.change_s, -15);
  assert.match(byName.run_pace.why, /15 s\/km across all eight runs/);
});

test("hitting the target exactly leaves nothing to close", () => {
  assert.deepEqual(deltasToClose(plan({ target_total_s: 3120 })), []);
});

test("distributing a target keeps their shape and never touches the roxzone", () => {
  // roxzone is the one component training cannot move, so shaving it to make
  // the arithmetic work would be inventing a number
  const p = distribute(plan(), 2880);
  assert.equal(p.roxzone.per_transition_s, 30, "untouched");
  // whole-second targets cannot always sum to an arbitrary total, and bending
  // one run to hide that would be worse than being a few seconds out
  assert.ok(Math.abs(project(p).projected_total_s - 2880) <= 8);
  // proportional, so a plan that was even stays even
  assert.equal(new Set(p.runs.map((r) => r.target_pace_s_per_km)).size, 1);
  assert.ok(p.runs[0].target_pace_s_per_km < 270, "and it got quicker");
});

test("distributed numbers stop claiming to be measured", () => {
  const p = distribute(plan(), 2880);
  assert.ok(p.runs.every((r) => r.source === "manual"));
  assert.equal(confidenceOf(p), "derived");
});

// -------------------------------------------------------------- confidence

test("one estimated field is enough to stop calling a plan measured", () => {
  assert.equal(confidenceOf(plan()), "measured");
  assert.equal(confidenceOf(plan({
    roxzone: { per_transition_s: 30, source: "estimated" },
  })), "estimated");
  assert.equal(confidenceOf(plan({
    runs: Array.from({ length: 8 }, () => ({ target_pace_s_per_km: 270, source: "key_sessions" as Source })),
  })), "derived");
});

// ------------------------------------------------------------ the roxzone

test("the roxzone has no derivable fallback, so it is asked for", () => {
  // nothing in training measures crossing a venue and queueing for a sled
  const raced = roxzoneFrom(38, 45);
  assert.deepEqual(raced.roxzone, { per_transition_s: 38, source: "race" });
  assert.equal(raced.needs_confirmation, false);

  const never = roxzoneFrom(null, 45);
  assert.equal(never.roxzone.source, "estimated", "never presented as theirs");
  assert.equal(never.roxzone.per_transition_s, 45, "the field median is a starting point");
  assert.equal(never.needs_confirmation, true);
});

// -------------------------------------------------------------- pre-fill

test("the best available source wins and nothing is blended", () => {
  // an average of a race split and a field median is neither
  const got = prefill([
    { value: null, source: "race" },
    { value: 275, source: "key_sessions" },
    { value: 300, source: "estimated" },
  ]);
  assert.deepEqual(got, { value: 275, source: "key_sessions" });
  assert.equal(prefill([{ value: null, source: "race" }]), null);
  assert.deepEqual(
    prefill([{ value: 300, source: "estimated" }, { value: 260, source: "race" }]),
    { value: 260, source: "race" }, "order of the list does not matter");
});

// ---------------------------------------------------------- realism check

test("a run target faster than measured 5 km pace is flagged, not blocked", () => {
  const flags = realism(plan({
    runs: Array.from({ length: 8 }, () => ({ target_pace_s_per_km: 230, source: "manual" as Source })),
  }), { best_5k_pace_s_per_km: 250 });
  const f = flags.find((x) => x.code === "unrealistic_runs")!;
  assert.equal(f.component, "runs");
  assert.match(f.message, /3:50 \/km/);
  assert.match(f.message, /no sled behind you/);
});

test("each unrealistic station names itself", () => {
  const p = plan();
  p.stations[1].target_time_s = 90;
  const flags = realism(p, { best_station_s: { sled_push: 150, ski: 170 } });
  const named = flags.filter((f) => f.code === "unrealistic_stations");
  assert.equal(named.length, 1, "only the one that is actually optimistic");
  assert.equal(named[0].component, "sled_push");
});

test("a roxzone under the floor is called out", () => {
  assert.equal(ROXZONE_FLOOR_S, 20);
  const flags = realism(plan({ roxzone: { per_transition_s: 12, source: "manual" } }), {});
  assert.ok(flags.some((f) => f.code === "unrealistic_roxzone"));
  assert.ok(!realism(plan(), {}).some((f) => f.code === "unrealistic_roxzone"));
});

test("a total well past current form is a stretch, and says so without refusing", () => {
  const flags = realism(plan(), { current_form_total_s: 3600 });
  const f = flags.find((f2) => f2.code === "stretch_target")!;
  assert.equal(f.component, "total");
  assert.match(f.message, /Keep it if you mean it/);
  assert.ok(3120 < 3600 * (1 - STRETCH_MARGIN));
  // and a plan inside current form is not flagged
  assert.ok(!realism(plan(), { current_form_total_s: 3200 })
    .some((f2) => f2.code === "stretch_target"));
});

test("no capability data means no flags rather than made-up ones", () => {
  assert.deepEqual(realism(plan(), {}), []);
});
