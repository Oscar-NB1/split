import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";

/**
 * Clearing the current plan.
 *
 * Deactivates the template and removes the sessions it wrote that have not
 * happened yet. Sessions already completed, and anything with an activity
 * attached, are kept: they are a record of what the athlete did, and deleting
 * them to tidy up a plan would destroy training history to remove a schedule.
 *
 * The template is deactivated rather than deleted, so "which plan wrote this
 * session" still has an answer for everything left behind.
 */
export const DELETE = route(async () => {
  const me = await requireUser();

  const [{ removed }] = await sql<{ removed: number }[]>`
    with gone as (
      delete from planned_sessions
       where user_id = ${me.id}
         and source = 'template'
         and status = 'planned'
         and activity_id is null
         and planned_date >= current_date
      returning 1
    ) select count(*)::int as removed from gone
  `;
  await sql`update plan_templates set active = false where athlete_id = ${me.id} and active`;

  return NextResponse.json({ ok: true, removed });
});
