import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { canCoach } from "@/lib/coaching";
import { type Capture, type Lap, type Segment, mapLaps } from "@/lib/plan/capture";
import { changes, read } from "@/lib/plan/findings";
import {
  BENCHMARK_NOTE, PROTOCOL_VERSION, ROUNDS, type RecordedRound,
  anchorOf, fadeOf, planLines, protocolFor,
} from "@/lib/plan/benchmark";
import { kitFrom } from "@/lib/plan/strength";
import { loadIntakeRow, toIntake } from "@/lib/intake-store";
import { standardsFor } from "@/lib/intake";
import { anchorFromFiveK, anchorFromRaceSplit } from "@/lib/plan/paces";
import { rememberDay } from "@/lib/replan";

/**
 * Benchmark results, and what they did to the plan.
 *
 * The readings are computed on read rather than stored. A stored reading would
 * freeze an interpretation next to numbers that outlive it: change a band
 * threshold and every past test would still be described by the old one, with
 * nothing in the row to say which version wrote it. The numbers are the record;
 * the reading is derived from them every time.
 */

type Row = {
  id: string; completed_at: string; variant: string; submaximal: boolean;
  aborted: boolean; protocol_version: number; rounds: unknown; hr: unknown;
  plan_before: Record<string, string> | null;
  plan_after: Record<string, string> | null;
  applied_at: string | null;
};

type Round = {
  run_s: number; distance_m?: number; station_s?: number; transition_s?: number;
};

async function athleteOf(req: NextRequest, meId: string) {
  const id = new URL(req.url).searchParams.get("athlete");
  if (!id || id === meId) return meId;
  if (!(await canCoach(meId, id))) throw badRequest("That is not your athlete.");
  return id;
}

const rows = (athlete: string) => sql<Row[]>`
  select id, completed_at::text as completed_at, variant, submaximal, aborted,
         protocol_version, rounds, hr, plan_before, plan_after,
         applied_at::text as applied_at
    from benchmark_results
   where athlete_id = ${athlete}
   order by completed_at asc
`;

/** A stored result, rebuilt into the shape the reading layer works on. */
function toCapture(r: Row, athlete: string): Capture {
  const rounds = (Array.isArray(r.rounds) ? r.rounds : []) as Round[];
  const segments: Segment[] = [];
  let t = 0, i = 1;
  for (const round of rounds) {
    segments.push({ index: i++, type: "run", offset_s: t, duration_s: round.run_s,
      distance_m: round.distance_m, source: "derived_from_laps" });
    t += round.run_s;
    if (round.station_s) {
      segments.push({ index: i++, type: "station", offset_s: t,
        duration_s: round.station_s, source: "derived_from_laps" });
      t += round.station_s;
    }
    if (round.transition_s) {
      segments.push({ index: i++, type: "transition", offset_s: t,
        duration_s: round.transition_s, source: "derived_from_laps" });
      t += round.transition_s;
    }
  }
  return {
    athlete_id: athlete, protocol_version: r.protocol_version, variant: r.variant,
    submaximal: r.submaximal, started_at: r.completed_at, segments,
    hr: (r.hr as Capture["hr"]) ?? { source: "none" },
    completion: { aborted: r.aborted },
  };
}

const view = (all: Row[], athlete: string) =>
  all.map((r, i) => {
    const capture = toCapture(r, athlete);
    const readings = read(capture, i > 0 ? toCapture(all[i - 1], athlete) : undefined);
    return {
      id: r.id, completed_at: r.completed_at, variant: r.variant,
      submaximal: r.submaximal, aborted: r.aborted,
      label: `Test ${i + 1}`,
      rounds: (Array.isArray(r.rounds) ? r.rounds : []) as Round[],
      readings,
      changes: r.plan_after ? changes(r.plan_before ?? {}, r.plan_after, readings) : [],
      applied: r.applied_at !== null,
    };
  });

