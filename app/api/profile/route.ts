import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { coachedBy, coachees } from "@/lib/coaching";
import { route } from "@/lib/http";

/** The athlete's own settings: zones come from hr_max, switches from notify. */
export const GET = route(async () => {
  const me = await requireUser();
  /*
   * Six independent reads, fired together.
   *
   * They ran in sequence, which cost six round trips to build one screen. None of
   * them depends on another, so the only thing the ordering bought was latency.
   */
  const [[row], conns, [counts], [plan], mine, theirs, [src]] = await Promise.all([
    sql<{
      hr_max: number | null; notify: Record<string, boolean>; display_name: string;
      email: string | null; dob: string | null; weight_kg: number | null;
      injury_notes: string | null; avatar_url: string | null; gender: string | null;
    }[]>`
      select hr_max, notify, display_name, email, dob::text as dob, weight_kg,
             injury_notes, avatar_url, gender
        from users where id = ${me.id}
    `,
    sql<{ provider: string; updated_at: string }[]>`
      select provider, updated_at::text as updated_at
        from oauth_accounts where user_id = ${me.id}
    `,
    sql<{ activities: number; since: string | null }[]>`
      select count(*)::int as activities, min(local_date)::text as since
        from activities where user_id = ${me.id}
    `,
    sql<{ ok: boolean }[]>`
      select exists (select 1 from plan_templates
                      where athlete_id = ${me.id} and active) as ok
    `,
    coachees(me.id),
    coachedBy(me.id),
    sql<{ src: string }[]>`
      select name || ' · updated ' || to_char(created_at, 'DD Mon YYYY') as src
        from plan_templates where athlete_id = ${me.id} and active
        order by created_at desc limit 1
    `,
  ]);

  return NextResponse.json({
    ...(row ?? { hr_max: null, notify: {} }),
    weight_kg: row?.weight_kg == null ? null : Number(row.weight_kg),
    // read from the coaching table rather than hardcoded, so a second athlete
    // appears here without a code change
    has_plan: plan?.ok ?? false,
    coachees: mine,
    coached_by: theirs,
    connected: conns.map((c) => c.provider),
    connections: conns,
    activities: counts?.activities ?? 0,
    since: counts?.since ?? null,
    /**
     * Which plan the app is reading, and when it was written.
     *
     * Shown at the foot of the profile. Worth nothing until a session looks
     * wrong, and then the first thing anyone needs to know.
     */
    plan_source: src?.src ?? null,
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
      gender = ${typeof b.gender === "string" && b.gender.trim() ? b.gender.trim().slice(0, 40) : null},
      display_name = coalesce(${name}, display_name)
    where id = ${me.id}
  `;
  return NextResponse.json({ ok: true });
});
