import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { isUuid } from "@/lib/plan";

/**
 * Committing a rebuild the athlete has seen and accepted.
 *
 * Nothing here decides anything — the proposal was computed and stored when it was shown,
 * so what gets applied is exactly what they looked at. Recomputing on apply would mean the
 * week could change between the preview and the button, which is the one thing a preview
 * exists to rule out.
 */

type Ctx = { params: Promise<{ monday: string }> };

type Proposed = {
  monday: string;
  sessions: { id: string; date: string; km?: number }[];
  dropped: { id: string }[];
};

export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { monday } = await ctx.params;
  const body = await req.json();
  const id = String(body?.proposal_id ?? "");
  if (!isUuid(id)) throw badRequest("Which proposal?");

  const [row] = await sql<{ proposal: Proposed; applied_at: string | null }[]>`
    select proposal, applied_at::text as applied_at from week_rebuilds
     where id = ${id} and user_id = ${me.id} and week_start = ${monday}
  `;
  if (!row) throw notFound("That proposal has gone.");
  if (row.applied_at) throw badRequest("That rebuild has already been applied.");

  const p = row.proposal;
  let moved = 0;
  for (const s of p.sessions) {
    /*
     * Moved sessions keep where they came from, so the change log can say "from Sunday" and
     * an undo has somewhere to put them back.
     */
    const [changed] = await sql<{ id: string }[]>`
      update planned_sessions
         set planned_date = ${s.date},
             original_date = coalesce(original_date, planned_date),
             updated_at = now()
       where id = ${s.id} and user_id = ${me.id}
         and planned_date <> ${s.date}
         and status = 'planned' and activity_id is null
       returning id
    `;
    if (changed) moved += 1;
  }

  /*
   * Dropped sessions become `skipped`, never `missed`.
   *
   * The plan removed them, not the athlete — and `missed` feeds the volume-reduction
   * signals, so recording it that way would have the app conclude somebody is struggling
   * because it took sessions away from them.
   */
  let skipped = 0;
  if (p.dropped.length > 0) {
    const rows = await sql<{ id: string }[]>`
      update planned_sessions
         set status = 'skipped', skip_reason = 'other', updated_at = now()
       where id = any(${p.dropped.map((d) => d.id)}) and user_id = ${me.id}
         and status = 'planned' and activity_id is null
       returning id
    `;
    skipped = rows.length;
  }

  await sql`update week_rebuilds set applied_at = now() where id = ${id}`;

  return NextResponse.json({
    ok: true, moved, skipped,
    /*
     * One line for the week summary, and an undo window. Twenty-four hours because a rebuild
     * is a decision made in a hurry about a week that has not happened yet.
     */
    note: `Rebuilt ${monday} — ${skipped} dropped, ${moved} moved`,
    undo_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
});

/** Put it back, inside the window. */
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { monday } = await ctx.params;
  const [row] = await sql<{ id: string; proposal: Proposed; applied_at: string | null }[]>`
    select id, proposal, applied_at::text as applied_at from week_rebuilds
     where user_id = ${me.id} and week_start = ${monday} and applied_at is not null
     order by applied_at desc limit 1
  `;
  if (!row) throw notFound("Nothing to undo for that week.");
  if (Date.parse(row.applied_at!) < Date.now() - 24 * 3600 * 1000) {
    throw badRequest("That rebuild is more than a day old. Move the sessions you need by hand.");
  }

  /*
   * Undo is `original_date`, not the inverse of the proposal.
   *
   * Reversing a diff assumes nothing else changed in between, and something usually has —
   * the column already knows where each session started.
   */
  const back = await sql<{ id: string }[]>`
    update planned_sessions
       set planned_date = original_date, original_date = null, updated_at = now()
     where user_id = ${me.id} and original_date is not null
       and planned_date >= ${monday}::date and planned_date < ${monday}::date + 7
     returning id
  `;
  const restored = await sql<{ id: string }[]>`
    update planned_sessions set status = 'planned', skip_reason = null, updated_at = now()
     where id = any(${row.proposal.dropped.map((d) => d.id)}) and user_id = ${me.id}
       and status = 'skipped' and activity_id is null
     returning id
  `;
  await sql`update week_rebuilds set applied_at = null where id = ${row.id}`;
  return NextResponse.json({ ok: true, moved_back: back.length, restored: restored.length });
});
