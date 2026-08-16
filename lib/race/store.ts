import { sql } from "../db";
import { diffDays, today } from "../dates";
import { checklistFor, dueLabel, type ChecklistItem } from "./checklist";
import {
  confidenceOf, cumulative, prefill, project, realism, roxzoneFrom, routes,
  sensitivityLine, type Capability, type RacePlan, type Source,
} from "./plan";

/**
 * Loading, pre-filling and saving a race plan.
 *
 * The pre-fill is the whole differentiator: a generic Hyrox calculator opens
 * blank and asks for guesses, and this one opens with the athlete's own numbers
 * and says where each came from.
 */

/** The eight stations in race order. Names are display, ids are stable. */
export const STATIONS: { id: string; name: string }[] = [
  { id: "ski", name: "SkiErg 1000 m" },
  { id: "sled_push", name: "Sled push 50 m" },
  { id: "sled_pull", name: "Sled pull 50 m" },
  { id: "burpees", name: "Burpee broad jump 80 m" },
  { id: "row", name: "Row 1000 m" },
  { id: "carry", name: "Farmers carry 200 m" },
  { id: "lunges", name: "Sandbag lunges 100 m" },
  { id: "wall_balls", name: "Wall balls ×100" },
];

/** Field medians, the only honest starting point where nothing else exists. */
const MEDIAN_STATION_S: Record<string, number> = {
  ski: 240, sled_push: 180, sled_pull: 240, burpees: 300,
  row: 260, carry: 150, lunges: 240, wall_balls: 330,
};
const MEDIAN_ROXZONE_S = 45;

export type Loaded = {
  plan: RacePlan;
  capability: Capability;
  needs_roxzone_confirmation: boolean;
};

/**
 * Build a plan from whatever the athlete's own data supports.
 *
 * Order is the source hierarchy: their own race splits, then a benchmark, then
 * key sessions, then the field. Nothing is blended — an average of a race split
 * and a median is neither, and they could not tell which half they were seeing.
 */
export async function prefilled(athleteId: string, raceId: string): Promise<Loaded> {
  // Their own most recent official result: the only thing that measures roxzone.
  const [race] = await sql<{
    run_avg_s: number | null; stations_s: number | null; rox_s: number | null;
  }[]>`
    select run_avg_s, stations_s, rox_s from races
     where user_id = ${athleteId} order by race_date desc nulls last limit 1
  `;

  const [bench] = await sql<{ rounds: unknown }[]>`
    select rounds from benchmark_results
     where athlete_id = ${athleteId} and not aborted
     order by completed_at desc limit 1
  `;
  const benchRuns = (Array.isArray(bench?.rounds) ? bench.rounds : []) as
    { run_s: number; distance_m?: number; station_s?: number }[];
  const benchPace = benchRuns.length
    ? Math.round(benchRuns.reduce((n, r) =>
        n + r.run_s * (1000 / (r.distance_m || 1000)), 0) / benchRuns.length)
    : null;

  const [best] = await sql<{ pace: number | null }[]>`
    select min(moving_time / (distance_m / 1000.0))::int as pace from activities
     where user_id = ${athleteId} and sport_type ilike '%run%'
       and distance_m between 4800 and 5400 and moving_time > 0
  `;

  const runPace = prefill<number>([
    { value: race?.run_avg_s ?? null, source: "race" },
    { value: benchPace, source: "benchmark" },
    { value: best?.pace ?? null, source: "key_sessions" },
    { value: 330, source: "estimated" },
  ])!;

  const stationSplit = race?.stations_s ? Math.round(race.stations_s / 8) : null;

  const { roxzone, needs_confirmation } = roxzoneFrom(
    race?.rox_s ? Math.round(race.rox_s / 8) : null, MEDIAN_ROXZONE_S,
  );

  const plan: RacePlan = {
    mode: "components_up",
    target_total_s: null,
    runs: STATIONS.map(() => ({
      target_pace_s_per_km: runPace.value, source: runPace.source,
    })),
    stations: STATIONS.map((s) => {
      const picked = prefill<number>([
        { value: stationSplit, source: "race" },
        { value: MEDIAN_STATION_S[s.id], source: "estimated" },
      ])!;
      return {
        station_id: s.id, target_time_s: picked.value,
        my_share: 0.5, source: picked.source,
      };
    }),
    roxzone,
  };

  return {
    plan,
    capability: {
      best_5k_pace_s_per_km: best?.pace ?? undefined,
      current_form_total_s: race?.run_avg_s
        ? race.run_avg_s * 8 + (race.stations_s ?? 0) + (race.rox_s ?? 0)
        : undefined,
    },
    needs_roxzone_confirmation: needs_confirmation,
  };
}

