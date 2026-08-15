import { sql } from "./db";

/**
 * Personal bests.
 *
 * This is where this file departs from the version it was ported from. That one
 * was written when the app held only Strava's activity summary — one average
 * HR, one distance, one duration — and said so:
 *
 *   > "Not there, deliberately: fastest single kilometre, fastest 5K split
 *   >  inside a longer run. Those need lap or stream data… Fetching laps is the
 *   >  next real piece of work."
 *
 * That work is done. There are 2,189 split rows and 2,571 lap rows, so the
 * distance records are computed from actual kilometre splits rather than from a
 * whole-run average. A 4:30/km average over 12 km and a 4:30 fastest kilometre
 * are wildly different claims, and announcing the first as the second would put
 * a wrong personal best in a training log.
 *
 * What is still honestly approximate, and labelled as such: the multi-kilometre
 * records are the best run of *consecutive whole-kilometre splits*, not a true
 * rolling window. A real 5K PR is a second or two quicker.
 */

export type Metric =
  | "best_1km" | "best_5km" | "best_10km"
  | "longest_run_km" | "longest_session_min"
  | "aerobic_pace" | "biggest_week_km";

type Spec = {
  label: string;
  /** true when smaller is better */
  lower: boolean;
  /** how much better before it is worth interrupting someone */
  margin: number;
  format: (v: number) => string;
};

const clock = (sec: number) => {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};
const paceText = (secPerKm: number) => `${clock(secPerKm)}/km`;

export const METRICS: Record<Metric, Spec> = {
  best_1km: { label: "Fastest kilometre", lower: true, margin: 1, format: clock },
  best_5km: { label: "Best 5 km", lower: true, margin: 5, format: clock },
  best_10km: { label: "Best 10 km", lower: true, margin: 10, format: clock },
  longest_run_km: { label: "Longest run", lower: false, margin: 0.3, format: (v) => `${v.toFixed(1)} km` },
  longest_session_min: { label: "Longest session", lower: false, margin: 2, format: (v) => `${Math.round(v)} min` },
  // the plan's own benchmark: "when a long run at HR ~150 returns to 5:00/km,
  // the engine is back". Average HR, so it is a fair reading of a steady run and
  // meaningless for anything with surges in it.
  aerobic_pace: { label: "Best aerobic pace (10 km+ under 155 bpm)", lower: true, margin: 2, format: paceText },
  biggest_week_km: { label: "Biggest week", lower: false, margin: 1, format: (v) => `${v.toFixed(0)} km` },
};

export type NewRecord = { metric: Metric; value: number; previous: number | null };

/** Is this a new best, by enough to be worth saying so? */
export function beats(metric: Metric, value: number, previous: number | null): boolean {
  const spec = METRICS[metric];
  if (previous === null) return true;
  return spec.lower ? value <= previous - spec.margin : value >= previous + spec.margin;
}

/**
 * The best run of N consecutive kilometre splits inside one activity.
 *
 * Partitioned by activity so a window can never span two runs — the sum has to
 * stay inside the session it happened in.
 */
async function bestRun(activityId: string, n: number): Promise<number | null> {
  const [row] = await sql<{ total: number }[]>`
    select total from (
      select sum(moving_seconds) over (
               order by split rows between ${n - 1} preceding and current row) as total,
             count(*) over (
               order by split rows between ${n - 1} preceding and current row) as have
        from activity_splits
       where activity_id = ${activityId} and moving_seconds > 0 and distance_m >= 995
    ) x where have = ${n} order by total asc limit 1
  `;
  return row ? Number(row.total) : null;
}

/**
 * Which records this activity could set. Reads its splits, so it is only
 * meaningful once the detail fetch has run — which is why the webhook saves
 * splits before this is called.
 */
export async function candidates(
  activityId: string,
): Promise<{ metric: Metric; value: number }[]> {
  const [a] = await sql<{
    sport_type: string | null; distance_m: string | null;
    moving_seconds: number | null; avg_hr: string | null;
  }[]>`
    select sport_type, distance_m, moving_seconds, avg_hr from activities where id = ${activityId}
  `;
  if (!a) return [];

  const out: { metric: Metric; value: number }[] = [];
  const minutes = (a.moving_seconds ?? 0) / 60;
  if (minutes > 0) out.push({ metric: "longest_session_min", value: minutes });

  const isRun = /run/i.test(a.sport_type ?? "");
  if (!isRun) return out;

  const km = Number(a.distance_m ?? 0) / 1000;
  if (km > 0) out.push({ metric: "longest_run_km", value: km });

  const [k1, k5, k10] = await Promise.all([bestRun(activityId, 1), bestRun(activityId, 5), bestRun(activityId, 10)]);
  if (k1 != null) out.push({ metric: "best_1km", value: k1 });
  if (k5 != null) out.push({ metric: "best_5km", value: k5 });
  if (k10 != null) out.push({ metric: "best_10km", value: k10 });

  // only counts as aerobic if it was actually run aerobically
  const hr = a.avg_hr == null ? null : Number(a.avg_hr);
  if (km >= 10 && hr != null && hr <= 155 && a.moving_seconds) {
    out.push({ metric: "aerobic_pace", value: a.moving_seconds / km });
  }
  return out;
}

/**
 * Records this activity set.
 *
 * The caller decides whether to announce. `scripts/backfill-strava.ts` runs the
 * same path over years of history, and every one of those is a personal best at
 * the moment it is imported — announcing them would fire hundreds of
 * notifications for runs from 2023. History sets the bar in silence.
 */
export async function recordsFor(userId: string, activityId: string): Promise<NewRecord[]> {
  const set: NewRecord[] = [];
  for (const { metric, value } of await candidates(activityId)) {
    const [row] = await sql<{ value: string }[]>`
      select value from records where user_id = ${userId} and metric = ${metric}
    `;
    const previous = row ? Number(row.value) : null;
    if (!beats(metric, value, previous)) continue;

    await sql`
      insert into records (user_id, metric, value, activity_id, achieved_on, previous)
      select ${userId}, ${metric}, ${value}, ${activityId}, local_date, ${previous}
        from activities where id = ${activityId}
      on conflict (user_id, metric) do update set
        value = excluded.value, activity_id = excluded.activity_id,
        achieved_on = excluded.achieved_on, previous = excluded.previous
    `;
    set.push({ metric, value, previous });
  }
  return set;
}

/** A record not tied to one activity — a week, a streak. */
export async function recordValue(
  userId: string, metric: Metric, value: number, onDate: string,
): Promise<NewRecord | null> {
  const [row] = await sql<{ value: string }[]>`
    select value from records where user_id = ${userId} and metric = ${metric}
  `;
  const previous = row ? Number(row.value) : null;
  if (!beats(metric, value, previous)) return null;
  await sql`
    insert into records (user_id, metric, value, achieved_on, previous)
    values (${userId}, ${metric}, ${value}, ${onDate}, ${previous})
    on conflict (user_id, metric) do update set
      value = excluded.value, achieved_on = excluded.achieved_on, previous = excluded.previous
  `;
  return { metric, value, previous };
}

/** "Best 5 km: 21:40, from 22:05." */
export function describe(r: NewRecord): string {
  const spec = METRICS[r.metric];
  const now = spec.format(r.value);
  return r.previous === null
    ? `${spec.label}: ${now}. First one on the board.`
    : `${spec.label}: ${now}, from ${spec.format(r.previous)}.`;
}
