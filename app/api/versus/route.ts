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
   * Rivalries come from accepted connections — the ones both athletes agreed to.
   * Coaching used to stand in for this while the connection endpoints did not
   * exist; it no longer does, because a coach is not a rival.
   */
  const others = await sql<{
    id: string; display_name: string; avatar_url: string | null; started: string;
  }[]>`
    select u.id, u.display_name, u.avatar_url, r.started_at::text as started
      from connections c
      join rivalries r on r.connection_id = c.id
      join users u on u.id = case when c.requester_id = ${me.id}
                                  then c.addressee_id else c.requester_id end
     where c.status = 'accepted'
       and (c.requester_id = ${me.id} or c.addressee_id = ${me.id})
     order by r.started_at
  `;

  if (others.length === 0) {
    return NextResponse.json({
      rivalries: [],
      // The client renders the connect prompt off this, rather than an empty
      // scoreboard that implies a contest nobody entered.
      empty: true,
    });
  }

  const thisWeek = mondayOf(today());

  /*
   * Every rivalry, every week, in parallel.
   *
   * Twelve weeks each and one query per athlete per week: run in sequence, a
   * second connection doubled the time the screen took to appear. They do not
   * depend on each other, so nothing is gained by waiting.
   */
  const rivalries = await Promise.all(others.map(async (other) => {
    const weeks = await Promise.all(
      Array.from({ length: WEEKS_BACK }, (_, k) => addDays(thisWeek, -7 * (WEEKS_BACK - 1 - k)))
        .map(async (ws) => {
          const w = await weekFor(me.id, other.id, ws, isFinalised(ws));
          return {
            week_start: ws,
            winner: w.winner,
            mine: shareable(w.requester as unknown as Record<string, unknown>),
            theirs: shareable(w.addressee as unknown as Record<string, unknown>),
          };
        }),
    );
    const current = await weekFor(me.id, other.id, thisWeek, false);
    const decided = weeks.filter((w) => w.winner !== "undecided");

    return {
      id: `${me.id}:${other.id}`,
      rival: {
        id: other.id, display_name: other.display_name,
        avatar_url: other.avatar_url,
      },
      since: other.started,
      /** null on either side means the rivalry has not started */
      one_sided: !current.requester.has_plan || !current.addressee.has_plan,
      weeks_won: {
        mine: decided.filter((w) => w.winner === "requester").length,
        theirs: decided.filter((w) => w.winner === "addressee").length,
      },
      consistency: {
        mine: consistency(weeks.map((w) => w.mine as { adherence_pct: number | null })),
        theirs: consistency(weeks.map((w) => w.theirs as { adherence_pct: number | null })),
      },
      /** the rows the screen compares, relative first, absolute beside */
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
    };
  }));

  const [mine] = await sql<{ avatar_url: string | null }[]>`
    select avatar_url from users where id = ${me.id}`;
  // The athlete's own picture travels with the scoreboard: the screen shows both
  // sides of it, and "Y" in a circle is a placeholder for a face we already have.
  return NextResponse.json({
    empty: false,
    me: { id: me.id, display_name: me.display_name, avatar_url: mine?.avatar_url ?? null },
    rivalries,
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