type Row = {
  id: string; mode: string; target_total_s: number | null;
  runs: unknown; stations: unknown; roxzone: unknown;
  pushed_to_watch_at: string | null;
};

export async function loadPlan(athleteId: string, raceId: string) {
  const [row] = await sql<Row[]>`
    select id, mode, target_total_s, runs, stations, roxzone,
           pushed_to_watch_at::text as pushed_to_watch_at
      from race_plans where race_id = ${raceId} and athlete_id = ${athleteId}
  `;
  if (!row) return null;
  return {
    id: row.id,
    pushed_to_watch_at: row.pushed_to_watch_at,
    plan: {
      mode: row.mode as RacePlan["mode"],
      target_total_s: row.target_total_s,
      runs: row.runs as RacePlan["runs"],
      stations: row.stations as RacePlan["stations"],
      roxzone: row.roxzone as RacePlan["roxzone"],
    },
  };
}

export async function savePlan(athleteId: string, raceId: string, plan: RacePlan) {
  const [row] = await sql<{ id: string }[]>`
    insert into race_plans (
      race_id, athlete_id, mode, target_total_s, runs, stations, roxzone, updated_at
    ) values (
      ${raceId}, ${athleteId}, ${plan.mode}, ${plan.target_total_s},
      ${sql.json(plan.runs as never)}, ${sql.json(plan.stations as never)},
      ${sql.json(plan.roxzone as never)}, now()
    )
    on conflict (race_id, athlete_id) do update set
      mode = excluded.mode, target_total_s = excluded.target_total_s,
      runs = excluded.runs, stations = excluded.stations,
      roxzone = excluded.roxzone, updated_at = now(),
      -- An edit makes the pushed workout stale rather than gone: the client
      -- shows "changed since you sent it", which is more useful than silence.
      pushed_to_watch_at = race_plans.pushed_to_watch_at
    returning id
  `;
  return row.id;
}

/** Everything the planner screen renders, computed rather than stored. */
export function projectionOf(plan: RacePlan, capability: Capability) {
  const proj = project(plan);
  return {
    ...proj,
    routes: routes(plan),
    sensitivity: sensitivityLine(),
    flags: realism(plan, capability),
    cumulative: cumulative(plan).map((c) => ({
      ...c, name: STATIONS.find((s) => s.id === c.label)?.name ?? c.label,
    })),
    stations_estimated: plan.stations.filter((s) => s.source === "estimated").length,
    confidence: confidenceOf(plan),
  };
}

// ------------------------------------------------------------- race week

export async function weekFor(athleteId: string, raceId: string, doubles: boolean) {
  const [race] = await sql<{
    race_date: string; name: string | null; venue: string | null;
    start_time: string | null; wave: string | null;
  }[]>`
    select race_date::text as race_date, name, venue, start_time, wave
      from race_targets where id = ${raceId} and athlete_id = ${athleteId}
  `;
  if (!race) return null;

  const daysToGo = diffDays(race.race_date, today());
  const stored = await sql<{ item_id: string; done: boolean; label: string | null;
    category: string | null; due_offset_days: number | null }[]>`
    select item_id, done, label, category, due_offset_days from race_checklist
     where race_id = ${raceId} and athlete_id = ${athleteId}
  `;
  const doneMap = new Map(stored.map((s) => [s.item_id, s]));

  const defaults: ChecklistItem[] = checklistFor(doubles);
  const added = stored
    .filter((s) => s.label && !defaults.some((d) => d.id === s.item_id))
    .map((s) => ({
      id: s.item_id, label: s.label!, category: (s.category ?? "logistics") as ChecklistItem["category"],
      due_offset_days: s.due_offset_days ?? -1,
    }));

  const checklist = [...defaults, ...added]
    .sort((a, b) => a.due_offset_days - b.due_offset_days)
    .map((i) => ({
      ...i,
      done: doneMap.get(i.id)?.done ?? false,
      due: dueLabel(i.due_offset_days, daysToGo),
    }));

  return {
    countdown_days: daysToGo,
    race: { ...race, doubles },
    travel: { venue: race.venue, start_time: race.start_time, wave: race.wave },
    checklist,
    done: checklist.filter((c) => c.done).length,
  };
}
