import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { classifySegments, statsFor, type LapRow } from "@/lib/analysis";
import { read, type Signal } from "@/lib/signals";
import { GOAL, WEEKS } from "@/lib/coach";

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

/** "8 × 1000 m @ 4:15" → 255 seconds per kilometre. */
export function prescribedPace(title: string): number | null {
  const m = title.match(/@\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Time trials and races say more about fitness than a tempo does. */
function weightFor(significance: string | null, title: string): number {
  if (/time trial|benchmark/i.test(title)) return 1.5;
  if (significance === "race") return 1.5;
  if (significance === "benchmark") return 1.3;
  return 1.0;
}

const GOAL_SECONDS = 56 * 60 + 30; // the slow end of the stated 55:00–56:30

export const GET = route(async () => {
  const me = await requireUser();

  const rows = await sql<{
    id: string; title: string; planned_date: string; significance: string | null;
    activity_id: string | null; kind: string;
  }[]>`
    select id, title, planned_date::text as planned_date, significance, activity_id, kind
      from planned_sessions
     where user_id = ${me.id}
       and status in ('done', 'adjusted')
       and activity_id is not null
       and (significance = any(array['key','benchmark','race']) or kind = 'run_intervals')
     order by planned_date
  `;

  const signals: Signal[] = [];
  const skipped: { title: string; why: string }[] = [];

  for (const r of rows) {
    const prescribed = prescribedPace(r.title);
    if (prescribed == null) {
      skipped.push({ title: r.title, why: "no pace stated in the title" });
      continue;
    }
    const laps = await sql<LapRow[]>`
      select lap_index, name, distance_m, moving_seconds, elapsed_seconds,
             avg_speed_ms, max_speed_ms, avg_hr, max_hr
        from activity_laps where activity_id = ${r.activity_id} order by lap_index
    `;
    if (laps.length === 0) {
      skipped.push({ title: r.title, why: "no laps imported" });
      continue;
    }
    const n = (v: unknown) => (v == null ? null : Number(v));
    const { segments } = classifySegments(laps.map((l) => ({
      ...l,
      distance_m: n(l.distance_m), moving_seconds: n(l.moving_seconds),
      elapsed_seconds: n(l.elapsed_seconds), avg_speed_ms: n(l.avg_speed_ms),
      max_speed_ms: n(l.max_speed_ms), avg_hr: n(l.avg_hr), max_hr: n(l.max_hr),
    })));
    const work = statsFor(segments, ["work"]);
    // fall back to the whole session only when there is no interval structure at
    // all — a steady tempo is legitimately its own average
    const stats = work.count > 0 ? work : statsFor(segments, ["steady"]);
    if (!stats.avg_speed_ms || stats.avg_speed_ms <= 0) {
      skipped.push({ title: r.title, why: "no usable pace in the laps" });
      continue;
    }
    signals.push({
      on: r.planned_date,
      label: r.title,
      type: r.significance === "benchmark" ? "Benchmark" : r.significance === "race" ? "Race" : "Interval",
      weight: weightFor(r.significance, r.title),
      prescribed,
      achieved: 1000 / stats.avg_speed_ms,
    });
  }

  const verdict = read(signals, GOAL_SECONDS);

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
    goal: GOAL_SECONDS,
    goalLabel: GOAL,
    skipped,
    volume: WEEKS.map((w) => ({
      n: w.n, start: w.start, planned: w.km, logged: loggedBy[w.start] ?? null, note: w.note,
    })),
    history: logged.map((l) => ({ wk: l.wk, km: Number(l.km) })),
  });
});
