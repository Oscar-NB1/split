import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { canCoach } from "@/lib/coaching";
import type { Capture, Segment } from "@/lib/plan/capture";
import { changes, read } from "@/lib/plan/findings";

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
  run_s: number; distance_m?: number; station_s?: number;
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

export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const athlete = await athleteOf(req, me.id);
  return NextResponse.json({ attempts: view(await rows(athlete), athlete) });
});

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const athlete = await athleteOf(req, me.id);
  const body = await req.json();
  if (body.action !== "apply") throw badRequest("Nothing to do.");

  const [row] = await sql<{ id: string; applied_at: string | null }[]>`
    select id, applied_at::text as applied_at from benchmark_results
     where id = ${String(body.id)} and athlete_id = ${athlete}
  `;
  if (!row) throw notFound("No such test.");
  // Applying twice is a no-op rather than an error: the button is reachable
  // from a stale screen, and the second tap means the same thing as the first.
  if (!row.applied_at) {
    await sql`update benchmark_results set applied_at = now() where id = ${row.id}`;
  }
  return NextResponse.json({ attempts: view(await rows(athlete), athlete) });
});
