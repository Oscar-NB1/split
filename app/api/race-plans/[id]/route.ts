import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { distribute, type RacePlan } from "@/lib/race/plan";
import { prefilled, projectionOf, savePlan } from "@/lib/race/store";

type Row = {
  race_id: string; mode: string; target_total_s: number | null;
  runs: unknown; stations: unknown; roxzone: unknown;
  pushed_to_watch_at: string | null;
};

async function owned(planId: string, athleteId: string) {
  const [row] = await sql<Row[]>`
    select race_id, mode, target_total_s, runs, stations, roxzone,
           pushed_to_watch_at::text as pushed_to_watch_at
      from race_plans where id = ${planId} and athlete_id = ${athleteId}
  `;
  if (!row) throw notFound("No such race plan.");
  return {
    raceId: row.race_id,
    pushed_to_watch_at: row.pushed_to_watch_at,
    plan: {
      mode: row.mode as RacePlan["mode"], target_total_s: row.target_total_s,
      runs: row.runs as RacePlan["runs"], stations: row.stations as RacePlan["stations"],
      roxzone: row.roxzone as RacePlan["roxzone"],
    },
  };
}

/**
 * Edit the plan.
 *
 * Either direction. `distribute: true` with a target spreads it across the
 * components; otherwise the components are taken as given and the projection
 * follows them. The components are never quietly reshaped to match a target the
 * athlete typed — that has to be asked for.
 */
export const PUT = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const { raceId, plan, pushed_to_watch_at } = await owned(id, me.id);
  const b = await req.json();

  let next: RacePlan = { ...plan };

  if (Array.isArray(b.runs)) {
    next.runs = plan.runs.map((r, i) => {
      const v = Number(b.runs[i]);
      if (!Number.isFinite(v) || v <= 0) return r;
      // An edited number stops claiming to be measured.
      return v === r.target_pace_s_per_km ? r
        : { target_pace_s_per_km: Math.round(v), source: "manual" };
    });
  }
  if (Array.isArray(b.stations)) {
    next.stations = plan.stations.map((s, i) => {
      const v = Number(b.stations[i]);
      if (!Number.isFinite(v) || v <= 0) return s;
      return v === s.target_time_s ? s
        : { ...s, target_time_s: Math.round(v), source: "manual" };
    });
  }
  if (b.roxzone_s !== undefined) {
    const v = Number(b.roxzone_s);
    if (!Number.isFinite(v) || v < 0) throw badRequest("That is not a transition time.");
    next.roxzone = v === plan.roxzone.per_transition_s
      ? plan.roxzone : { per_transition_s: Math.round(v), source: "manual" };
  }
  if (b.my_share !== undefined) {
    const v = Number(b.my_share);
    if (!(v >= 0 && v <= 1)) throw badRequest("A share is between 0 and 1.");
    next.stations = next.stations.map((s) => ({ ...s, my_share: v }));
  }
  if (b.target_total_s !== undefined) {
    const v = b.target_total_s === null ? null : Math.round(Number(b.target_total_s));
    if (v !== null && !(v > 0)) throw badRequest("That is not a target.");
    next.target_total_s = v;
    if (v !== null && b.distribute === true) {
      next = { ...distribute(next, v), mode: "target_down" };
    }
  }

  await savePlan(me.id, raceId, next);
  const { capability } = await prefilled(me.id, raceId);
  return NextResponse.json({
    id, plan: next, pushed_to_watch_at,
    projection: projectionOf(next, capability),
    /** true once an edit has outdated what is on the watch */
    stale_on_watch: pushed_to_watch_at !== null,
  });
});

/** The projection on its own, for a screen that only needs the numbers. */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const { raceId, plan, pushed_to_watch_at } = await owned(id, me.id);
  const { capability } = await prefilled(me.id, raceId);
  return NextResponse.json({
    id, plan, pushed_to_watch_at, projection: projectionOf(plan, capability),
  });
});
