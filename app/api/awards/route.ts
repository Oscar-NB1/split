import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";

/**
 * Career totals, personal records and medal tiers — all computed from stored
 * activity data, never seeded.
 *
 * A note on what the records honestly are. A true 5K PR needs a rolling window
 * over the distance stream; what this returns is the best run of consecutive
 * whole-kilometre splits, which is a different (slightly slower) number. The UI
 * labels it as exactly that rather than calling it a 5K time, because an
 * inflated PR in a training log is worse than no PR.
 */

const TIERS = ["Bronze", "Silver", "Gold", "Platinum"] as const;

/**
 * Each activity contributes at most six hours to a career total.
 *
 * The records logic already refuses a 19-hour "session" as a personal best — a
 * watch left running — but the career total was still adding all of it, which
 * overstated lifetime hours by about 4%. Clamped rather than excluded: the
 * session did happen, it is only its duration that cannot be trusted.
 */
const MAX_SESSION_SECONDS = 6 * 3600;

/**
 * The same bound lib/records.ts uses, and it has to be here too.
 *
 * That file rejects a split faster than this as a GPS jump. This route runs its
 * own queries against the same rows, and without the bound the Awards screen
 * happily showed "0:15" as a fastest kilometre — the identical defect, in a
 * second place, because the rule lived next to one query instead of next to the
 * data. 7 m/s over a kilometre is 2:23, already faster than any amateur.
 */
const MAX_SPEED_MS = 7.0;

type MedalDef = {
  cat: string; unit: string; steps: number[]; invert?: boolean; icon: string;
};
const MEDALS: MedalDef[] = [
  { cat: "Lifetime distance", unit: "km", steps: [1000, 2500, 5000, 10000], icon: "◎" },
  { cat: "Single longest run", unit: "km", steps: [15, 21.1, 30, 42.2], icon: "↗" },
  { cat: "Biggest week", unit: "km", steps: [30, 45, 60, 80], icon: "▤" },
  { cat: "Hyrox races", unit: "finishes", steps: [1, 3, 5, 10], icon: "⬢" },
  { cat: "Sessions logged", unit: "sessions", steps: [100, 250, 500, 1000], icon: "◆" },
  { cat: "Hours moving", unit: "hours", steps: [50, 150, 300, 600], icon: "⬤" },
];

function tierOf(m: MedalDef, value: number) {
  const hit = (t: number) => (m.invert ? value <= t : value >= t);
  let idx = -1;
  m.steps.forEach((t, i) => { if (hit(t)) idx = i; });
  const next = m.steps[idx + 1];
  const prev = idx >= 0 ? m.steps[idx] : 0;
  const pct = next === undefined ? 100
    : Math.max(4, Math.min(100, Math.abs((value - prev) / (next - prev)) * 100));
  return { tier: idx, tierName: idx >= 0 ? TIERS[idx] : null, next, pct };
}

/**
 * When each medal tier was crossed.
 *
 * Walked forward through the history rather than stamped with today's date: a
 * Gold earned in February is a different fact from one earned this morning, and
 * the design's medal card shows the date. Cumulative categories (distance,
 * sessions, hours) accumulate; single-effort ones (longest run, biggest week)
 * take the day the best effort happened.
 */
async function earnedDates(userId: string, defs: MedalDef[]) {
  const acts = await sql<{
    local_date: string; distance_m: string | null; moving_seconds: number | null;
  }[]>`
    select local_date::text as local_date, distance_m,
           least(moving_seconds, ${MAX_SESSION_SECONDS}) as moving_seconds
      from activities where user_id = ${userId} order by start_time asc
  `;
  const weekly = await sql<{ wk: string; km: string }[]>`
    select to_char(date_trunc('week', start_time), 'YYYY-MM-DD') as wk,
           sum(distance_m)/1000 as km
      from activities where user_id = ${userId} group by 1 order by 1
  `;

  // running totals, in the order the activities actually happened
  let km = 0, sessions = 0, hours = 0, longest = 0, biggestWeek = 0;
  const crossed = new Map<string, string>(); // "cat|tierIndex" -> date

  const mark = (cat: string, value: number, date: string) => {
    const def = defs.find((d) => d.cat === cat);
    if (!def) return;
    def.steps.forEach((t, i) => {
      const key = `${cat}|${i}`;
      if (!crossed.has(key) && value >= t) crossed.set(key, date);
    });
  };

  for (const a of acts) {
    km += Number(a.distance_m ?? 0) / 1000;
    sessions += 1;
    hours += Math.min(a.moving_seconds ?? 0, MAX_SESSION_SECONDS) / 3600;
    longest = Math.max(longest, Number(a.distance_m ?? 0) / 1000);
    mark("Lifetime distance", km, a.local_date);
    mark("Sessions logged", sessions, a.local_date);
    mark("Hours moving", hours, a.local_date);
    mark("Single longest run", longest, a.local_date);
  }
  for (const w of weekly) {
    biggestWeek = Math.max(biggestWeek, Number(w.km));
    mark("Biggest week", biggestWeek, w.wk);
  }
  return crossed;
}