/**
 * The test they are being asked to do, from their own kit and division.
 *
 * Read from the intake rather than stored on the template: the protocol is a function of
 * what they can reach, and it has to be the same test next time or two results cannot be
 * compared. Null where there is no intake yet — there is nothing to describe.
 */
async function protocolOf(athlete: string) {
  const row = await loadIntakeRow(athlete);
  if (!row) return null;
  const x = toIntake(row);
  const anchor = anchorFromFiveK(fiveK(x)) ?? null;
  return {
    ...protocolFor(kitFrom(x.equipment ?? []), standardsFor(x),
      anchor?.cv_pace_s_per_km ?? 300),
    protocol_version: PROTOCOL_VERSION,
    note: BENCHMARK_NOTE,
  };
}

/** The 5 km time as seconds, for the duration estimate only. */
const fiveK = (x: { paceMin?: number | null; paceSec?: number | null }) =>
  (x.paceMin ? x.paceMin * 60 + (x.paceSec ?? 0) : null);

export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const athlete = await athleteOf(req, me.id);
  return NextResponse.json({
    attempts: view(await rows(athlete), athlete),
    protocol: await protocolOf(athlete),
  });
});

/**
 * Recording a test.
 *
 * Two ways in, because the preflight page promises both: from a recorded activity's laps,
 * and by hand. The hand path is not a fallback — a benchmark done on a gym floor with a
 * stopwatch is a benchmark, and the numbers it produces are the same numbers.
 *
 * Nothing is applied here. The result is stored with what it would do to the plan, and the
 * athlete looks at that before agreeing to it, exactly as with a rebuilt week.
 */
