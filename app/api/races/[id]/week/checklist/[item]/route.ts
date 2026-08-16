import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { DEFAULT_CHECKLIST } from "@/lib/race/checklist";

/**
 * Tick an item, or add one of your own.
 *
 * The default items live in code so their wording can improve without a
 * migration; only what has been ticked, and anything the athlete added, is
 * stored. An unknown id with a label is an addition rather than an error —
 * athletes were promised they could add their own.
 */
export const PATCH = route(async (
  req: NextRequest, ctx: { params: Promise<{ id: string; item: string }> },
) => {
  const me = await requireUser();
  const { id, item } = await ctx.params;

  const [race] = await sql<{ id: string }[]>`
    select id from race_targets where id = ${id} and athlete_id = ${me.id}
  `;
  if (!race) throw notFound("No such race.");

  const b = await req.json();
  const known = DEFAULT_CHECKLIST.some((d) => d.id === item);
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 120) : null;
  if (!known && !label) throw badRequest("A new item needs a label.");

  if (b.remove === true) {
    if (known) throw badRequest("The default items cannot be removed, only ticked.");
    await sql`delete from race_checklist
      where race_id = ${id} and athlete_id = ${me.id} and item_id = ${item}`;
    return NextResponse.json({ ok: true });
  }

  await sql`
    insert into race_checklist (
      race_id, athlete_id, item_id, label, category, due_offset_days, done, updated_at
    ) values (
      ${id}, ${me.id}, ${item}, ${known ? null : label},
      ${known ? null : String(b.category ?? "logistics")},
      ${known ? null : Math.round(Number(b.due_offset_days ?? -1))},
      ${b.done === true}, now()
    )
    on conflict (race_id, athlete_id, item_id) do update set
      done = excluded.done, updated_at = now(),
      label = coalesce(excluded.label, race_checklist.label)
  `;
  return NextResponse.json({ ok: true });
});
