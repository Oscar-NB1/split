import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import {
  fieldUsability, usableFields, type FieldUsability, type Intent,
} from "@/lib/race/brace";

/**
 * What a B-race proved, and what it is not allowed to prove.
 *
 * A secondary race is potentially the best data in the block: a real event, run at
 * real intensity, and — now that benchmark retests are gone from the generator —
 * the only in-plan source of a roxzone. It is also the easiest way to poison every
 * prescription downstream, because its fields are not equally trustworthy. A pair
 * who ran at the slower partner's pace did not measure this athlete's running. A
 * race run as training measured willingness, not ceiling. An athlete who took 70%
 * of the station work has station times that mean nothing beside a solo target.
 *
 * So the result is stored whole, and only the fields that survive `fieldUsability`
 * write capability. The verdict is stored beside the numbers, because a later change
 * to the rules must not retroactively promote a field that was distorted on the day.
 */

type Ctx = { params: Promise<{ id: string }> };

type Race = {
  id: string; race_date: string; role: string; intent: string | null;
  discipline: string | null;
};

async function mine(raceId: string, athleteId: string): Promise<Race> {
  const [row] = await sql<Race[]>`
    select id, race_date::text as race_date, role, intent, discipline
      from race_targets where id = ${raceId} and athlete_id = ${athleteId}
  `;
  if (!row) throw notFound("No such race.");
  return row;
}

/** Seconds, or null. Anything outside the plausible range is a typo, not a time. */
function seconds(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return n >= min && n <= max ? n : null;
}

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await mine(id, me.id);
  const [row] = await sql`
    select finish_s, run_avg_s, stations_s, rox_s, my_share, partner_slower,
           field_usability, captured_at::text as captured_at
      from race_results where race_id = ${id}
  `;
  return NextResponse.json({ result: row ?? null });
});

/**
 * Record the result.
 *
 * PUT rather than POST: one race has one result, and an athlete correcting a time
 * they mistyped should not create a second. The capability rows are rewritten to
 * match, so a correction cannot leave the old value behind still driving paces.
 */
export const PUT = route(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const race = await mine(id, me.id);
  const b = await req.json();

  if (race.race_date > new Date().toISOString().slice(0, 10)) {
    throw badRequest("That race has not happened yet.");
  }

  /*
   * Ranges, not just types.
   *
   * A Hyrox is 45 minutes at the front and five hours at the back; a run average
   * outside 2:30–12:00 per km is a mistyped field rather than a pace. Out-of-range
   * values become null rather than 400, because a result with four good fields and
   * one fat-fingered one should still be storable — but the bad field must never
   * reach the capability hierarchy.
   */
  const finish_s = seconds(b.finish_s, 40 * 60, 5 * 60 * 60);
  const run_avg_s = seconds(b.run_avg_s, 150, 720);
  const stations_s = seconds(b.stations_s, 5 * 60, 3 * 60 * 60);
  const rox_s = seconds(b.rox_s, 10, 30 * 60);

  const doubles = /doubles/i.test(race.discipline ?? "");
  /*
   * The two questions only the athlete can answer.
   *
   * Neither is derivable from the times. Whether the pair ran at the partner's pace
   * is a judgement about the day, and the share of station work is something only
   * the two of them know — which is exactly why they are asked rather than guessed,
   * and why a doubles result with neither answered is treated as unknown rather
   * than as even.
   */
  const partner_slower = doubles && b.partner_slower !== undefined
    ? Boolean(b.partner_slower) : null;
  const my_share = doubles && b.my_share !== undefined && b.my_share !== null
    ? Math.max(0, Math.min(1, Number(b.my_share)))
    : null;
  if (my_share !== null && !Number.isFinite(my_share)) {
    throw badRequest("Your share of the stations should be a fraction between 0 and 1.");
  }

  const usability: FieldUsability = fieldUsability({
    doubles,
    intent: (race.intent as Intent) ?? "compete",
    ...(partner_slower === null ? {} : { partner_slower }),
    ...(my_share === null ? {} : { my_share }),
  });

  await sql`
    insert into race_results (
      race_id, athlete_id, finish_s, run_avg_s, stations_s, rox_s,
      my_share, partner_slower, field_usability
    ) values (
      ${id}, ${me.id}, ${finish_s}, ${run_avg_s}, ${stations_s}, ${rox_s},
      ${my_share}, ${partner_slower}, ${sql.json(usability as never)}
    )
    on conflict (race_id) do update set
      finish_s = excluded.finish_s, run_avg_s = excluded.run_avg_s,
      stations_s = excluded.stations_s, rox_s = excluded.rox_s,
      my_share = excluded.my_share, partner_slower = excluded.partner_slower,
      field_usability = excluded.field_usability, captured_at = now()
  `;

  /*
   * Capability, from the fields that survived — and only those.
   *
   * `measured_race` is the top of the hierarchy, which is the point: a real race
   * outranks a benchmark and everything below it. Rewritten rather than appended so
   * a corrected time replaces the wrong one instead of racing it; scoped to this
   * race's own rows via `source_ref` so correcting a B-race cannot delete what the
   * target race or a benchmark proved.
   */
  const usable = usableFields(usability);
  const values: Record<string, number | null> = {
    // Field names match what the rest of the hierarchy already uses, and the run
    // pace says its unit: `run_pace_s` beside `station_total_s` reads as a duration.
    roxzone_s: usable.includes("roxzone") ? rox_s : null,
    run_pace_s_per_km: usable.includes("run_paces") ? run_avg_s : null,
    station_total_s: usable.includes("station_times") ? stations_s : null,
  };

  await sql`delete from capabilities where athlete_id = ${me.id} and source_ref = ${id}`;
  const wrote: string[] = [];
  for (const [field, value] of Object.entries(values)) {
    if (value === null) continue;
    await sql`
      insert into capabilities (athlete_id, field, value, source, source_ref, captured_at)
      values (${me.id}, ${field}, ${value}, 'measured_race', ${id},
              ${`${race.race_date}T12:00:00Z`})
    `;
    wrote.push(field);
  }

  return NextResponse.json({
    ok: true,
    usability,
    /** Which fields now drive prescriptions, and which were kept but not trusted. */
    capability_written: wrote,
    ignored: (["roxzone", "run_paces", "station_times"] as const)
      .filter((k) => usability[k] === "distorted"),
    /*
     * Said plainly. An athlete who has just raced and sees nothing change deserves
     * to know whether the plan took the result seriously, and if not, why not.
     */
    note: wrote.length === 0
      ? `Stored, but nothing here can move your paces: ${usability.reason ?? "the result is not comparable with your target race"}.`
      : usability.reason
        ? `${wrote.length} of three fields went into your plan. The rest were kept but not used, because ${usability.reason}.`
        : "All three fields went into your plan at the top of the hierarchy — this is a measured race.",
    rebuild_needed: wrote.length > 0,
  });
});

/** Remove a result, and the capability it wrote with it. */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await mine(id, me.id);
  await sql`delete from race_results where race_id = ${id}`;
  /*
   * Here the capability goes too, unlike when a whole race is deleted.
   *
   * Deleting a result is the athlete saying the numbers were wrong. Leaving a
   * capability row behind would keep prescribing from a time they have just
   * disowned.
   */
  await sql`delete from capabilities where athlete_id = ${me.id} and source_ref = ${id}`;
  return NextResponse.json({ ok: true, rebuild_needed: true });
});
