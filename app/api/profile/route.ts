import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { coachedBy, coachees } from "@/lib/coaching";
import { badRequest, route } from "@/lib/http";
import { avatarFrom } from "@/lib/avatar";

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

  /*
   * The picture, as a data URI in the row.
   *
   * There is no object store wired up, and adding one to change an avatar is a
   * disproportionate amount of infrastructure — the client resizes to 256 px and
   * re-encodes before sending, which lands around 20 KB. The cap here is what
   * stops a bad client putting a two-megabyte row in front of every query that
   * reads a user.
   *
   * `null` clears it; absent leaves it alone, so the rest of the form can be
   * saved without touching the photo.
   */
  const avatar = avatarFrom(b.avatar_url);
  if (avatar === "too_big") {
    throw badRequest("That image is too large. Try a smaller one.");
  }
  if (avatar === "not_an_image") {
    throw badRequest("That is not an image file.");
  }

  /*
   * Only the fields that were sent.
   *
   * Every column was written unconditionally, so a caller PATCHing one field wiped the
   * rest — which made this endpoint unusable from anywhere except the full profile form,
   * and the strength screen needs to ask for a bodyweight without also clearing a heart
   * rate and a date of birth. `undefined` means "not mentioned"; an explicit null still
   * clears, which is how the form empties a field.
   */
  const keep = <T,>(sent: boolean, value: T, column: string) =>
    sent ? value : sql(column);
  await sql`
    update users set
      avatar_url = ${avatar === "unchanged" ? sql`avatar_url` : avatar},
      hr_max = ${keep("hr_max" in b, hr, "hr_max")},
      weight_kg = ${keep("weight_kg" in b, kg, "weight_kg")},
      dob = ${keep("dob" in b, b.dob || null, "dob")},
      injury_notes = ${keep("injury_notes" in b, b.injury_notes ?? null, "injury_notes")},
      gender = ${keep("gender" in b,
        typeof b.gender === "string" && b.gender.trim() ? b.gender.trim().slice(0, 40) : null,
        "gender")},
      display_name = coalesce(${name}, display_name)
    where id = ${me.id}
  `;
  return NextResponse.json({ ok: true });
});
