import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { today } from "@/lib/dates";
import {
  INTENTS, checkIntent, intentLocked, tooClose, type Intent,
} from "@/lib/race/brace";

/**
 * Changing and removing one race.
 *
 * Adding a race and listing them already existed; the two things an athlete
 * actually does next did not. A B-race gets moved (the organiser shifts the date,
 * they get into a different wave, they decide to race it rather than train
 * through it) and a B-race gets cancelled — and until now neither was possible
 * without editing the database by hand.
 *
 * Every refusal here is a refusal with a reason rather than a silent correction.
 * A race quietly moved, or an intent quietly downgraded, is discovered on race day.
 */

type Ctx = { params: Promise<{ id: string }> };

type Race = {
  id: string; race_date: string; role: string; intent: string | null;
  venue: string | null; discipline: string | null; division: string | null;
  sex_category: string | null; partner_name: string | null;
};

const FIELDS = sql`
  id, race_date::text as race_date, role, intent, venue, discipline, division,
  sex_category, partner_name
`;

/** The race, if it is this athlete's. A race id in a path is a permission question. */
async function mine(raceId: string, athleteId: string): Promise<Race> {
  const [row] = await sql<Race[]>`
    select ${FIELDS} from race_targets
     where id = ${raceId} and athlete_id = ${athleteId}
  `;
  if (!row) throw notFound("No such race.");
  return row;
}

const others = (athleteId: string, exceptId: string) => sql<Race[]>`
  select ${FIELDS} from race_targets
   where athlete_id = ${athleteId} and id <> ${exceptId} order by race_date
`;

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const race = await mine(id, me.id);
  return NextResponse.json({
    race: {
      ...race,
      intent_locked: race.role === "secondary" && intentLocked(race.race_date, today()),
    },
  });
});

/**
 * Move a race, rename its venue, or change what it is for.
 *
 * Only the fields sent are touched, so a client that knows about the date does not
 * have to send the venue to avoid wiping it.
 */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const race = await mine(id, me.id);
  const b = await req.json();

  const rest = await others(me.id, id);
  const target = rest.find((r) => r.role === "target");

  /*
   * The date.
   *
   * Moving the target race is a different act from moving a B-race: it is the
   * thing the entire block is built backwards from, and changing it here would
   * leave fifteen weeks of sessions pointing at a day that is no longer the race.
   * Refused, with the place that can actually do it.
   */
  let date = race.race_date;
  if (b.race_date !== undefined) {
    date = String(b.race_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("A race needs a date.");
    if (date !== race.race_date) {
      if (race.role === "target") {
        throw badRequest(
          "This is the race your whole plan is built around. Moving it rebuilds the block, "
          + "so do it from the plan itself rather than here.",
        );
      }
      const clash = rest.find((r) => tooClose(r.race_date, date));
      if (clash) {
        throw badRequest(
          `There is already a race on ${clash.race_date}, which is inside five days of this one.`,
        );
      }
      if (target && date > target.race_date) {
        throw badRequest(
          `That is after your target race on ${target.race_date}. A secondary race is run inside the block, not after it.`,
        );
      }
    }
  }

  /*
   * The intent, and the two ways it can be refused.
   *
   * Locked inside seven days, because the taper it would rewrite has already
   * happened. And checked against the gap to the target even when it is not
   * locked: an athlete cannot choose to race a B-race flat out ten days before
   * their target, and they are shown what is left rather than downgraded to it.
   */
  let intent: Intent | null = race.intent as Intent | null;
  if (b.intent !== undefined && race.role === "secondary") {
    if (intentLocked(race.race_date, today())) {
      throw badRequest(
        "This race is inside a week. What it is for is settled now — the taper around it has already been written.",
      );
    }
    if (!INTENTS.includes(b.intent)) throw badRequest("That is not a race intent.");
    intent = b.intent as Intent;
    if (target) {
      const ok = checkIntent(intent, date, target.race_date);
      if (!ok.ok) {
        return NextResponse.json({ error: ok.reason, allowed: ok.allowed }, { status: 400 });
      }
    }
  }

  const [row] = await sql<Race[]>`
    update race_targets set
      race_date    = ${date},
      intent       = ${intent},
      venue        = ${b.venue        === undefined ? sql`venue`        : (b.venue ?? null)},
      discipline   = ${b.discipline   === undefined ? sql`discipline`   : (b.discipline ?? null)},
      division     = ${b.division     === undefined ? sql`division`     : (b.division ?? null)},
      sex_category = ${b.sex_category === undefined ? sql`sex_category` : (b.sex_category ?? null)},
      partner_name = ${b.partner_name === undefined ? sql`partner_name` : (b.partner_name ?? null)},
      intent_locked = ${race.role === "secondary" && intentLocked(date, today())}
     where id = ${id} and athlete_id = ${me.id}
     returning ${FIELDS}
  `;

  /*
   * A moved race changes the shape of the weeks around it.
   *
   * Said rather than done: the plan is rebuilt from the intake endpoint, which is
   * the one place that knows how to do it atomically, and a PATCH that silently
   * rewrote fifteen weeks of sessions would be the worst kind of surprise.
   */
  const moved = row.race_date !== race.race_date;
  return NextResponse.json({
    race: row,
    rebuild_needed: moved || intent !== race.intent,
    note: moved
      ? "The weeks around this race need rebuilding to match the new date."
      : null,
  });
});

/**
 * Remove a race.
 *
 * The target race cannot go this way: an athlete with no target has a plan built
 * towards nothing, and the honest action is to change the target or start a new
 * block, both of which happen elsewhere. A result is deleted with it — a result
 * belongs to a race, and keeping one whose race is gone would leave a capability
 * row nothing can explain.
 */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const race = await mine(id, me.id);

  if (race.role === "target") {
    throw badRequest(
      "This is the race your plan is built around, so it cannot just be removed. "
      + "Change its date, or start a new block.",
    );
  }

  const [result] = await sql<{ id: string }[]>`
    select id from race_results where race_id = ${id}
  `;
  await sql`delete from race_targets where id = ${id} and athlete_id = ${me.id}`;

  return NextResponse.json({
    ok: true,
    /*
     * Said out loud, because deleting a race that has already been run throws
     * away measured data — the roxzone especially, which a B-race is the only
     * in-plan source of. The capability row it wrote is left alone: it recorded
     * something that genuinely happened, and the race being removed from the
     * calendar does not make the athlete slower.
     */
    result_deleted: Boolean(result),
    note: result
      ? "That race had a result. It has gone with the race, but what it proved about you stays in your capability history."
      : null,
    rebuild_needed: true,
  });
});
