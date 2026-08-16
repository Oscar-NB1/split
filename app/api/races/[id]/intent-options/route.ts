import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { today } from "@/lib/dates";
import { INTENT_COST, intentLocked, intentOptions } from "@/lib/race/brace";

/**
 * What intent this secondary race can afford.
 *
 * Computed here and returned with the options so the client renders the same
 * rules the server enforces — two copies of a gating rule is one copy too many.
 * The cost of each intent rides along, because the choice is only meaningful
 * next to what it spends.
 */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;

  const [race] = await sql<{
    race_date: string; role: string; plan_id: string; intent: string | null;
  }[]>`
    select r.race_date::text as race_date, r.role, r.plan_id, r.intent
      from race_targets r join plan_templates p on p.id = r.plan_id
     where r.id = ${id} and p.athlete_id = ${me.id}
  `;
  if (!race) throw notFound("No such race.");
  if (race.role !== "secondary") {
    throw badRequest("The target race has no intent to choose — it is always the race.");
  }

  const [target] = await sql<{ race_date: string }[]>`
    select race_date::text as race_date from race_targets
     where athlete_id = ${me.id} and role = 'target'
  `;
  if (!target) throw badRequest("This plan has no target race yet.");

  const o = intentOptions(race.race_date, target.race_date);
  return NextResponse.json({
    ...o,
    current: race.intent,
    /** false once inside seven days, and then nothing here is editable */
    editable: !intentLocked(race.race_date, today()),
    costs: Object.fromEntries(o.allowed.map((i) => [i, INTENT_COST[i]])),
  });
});