async function record(athlete: string, body: {
  activity_id?: string; rounds?: RecordedRound[];
  submaximal?: boolean; aborted?: boolean; abort_round?: number;
}) {
  let rounds: RecordedRound[] = [];
  let problems: string[] = [];

  if (body.activity_id) {
    /*
     * From the laps, through `mapLaps`, which is where the lap-count and distance checks
     * live. Its problems are returned rather than swallowed: a missed press shifts every
     * later segment and the numbers still look plausible afterwards, so the athlete has to
     * be told rather than have it guessed at.
     */
    const laps = await sql<{
      elapsed_seconds: number; distance_m: number; avg_hr: number | null;
    }[]>`
      select elapsed_seconds, distance_m, avg_hr
        from activity_laps where activity_id = ${body.activity_id}
       order by lap_index
    `;
    if (laps.length === 0) throw badRequest("That activity has no laps recorded against it.");
    const mapped = mapLaps(laps.map((l): Lap => ({
      elapsed_time: Number(l.elapsed_seconds), distance: Number(l.distance_m),
      average_heartrate: l.avg_hr ?? undefined,
    })), 0);
    problems = mapped.problems;
    for (const seg of mapped.segments) {
      if (seg.type === "run") {
        rounds.push({ run_s: Math.round(seg.duration_s), distance_m: seg.distance_m });
      } else if (rounds.length > 0) {
        rounds[rounds.length - 1].station_s = Math.round(seg.duration_s);
      }
    }
  } else if (Array.isArray(body.rounds)) {
    rounds = body.rounds
      .filter((r) => Number.isFinite(r?.run_s) && r.run_s > 30 && r.run_s < 1200)
      .map((r) => ({
        run_s: Math.round(r.run_s),
        ...(Number.isFinite(r.distance_m) ? { distance_m: Math.round(r.distance_m!) } : {}),
        ...(Number.isFinite(r.station_s) ? { station_s: Math.round(r.station_s!) } : {}),
      }))
      .slice(0, ROUNDS);
  } else {
    throw badRequest("Send either an activity to read, or the rounds you timed.");
  }

  /*
   * Two rounds is the floor, and it is the reading layer's floor rather than an arbitrary
   * one: `read()` returns nothing below two runs because fade needs a first and a last.
   */
  if (rounds.length < 2) {
    throw badRequest("A test needs at least two rounds — fade is the whole measurement.");
  }

  const aborted = Boolean(body.aborted) || rounds.length < ROUNDS;
  const anchor = anchorOf(rounds);
  const fade = fadeOf(rounds);

  /*
   * What the plan says now, against what it would say. `plan_before` comes from whatever the
   * plan is currently anchored on — the race split they remembered, or their 5 km — so the
   * diff is between two comparable things rather than between a measurement and a blank.
   */
  const row = await loadIntakeRow(athlete);
  const x = row ? toIntake(row) : null;
  const current = x
    ? anchorFromRaceSplit(null) ?? anchorFromFiveK(fiveK(x))
    : null;
  const plan_before = planLines(current, null);
  const plan_after = planLines(anchor, fade);

  const [saved] = await sql<{ id: string }[]>`
    insert into benchmark_results
      (athlete_id, protocol_version, variant, submaximal, completed_at, rounds, hr,
       aborted, abort_round, plan_before, plan_after)
    values (${athlete}, ${PROTOCOL_VERSION},
            ${String(body.activity_id ? "full" : "manual")},
            ${Boolean(body.submaximal)}, now(),
            ${sql.json(rounds as never)}, ${sql.json({ source: "none" } as never)},
            ${aborted}, ${body.abort_round ?? (aborted ? rounds.length : null)},
            ${sql.json(plan_before as never)}, ${sql.json(plan_after as never)})
    returning id
  `;
  return { id: saved.id, problems };
}

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const athlete = await athleteOf(req, me.id);
  const body = await req.json();

  if (body.action === "record") {
    /* Only your own test. A coach reads an athlete's results; they do not log them. */
    if (athlete !== me.id) throw badRequest("Only the athlete can log their own test.");
    const { id, problems } = await record(athlete, body);
    return NextResponse.json({
      id, problems, attempts: view(await rows(athlete), athlete),
      protocol: await protocolOf(athlete),
    });
  }

  if (body.action !== "apply") throw badRequest("Nothing to do.");

  const [row] = await sql<{ id: string; applied_at: string | null; rounds: unknown }[]>`
    select id, rounds, applied_at::text as applied_at from benchmark_results
     where id = ${String(body.id)} and athlete_id = ${athlete}
  `;
  if (!row) throw notFound("No such test.");
  // Applying twice is a no-op rather than an error: the button is reachable
  // from a stale screen, and the second tap means the same thing as the first.
  if (!row.applied_at) {
    /*
     * "Apply to the block" now applies to the block.
     *
     * It wrote a timestamp and changed nothing — the screen said "only the weeks ahead of
     * you are rewritten" and no week was ever rewritten. The measurement becomes a
     * capability and the plan regenerates from it, which is the same path a measured B-race
     * takes: one way for a number to reach the sessions, not two.
     *
     * `source_ref` scopes it to this test, so a later one supersedes it rather than both
     * being averaged into something neither of them measured.
     */
    const anchor = anchorOf((Array.isArray(row.rounds) ? row.rounds : []) as RecordedRound[]);
    if (anchor) {
      /*
       * Replaced rather than upserted: the table has no unique key on the source, and a
       * second apply of the same test must not leave two rows claiming the same thing.
       *
       * `source_ref` is the test's own id — the column is a uuid, and `source` is what says
       * which kind of thing it points at. A prefixed string reads better and does not fit.
       */
      await sql`
        delete from capabilities
         where athlete_id = ${athlete} and source = 'benchmark' and source_ref = ${row.id}
      `;
      await sql`
        insert into capabilities (athlete_id, field, value, source, source_ref, captured_at)
        values (${athlete}, 'run_pace_s_per_km', ${anchor.race_pace_s_per_km},
                'benchmark', ${row.id}, now())
      `;
    }
    await sql`update benchmark_results set applied_at = now() where id = ${row.id}`;
    /* Future weeks only, and never a session already logged against — materialise's guard. */
    if (anchor) await rememberDay(athlete);
  }
  return NextResponse.json({
    attempts: view(await rows(athlete), athlete),
    protocol: await protocolOf(athlete),
  });
});
