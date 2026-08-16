import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { canCoach } from "@/lib/coaching";
import { SUMMARY, archetypeOf, type ArchetypeType } from "@/lib/plan/archetype";
import type { Capture, Segment } from "@/lib/plan/capture";

/**
 * The athlete's archetype, and how it got there.
 *
 * Derived on read from the latest benchmark rather than served from the table:
 * the derivation is a pure function of findings that are themselves derived, so
 * storing the answer would only create a second thing to keep in step. The
 * table exists for history — a change of type is the most useful output the
 * feature has, and that needs the previous value.
 */

type Row = {
  id: string; completed_at: string; variant: string; submaximal: boolean;
  aborted: boolean; protocol_version: number; rounds: unknown;
};

type Round = { run_s: number; distance_m?: number; station_s?: number; transition_s?: number };

function toCapture(r: Row, athlete: string): Capture {
  const rounds = (Array.isArray(r.rounds) ? r.rounds : []) as Round[];
  const segments: Segment[] = [];
  let t = 0, i = 1;
  for (const round of rounds) {
    segments.push({ index: i++, type: "run", offset_s: t, duration_s: round.run_s,
      distance_m: round.distance_m, source: "derived_from_laps" });
    t += round.run_s;
    if (round.station_s) {
      segments.push({ index: i++, type: "station", offset_s: t, duration_s: round.station_s,
        source: "derived_from_laps" });
      t += round.station_s;
    }
  }
  return {
    athlete_id: athlete, protocol_version: r.protocol_version, variant: r.variant,
    submaximal: r.submaximal, started_at: r.completed_at, segments,
    hr: { source: "none" }, completion: { aborted: r.aborted },
  };
}

export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const asked = new URL(req.url).searchParams.get("athlete");
  const athlete = !asked || asked === me.id ? me.id : asked;
  if (athlete !== me.id && !(await canCoach(me.id, athlete))) {
    throw badRequest("That is not your athlete.");
  }

  const rows = await sql<Row[]>`
    select id, completed_at::text as completed_at, variant, submaximal, aborted,
           protocol_version, rounds
      from benchmark_results where athlete_id = ${athlete}
     order by completed_at desc limit 2
  `;

  // Never without a benchmark: a self-reported 5 km cannot locate a limiter and
  // intake answers produce neither durability nor pacing. The client renders a
  // take-the-test prompt off this null.
  if (rows.length === 0) return NextResponse.json({ archetype: null });

  const latest = toCapture(rows[0], athlete);
  const previous = rows[1] ? toCapture(rows[1], athlete) : undefined;
  const archetype = archetypeOf(latest, rows[0].id, new Date().toISOString(), previous);
  if (!archetype) return NextResponse.json({ archetype: null });

  // Deliberately unordered and unscored: even_keel is not a goal state, it is a
  // different starting point, and nothing here may imply a ranking.
  const history = await sql<{ type: string; derived_at: string; confidence: string }[]>`
    select type, derived_at::text as derived_at, confidence from archetypes
     where athlete_id = ${athlete} order by derived_at desc limit 10
  `;

  // Recorded only when it differs from the last one, so history is transitions
  // rather than one row per page view.
  if (history[0]?.type !== archetype.type) {
    await sql`
      insert into archetypes (
        athlete_id, type, confidence, derivation_version, source_benchmark_id,
        contributing, dimensions, derived_at
      ) values (
        ${athlete}, ${archetype.type}, ${archetype.confidence},
        ${archetype.derivation_version}, ${archetype.source_benchmark_id},
        ${sql.json(archetype.contributing as never)},
        ${sql.json(archetype.dimensions as never)}, now()
      )
    `;
  }

  return NextResponse.json({
    archetype: { ...archetype, summary: SUMMARY[archetype.type as ArchetypeType] },
    history: history.filter((h) => h.type !== archetype.type),
  });
});
