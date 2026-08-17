import { sql } from "./db";
import { classifySegments, statsFor, type LapRow } from "./analysis";
import { prescribedPace, type Signal } from "./signals";
import { blockFor } from "./block-db";
import type { Block } from "./block";

/**
 * The signals the calibration engine reads, and the block they are read against.
 *
 * Lifted out of the Form route so the week screen's card and the Form screen cannot
 * disagree about what a signal is. A signal is one key session: the pace its title
 * prescribed against the pace its WORK laps actually held — never the whole activity,
 * because a session with eight kilometres of warm-up and float averages nothing like
 * its reps.
 */

/** Time trials and races say more about fitness than a tempo does. */
export function weightFor(significance: string | null, title: string): number {
  if (/time trial|benchmark/i.test(title)) return 1.5;
  if (significance === "race") return 1.5;
  if (significance === "benchmark") return 1.3;
  return 1.0;
}

export type Shifted = Block & {
  pace_shift_s: number;
  pace_shift_declined_s: number | null;
};

export type Gathered = {
  signals: Signal[];
  skipped: { title: string; why: string }[];
  block: Shifted | null;
};

export async function signalsFor(userId: string): Promise<Gathered> {
  const block = await blockFor(userId);
  const [shift] = block
    ? await sql<{ pace_shift_s: number; pace_shift_declined_s: number | null }[]>`
        select pace_shift_s, pace_shift_declined_s
          from plan_templates where id = ${block.id}`
    : [];

  const rows = await sql<{
    id: string; title: string; planned_date: string; significance: string | null;
    activity_id: string | null; kind: string;
  }[]>`
    select id, title, planned_date::text as planned_date, significance, activity_id, kind
      from planned_sessions
     where user_id = ${userId}
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

  return {
    signals,
    skipped,
    block: block
      ? {
        ...block,
        pace_shift_s: shift?.pace_shift_s ?? 0,
        pace_shift_declined_s: shift?.pace_shift_declined_s ?? null,
      }
      : null,
  };
}
