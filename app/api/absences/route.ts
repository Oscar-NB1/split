import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { ABSENCE_EFFECT, RE_ENTRY_DAYS } from "@/lib/plan/intake-rules";
import { diffDays } from "@/lib/dates";

/**
 * Weeks the athlete is away.
 *
 * Stored against the athlete rather than a plan: a trip is a fact about their
 * life and outlives any one block. The generator reads them at build time and
 * the plan keeps its own snapshot, so editing this list does not silently
 * rewrite a block that has already been trained.
 */

export type Row = {
  id: string; from_date: string; to_date: string; kind: string; note: string | null;
};

const KINDS = ["no_training", "some_access", "normal"] as const;

const load = (userId: string) => sql<Row[]>`
  select id, from_date::text as from_date, to_date::text as to_date, kind, note
    from absences where user_id = ${userId} order by from_date
`;

/** What each entry does to the weeks it touches, so a screen can say it. */
const describe = (r: Row) => {
  const days = diffDays(r.to_date, r.from_date) + 1;
  const effect = ABSENCE_EFFECT[r.kind as keyof typeof ABSENCE_EFFECT];
  return {
    ...r,
    days,
    /** the down week moves onto the trip rather than being spent beside it */
    consumes_deload: effect.consumesDeload,
    volume_factor: effect.volume,
    re_entry: r.kind !== "normal" && days >= RE_ENTRY_DAYS,
  };
};

export const GET = route(async () => {
  const me = await requireUser();
  return NextResponse.json({ absences: (await load(me.id)).map(describe) });
});

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const b = await req.json();

  if (b.remove) {
    await sql`delete from absences where id = ${String(b.remove)} and user_id = ${me.id}`;
    return NextResponse.json({ absences: (await load(me.id)).map(describe) });
  }

  const from = String(b.from_date ?? "");
  const to = String(b.to_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw badRequest("Both dates are needed.");
  }
  // Reversed rather than rejected: two date pickers make this easy to do and it
  // is unambiguous what was meant.
  const [a, z] = diffDays(to, from) < 0 ? [to, from] : [from, to];
  if (diffDays(z, a) > 120) throw badRequest("That is longer than a training block.");

  const kind = KINDS.includes(b.kind) ? b.kind : "some_access";
  await sql`
    insert into absences (user_id, from_date, to_date, kind, note)
    values (${me.id}, ${a}, ${z}, ${kind}, ${b.note ?? null})
  `;
  return NextResponse.json({ absences: (await load(me.id)).map(describe) });
});
