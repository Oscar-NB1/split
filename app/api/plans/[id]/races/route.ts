import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { today } from "@/lib/dates";
import {
  INTENTS, checkIntent, intentLocked, tooClose, type Intent,
} from "@/lib/race/brace";

/**
 * Adding a race to a plan.
 *
 * A plan has many races and exactly one target. Everything here is a rejection
 * with a reason rather than a correction: a race silently moved, or an intent
 * silently downgraded, is discovered on race day.
 */

type Row = { id: string; race_date: string; role: string; intent: string | null };

const racesOf = (planId: string) => sql<Row[]>`
  select id, race_date::text as race_date, role, intent
    from plan_races where plan_id = ${planId} order by race_date
`;

/** The plan, if it is this athlete's. A plan id in a path is a permission question. */
async function mine(planId: string, athleteId: string) {
  const [row] = await sql<{ id: string; start_date: string }[]>`
    select id, start_date::text as start_date from plan_templates
     where id = ${planId} and athlete_id = ${athleteId}
  `;
  if (!row) throw notFound("No such plan.");
  return row;
}

export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await mine(id, me.id);
  const races = await racesOf(id);
  return NextResponse.json({
    races: races.map((r) => ({
      ...r,
      intent_locked: r.role === "secondary" && intentLocked(r.race_date, today()),
    })),
  });
});

export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await mine(id, me.id);
  const b = await req.json();

  const date = String(b.race_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("A race needs a date.");
  const role = b.role === "target" ? "target" : "secondary";

  const existing = await racesOf(id);
  const target = existing.find((r) => r.role === "target");

  // One target, and the second is refused rather than replacing the first.
  if (role === "target" && target) {
    throw badRequest("This plan already has a target race. Change that one instead.");
  }
  // Two races this close are not two races.
  const clash = existing.find((r) => tooClose(r.race_date, date));
  if (clash) {
    throw badRequest(`There is already a race on ${clash.race_date}, which is inside five days of this one.`);
  }

  let intent: Intent | null = null;
  if (role === "secondary") {
    if (!target) throw badRequest("Set the target race before adding a secondary one.");
    intent = INTENTS.includes(b.intent) ? b.intent : "training";
    const ok = checkIntent(intent!, date, target.race_date);
    if (!ok.ok) {
      // Never downgraded silently: the athlete chooses from what is left.
      return NextResponse.json(
        { error: ok.reason, allowed: ok.allowed }, { status: 400 },
      );
    }
  }

  const [row] = await sql<{ id: string }[]>`
    insert into plan_races (
      plan_id, race_date, venue, role, discipline, division, sex_category,
      partner_name, intent, intent_locked
    ) values (
      ${id}, ${date}, ${b.venue ?? null}, ${role}, ${b.discipline ?? null},
      ${b.division ?? null}, ${b.sex_category ?? null}, ${b.partner_name ?? null},
      ${intent}, ${role === "secondary" && intentLocked(date, today())}
    ) returning id
  `;
  return NextResponse.json({ id: row.id, role, intent, races: await racesOf(id) });
});