export const GET = route(async () => {
  const me = await requireUser();

  const [totals] = await sql<{
    km: string; sessions: number; seconds: string; longest: string; first: string | null;
  }[]>`
    select coalesce(sum(distance_m),0)/1000 as km,
           count(*)::int as sessions,
           coalesce(sum(least(moving_seconds, ${MAX_SESSION_SECONDS})),0) as seconds,
           coalesce(max(distance_m),0)/1000 as longest,
           min(local_date)::text as first
      from activities where user_id = ${me.id}
  `;

  const [{ best_week }] = await sql<{ best_week: string }[]>`
    select coalesce(max(km),0) as best_week from (
      select sum(distance_m)/1000 as km
        from activities where user_id = ${me.id}
       group by date_trunc('week', start_time)
    ) w
  `;

  const [{ races }] = await sql<{ races: number }[]>`
    select count(*)::int as races from races where user_id = ${me.id}
  `;

  // Best single kilometre, straight off the split rows.
  const kmBest = await sql<{ seconds: number; id: string; name: string; local_date: string }[]>`
    select s.moving_seconds as seconds, a.id, a.name, a.local_date::text as local_date
      from activity_splits s join activities a on a.id = s.activity_id
     where a.user_id = ${me.id} and s.moving_seconds > 0 and s.distance_m >= 995
       and s.distance_m / s.moving_seconds <= ${MAX_SPEED_MS}
     order by s.moving_seconds asc limit 5
  `;

  // Best run of N consecutive kilometre splits inside one activity. Window
  // functions rather than a scan: the sum has to stay inside a single activity,
  // and the partition is what enforces that.
  const runOf = (n: number) => sql<{ seconds: number; id: string; name: string; local_date: string }[]>`
    select total as seconds, id, name, local_date from (
      select sum(s.moving_seconds) over (
               partition by s.activity_id order by s.split
               rows between ${n - 1} preceding and current row
             ) as total,
             count(*) over (
               partition by s.activity_id order by s.split
               rows between ${n - 1} preceding and current row
             ) as have,
             a.id, a.name, a.local_date::text as local_date
        from activity_splits s join activities a on a.id = s.activity_id
       where a.user_id = ${me.id} and s.moving_seconds > 0 and s.distance_m >= 995
         and s.distance_m / s.moving_seconds <= ${MAX_SPEED_MS}
    ) x where have = ${n} order by total asc limit 5
  `;

  const [k5, k10, k21] = await Promise.all([runOf(5), runOf(10), runOf(21)]);

  const value: Record<string, number> = {
    "Lifetime distance": Number(totals.km),
    "Single longest run": Number(totals.longest),
    "Biggest week": Number(best_week),
    "Hyrox races": races,
    "Sessions logged": totals.sessions,
    "Hours moving": Number(totals.seconds) / 3600,
  };

  const crossed = await earnedDates(me.id, MEDALS);

  return NextResponse.json({
    totals: {
      km: Number(totals.km), sessions: totals.sessions,
      hours: Number(totals.seconds) / 3600, races, since: totals.first,
    },
    medals: MEDALS.map((m) => {
      const t = tierOf(m, value[m.cat] ?? 0);
      return {
        ...m, value: value[m.cat] ?? 0, ...t,
        earned_on: t.tier >= 0 ? crossed.get(`${m.cat}|${t.tier}`) ?? null : null,
        tally: m.steps.map((_, i) => crossed.get(`${m.cat}|${i}`) ?? null),
      };
    }),
    records: [
      { dist: "1 km", note: "fastest single kilometre split", rows: kmBest },
      { dist: "5 km", note: "best 5 consecutive kilometre splits", rows: k5 },
      { dist: "10 km", note: "best 10 consecutive kilometre splits", rows: k10 },
      { dist: "Half", note: "best 21 consecutive kilometre splits", rows: k21 },
    ].filter((r) => r.rows.length > 0),
  });
});
