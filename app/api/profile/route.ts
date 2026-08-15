import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";

/** The athlete's own settings: zones come from hr_max, switches from notify. */
export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await sql<{ hr_max: number | null; notify: Record<string, boolean> }[]>`
    select hr_max, notify from users where id = ${me.id}
  `;
  return NextResponse.json(row ?? { hr_max: null, notify: {} });
});

export const PATCH = route(async (req: NextRequest) => {
  const me = await requireUser();
  const b = await req.json();
  // a maximum outside this range is a typo, not a heart rate
  const hr = b.hr_max == null ? null : Math.max(120, Math.min(230, Math.round(Number(b.hr_max))));
  await sql`update users set hr_max = ${hr} where id = ${me.id}`;
  return NextResponse.json({ ok: true });
});
