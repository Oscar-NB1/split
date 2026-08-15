import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";

/** The athlete's own settings: zones come from hr_max, switches from notify. */
export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await sql<{
    hr_max: number | null; notify: Record<string, boolean>; display_name: string;
    email: string; dob: string | null; weight_kg: string | null; injury_notes: string | null;
  }[]>`
    select hr_max, notify, display_name, email, dob::text as dob, weight_kg, injury_notes
      from users where id = ${me.id}
  `;
  // both shapes: `connected` is the list the Profile screen's toggles read, and
  // `connections` carries the date, which the connections screen shows so a
  // connection made two years ago is distinguishable from one made this morning
  const conns = await sql<{ provider: string; updated_at: string }[]>`
    select provider, updated_at::text as updated_at
      from oauth_accounts where user_id = ${me.id} order by provider
  `;
  const [counts] = await sql<{ activities: number; since: string | null }[]>`
    select count(*)::int as activities, min(local_date)::text as since
      from activities where user_id = ${me.id}
  `;
  return NextResponse.json({
    ...(row ?? { hr_max: null, notify: {} }),
    weight_kg: row?.weight_kg == null ? null : Number(row.weight_kg),
    connected: conns.map((c) => c.provider),
    connections: conns,
    activities: counts?.activities ?? 0,
    since: counts?.since ?? null,
  });
});

export const PATCH = route(async (req: NextRequest) => {
  const me = await requireUser();
  const b = await req.json();
  // a maximum outside this range is a typo, not a heart rate — clamped rather
  // than rejected, because a 400 mid-edit loses the rest of the form
  const hr = b.hr_max == null || b.hr_max === ""
    ? null : Math.max(120, Math.min(230, Math.round(Number(b.hr_max))));
  const kg = b.weight_kg == null || b.weight_kg === ""
    ? null : Math.max(30, Math.min(250, Number(b.weight_kg)));
  const name = typeof b.display_name === "string" && b.display_name.trim()
    ? b.display_name.trim().slice(0, 80) : null;

  await sql`
    update users set
      hr_max = ${hr},
      weight_kg = ${kg},
      dob = ${b.dob || null},
      injury_notes = ${b.injury_notes ?? null},
      display_name = coalesce(${name}, display_name)
    where id = ${me.id}
  `;
  return NextResponse.json({ ok: true });
});
