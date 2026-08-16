import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { notFound, route } from "@/lib/http";
import { weekFor } from "@/lib/race/store";
import { projectionOf, prefilled } from "@/lib/race/store";
import { loadPlan } from "@/lib/race/store";
import { addDays, mondayOf } from "@/lib/dates";

/**
 * Race week: the taper plus logistics.
 *
 * Generated, not authored. The sessions are the plan's own, unchanged — a taper
 * is still training, and rewriting it here would mean two versions of the same
 * week. Only the checklist and the venue details are new.
 */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;

  const [race] = await sql<{ discipline: string | null; race_date: string }[]>`
    select discipline, race_date::text as race_date from race_targets
     where id = ${id} and athlete_id = ${me.id}
  `;
  if (!race) throw notFound("No such race.");

  const doubles = (race.discipline ?? "").includes("doubles");
  const week = await weekFor(me.id, id, doubles);
  if (!week) throw notFound("No such race.");

  // The sessions of the week the race falls in, exactly as prescribed.
  const from = mondayOf(race.race_date);
  const sessions = await sql<{
    planned_date: string; title: string; kind: string; target: string | null;
  }[]>`
    select planned_date::text as planned_date, title, kind, target
      from planned_sessions
     where user_id = ${me.id}
       and planned_date >= ${from} and planned_date < ${addDays(from, 7)}
       and kind <> 'rest'
     order by planned_date, slot nulls first
  `;

  const stored = await loadPlan(me.id, id);
  const projection = stored
    ? projectionOf(stored.plan, (await prefilled(me.id, id)).capability)
    : null;

  return NextResponse.json({
    ...week,
    sessions,
    race_plan_id: stored?.id ?? null,
    pushed_to_watch_at: stored?.pushed_to_watch_at ?? null,
    projection,
  });
});
