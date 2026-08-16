import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { addDays, mondayOf, today } from "@/lib/dates";
import { consistency, shareable, type Winner } from "@/lib/rivalry";
import { weekFor } from "@/lib/rivalry-db";

/**
 * The head-to-head.
 *
 * Rewritten from absolute output to a share of each athlete's own plan. The
 * previous version scored sessions completed, effort points, zone-2 minutes and
 * longest session — raw totals, on which two people on different plans are not
 * comparable. Eleven kilometres against a twelve-kilometre week is a better week
 * than nine against thirty-four, and lost on every one of those metrics.
 *
 * Absolutes are still returned, on their own line, because they are worth
 * seeing. They decide nothing.
 */

const WEEKS_BACK = 11;
/** A week is settled 24 hours after it closes, so late logs still land. */
const SETTLE_HOURS = 24;

const isFinalised = (weekStart: string, now = new Date()) =>
  now.getTime() >= Date.parse(`${addDays(weekStart, 7)}T00:00:00Z`) + SETTLE_HOURS * 3_600_000;

export const GET = route(async () => {
  const me = await requireUser();

  /*
   * Rivalries come from accepted connections. Until the connection endpoints
   * exist there is at most one, inferred from the coaching relationship, which
   * is how the two accounts here are already paired — the shape below is the
   * multi-rivalry one either way, so the screen does not change when they land.
   */
  const [other] = await sql<{ id: string; display_name: string }[]>`
    select u.id, u.display_name from users u
     where u.id <> ${me.id}
       and (exists (select 1 from coaching c
                     where (c.coach_id = ${me.id} and c.athlete_id = u.id)
                        or (c.athlete_id = ${me.id} and c.coach_id = u.id)))
     order by u.created_at limit 1
  `;

  if (!other) {
    return NextResponse.json({
      rivalries: [],
      // The client renders the connect prompt off this, rather than an empty
      // scoreboard that implies a contest nobody entered.
      empty: true,
    });
  }

  const thisWeek = mondayOf(today());
  const weeks: {
    week_start: string; winner: Winner;
    mine: ReturnType<typeof shareable>; theirs: ReturnType<typeof shareable>;
  }[] = [];

  for (let i = WEEKS_BACK - 1; i >= 0; i--) {
    const ws = addDays(thisWeek, -7 * i);
    const w = await weekFor(me.id, other.id, ws, isFinalised(ws));
    weeks.push({
      week_start: ws,
      winner: w.winner,
      mine: shareable(w.requester as unknown as Record<string, unknown>),
      theirs: shareable(w.addressee as unknown as Record<string, unknown>),
    });
  }

  const current = await weekFor(me.id, other.id, thisWeek, false);
  const decided = weeks.filter((w) => w.winner !== "undecided");
  const myWeeks = decided.filter((w) => w.winner === "requester").length;
  const theirWeeks = decided.filter((w) => w.winner === "addressee").length;

  return NextResponse.json({
    empty: false,
    rivalries: [{
      id: `${me.id}:${other.id}`,
      rival: { id: other.id, display_name: other.display_name },
      /** null on either side means the rivalry has not started */
      one_sided: !current.requester.has_plan || !current.addressee.has_plan,
      weeks_won: { mine: myWeeks, theirs: theirWeeks },
      consistency: {
        mine: consistency(weeks.map((w) => w.mine as { adherence_pct: number | null })),
        theirs: consistency(weeks.map((w) => w.theirs as { adherence_pct: number | null })),
      },
      /** the four rows the screen compares, relative first, absolute beside */
      rows: [
        row("Plan completed", current.requester.adherence_pct, current.addressee.adherence_pct,
          `${current.requester.sessions_done}/${current.requester.sessions_planned}`,
          `${current.addressee.sessions_done}/${current.addressee.sessions_planned}`),
        row("Volume", current.requester.volume_pct, current.addressee.volume_pct,
          `${current.requester.km_done} km`, `${current.addressee.km_done} km`),
        row("Station work", current.requester.station_pct, current.addressee.station_pct,
          `${current.requester.sessions_done}`, `${current.addressee.sessions_done}`),
      ],
      current: {
        week_start: thisWeek,
        winner: current.winner,
        mine: shareable(current.requester as unknown as Record<string, unknown>),
        theirs: shareable(current.addressee as unknown as Record<string, unknown>),
      },
      history: weeks,
      scoring_note:
        "Every row is your share of your own plan, so a smaller week done properly beats a bigger one half-finished. Weeks settle a day after they close.",
    }],
  });
});

/** One comparison. The percentage decides it; the absolute is context. */
function row(
  label: string, mine: number | null, theirs: number | null,
  mineAbs: string, theirAbs: string,
) {
  return {
    label,
    mine, theirs, mineAbs, theirAbs,
    i_win: mine !== null && theirs !== null && mine > theirs,
    they_win: mine !== null && theirs !== null && theirs > mine,
  };
}
