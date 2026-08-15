import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { addDays, mondayOf, today } from "@/lib/dates";
import { challengeScores, METRICS, metricForWeek, streakFor, weekStart } from "@/lib/scoring";

/**
 * The head-to-head, including the weeks-won history.
 *
 * The history is *computed*, not stored. `challenges` holds one row per week and
 * is written as weeks resolve, so it is empty until the block has run — but the
 * result of any past week is derivable: the metric that week rotated to, scored
 * against what both athletes actually did. So the strip shows real results from
 * the first week rather than an empty rail, and it never shows a week that has
 * not happened.
 *
 * Weeks with no training on either side are skipped entirely. A 0–0 "draw" is
 * not a result, it is an absence, and putting it on the rail as a square implies
 * a contest nobody entered.
 */
const WEEKS_BACK = 12;

export const GET = route(async () => {
  const me = await requireUser();
  const [other] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users where id <> ${me.id} order by created_at limit 1
  `;

  const thisWeek = weekStart();
  const history: {
    week: string; metric: string; label: string; mine: number; theirs: number;
    result: "W" | "L" | "D";
  }[] = [];

  for (let i = WEEKS_BACK; i >= 1; i--) {
    const ws = mondayOf(addDays(thisWeek, -7 * i));
    const metric = metricForWeek(ws);
    const scores = await challengeScores(ws, metric);
    const mine = scores.find((s) => s.user_id === me.id)?.score ?? 0;
    const theirs = other ? scores.find((s) => s.user_id === other.id)?.score ?? 0 : 0;
    if (mine === 0 && theirs === 0) continue; // nobody trained: not a result
    history.push({
      week: ws, metric, label: METRICS[metric],
      mine, theirs,
      result: mine > theirs ? "W" : theirs > mine ? "L" : "D",
    });
  }

  // this week, live
  const metric = metricForWeek(thisWeek);
  const live = await challengeScores(thisWeek, metric);
  const end = addDays(thisWeek, 7);

  const totals = async (uid: string) => {
    const [r] = await sql<{ km: string | null; mins: string | null; sessions: number }[]>`
      select sum(a.distance_m)/1000 as km, sum(a.moving_seconds)/60 as mins,
             count(*)::int as sessions
        from activities a
       where a.user_id = ${uid} and a.local_date >= ${thisWeek} and a.local_date < ${end}
    `;
    return { km: Number(r?.km ?? 0), mins: Number(r?.mins ?? 0), sessions: r?.sessions ?? 0 };
  };

  return NextResponse.json({
    me: { id: me.id, name: me.display_name },
    other: other ? { id: other.id, name: other.display_name } : null,
    week: {
      start: thisWeek, metric, label: METRICS[metric],
      mine: live.find((s) => s.user_id === me.id)?.score ?? 0,
      theirs: other ? live.find((s) => s.user_id === other.id)?.score ?? 0 : 0,
    },
    rows: other
      ? [
          { label: "Sessions", mine: (await totals(me.id)).sessions, theirs: (await totals(other.id)).sessions },
          { label: "Distance", suffix: " km", mine: +(await totals(me.id)).km.toFixed(1), theirs: +(await totals(other.id)).km.toFixed(1) },
          { label: "Minutes", mine: Math.round((await totals(me.id)).mins), theirs: Math.round((await totals(other.id)).mins) },
          { label: "Streak", suffix: " wks", mine: await streakFor(me.id), theirs: await streakFor(other.id) },
        ]
      : [],
    history,
    record: {
      won: history.filter((h) => h.result === "W").length,
      lost: history.filter((h) => h.result === "L").length,
      drawn: history.filter((h) => h.result === "D").length,
    },
    today: today(),
  });
});
