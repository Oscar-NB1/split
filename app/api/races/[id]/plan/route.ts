import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { prefilled, projectionOf, savePlan, loadPlan } from "@/lib/race/store";

/** The race this athlete owns, or nothing. An id in a path is a permission question. */
async function mine(raceId: string, athleteId: string) {
  const [row] = await sql<{ id: string; discipline: string | null }[]>`
    select id, discipline from race_targets
     where id = ${raceId} and athlete_id = ${athleteId}
  `;
  if (!row) throw notFound("No such race.");
  return row;
}

/**
 * Open the planner.
 *
 * Creates the plan pre-filled from the athlete's own data if it does not exist,
 * because a planner that opens blank is the thing this replaces. Idempotent: a
 * second call returns the plan they already have rather than overwriting their
 * edits with fresh defaults.
 */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await mine(id, me.id);

  const existing = await loadPlan(me.id, id);
  if (existing) {
    const { capability } = await prefilled(me.id, id);
    return NextResponse.json({
      id: existing.id, plan: existing.plan,
      pushed_to_watch_at: existing.pushed_to_watch_at,
      projection: projectionOf(existing.plan, capability),
      created: false,
    });
  }

  const { plan, capability, needs_roxzone_confirmation } = await prefilled(me.id, id);
  const planId = await savePlan(me.id, id, plan);
  return NextResponse.json({
    id: planId, plan, pushed_to_watch_at: null,
    projection: projectionOf(plan, capability),
    needs_roxzone_confirmation,
    created: true,
  });
});
