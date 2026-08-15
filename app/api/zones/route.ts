import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { canCoach } from "@/lib/coaching";
import { fromMax, nudge, problems, sanitise, type Zone } from "@/lib/zones";

/**
 * Heart-rate zones: read, nudge, reset.
 *
 * Editable two ways, as the design has it — move the maximum and all five
 * recalculate, or move one ceiling directly. Both go through lib/zones.ts,
 * because the invariant is the same either way: no crossing, no gaps, and every
 * label agreeing with the number beside it.
 *
 * Stored per athlete. Zones derived from one athlete's measured maximum and
 * applied to another report her easy runs as threshold work.
 */

type Row = { hr_max: number | null; zones: unknown };

async function loadZones(userId: string) {
  const [row] = await sql<Row[]>`select hr_max, zones from users where id = ${userId}`;
  return { hrMax: row?.hr_max ?? null, zones: sanitise(row?.zones, row?.hr_max ?? null) };
}

/**
 * Whose zones are being read or written.
 *
 * A coach may open their athlete's, which is what makes the coaching view work —
 * and may not open anyone else's, which is what stops a user id in a query
 * string from being an access-control hole.
 */
async function target(req: NextRequest, meId: string) {
  const forId = new URL(req.url).searchParams.get("athlete");
  if (!forId || forId === meId) return meId;
  if (!(await canCoach(meId, forId))) throw badRequest("That is not your athlete.");
  return forId;
}

export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const id = await target(req, me.id);
  const { hrMax, zones } = await loadZones(id);
  return NextResponse.json({
    athlete_id: id, hr_max: hrMax, zones,
    /** what the maximum implies, so a screen can offer "reset" honestly */
    implied: fromMax(hrMax),
    edited: JSON.stringify(zones) !== JSON.stringify(fromMax(hrMax)),
  });
});

export const PATCH = route(async (req: NextRequest) => {
  const me = await requireUser();
  const id = await target(req, me.id);
  const body = await req.json();
  const { hrMax, zones } = await loadZones(id);

  if (body.action === "reset") {
    // back to what the maximum implies, and stop storing an override
    await sql`update users set zones = null where id = ${id}`;
    return NextResponse.json({
      athlete_id: id, hr_max: hrMax, zones: fromMax(hrMax),
      implied: fromMax(hrMax), edited: false,
    });
  }

  let next: Zone[];
  let max = hrMax;

  if (body.action === "max") {
    const n = Number(body.hr_max);
    if (!Number.isFinite(n) || n < 120 || n > 230) {
      throw badRequest("A maximum heart rate between 120 and 230.");
    }
    max = Math.round(n);
    // moving the maximum rewrites all five: a hand-edited table against a new
    // maximum is a table nobody chose
    next = fromMax(max);
  } else if (body.action === "nudge") {
    const i = Number(body.index), d = Number(body.delta);
    if (!Number.isInteger(i) || i < 0 || i > 3) throw badRequest("Zones 1 to 4 have a ceiling to move.");
    if (!Number.isFinite(d) || Math.abs(d) > 20) throw badRequest("That is a big jump for one nudge.");
    next = nudge(zones, i, Math.round(d), hrMax);
  } else {
    throw badRequest("Unknown action.");
  }

  const bad = problems(next);
  if (bad.length) throw badRequest(bad.join(" "));

  await sql`
    update users set hr_max = ${max}, zones = ${sql.json(next as never)} where id = ${id}
  `;
  return NextResponse.json({
    athlete_id: id, hr_max: max, zones: next,
    implied: fromMax(max),
    edited: JSON.stringify(next) !== JSON.stringify(fromMax(max)),
  });
});
