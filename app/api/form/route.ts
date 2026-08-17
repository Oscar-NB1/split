import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { read } from "@/lib/signals";
import { signalsFor } from "@/lib/calibration";
import type { PlanWeek } from "@/lib/block";

/**
 * Am I ahead of the plan or behind it?
 *
 * A signal is one milestone session: the pace it prescribed against the pace the
 * work segments actually held. Both halves come from real data —
 *
 *   prescribed: parsed from the session title, which is where the plan states it
 *               ("RACE SESSION · 8 × 1000 m @ 4:15")
 *   achieved:   the time-weighted average of the WORK laps, not the whole
 *               activity. A 12 km session with 8 km of warm-up and float averages
 *               nothing like its reps, and comparing that average to a rep target
 *               would report every interval session as a catastrophic miss.
 *
 * Sessions with no stated pace and sessions with no laps are skipped rather than
 * guessed at — a signal invented from an average is worse than a missing one,
 * because the engine will act on it.
 */

export const GET = route(async () => {
  const me = await requireUser();
  const { signals, skipped, block } = await signalsFor(me.id);

  const verdict = block?.goal_seconds ? read(signals, block.goal_seconds) : null;

  // planned against logged volume, week by week — the other half of "form"
  const logged = await sql<{ wk: string; km: string }[]>`
    select to_char(date_trunc('week', start_time), 'YYYY-MM-DD') as wk,
           round((sum(distance_m)/1000.0)::numeric, 1) as km
      from activities
     where user_id = ${me.id} and sport_type ilike '%run%'
     group by 1 order by 1
  `;
  const loggedBy = Object.fromEntries(logged.map((l) => [l.wk, Number(l.km)]));

  return NextResponse.json({
    verdict,
    goal: block?.goal_seconds ?? null,
    goalLabel: block?.goal_label ?? null,
    has_plan: !!block,
    skipped,
    volume: (block?.weeks ?? []).map((w: PlanWeek) => ({
      n: w.n, start: w.start, planned: w.km, logged: loggedBy[w.start] ?? null, note: w.note,
    })),
    history: logged.map((l) => ({ wk: l.wk, km: Number(l.km) })),
  });
});
