import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { notFound, route } from "@/lib/http";
import { mmss } from "@/lib/race/plan";
import { STATIONS, loadPlan, prefilled, projectionOf, weekFor } from "@/lib/race/store";
import { zonesFor } from "@/lib/coach";

/**
 * Race day, read-only.
 *
 * Everything precomputed and nothing derived on the phone: this is read in a loud
 * venue with no signal, between a sled and a queue. No edits, no writes, and a
 * cache header long enough that opening it twice costs nothing.
 */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;

  const [race] = await sql<{
    race_date: string; name: string | null; discipline: string | null;
    venue: string | null; start_time: string | null; wave: string | null;
  }[]>`
    select race_date::text as race_date, name, discipline, venue, start_time, wave
      from race_targets where id = ${id} and athlete_id = ${me.id}
  `;
  if (!race) throw notFound("No such race.");

  const stored = await loadPlan(me.id, id);
  if (!stored) return NextResponse.json({ plan: null, race });

  const projection = projectionOf(stored.plan, (await prefilled(me.id, id)).capability);
  const [{ hr_max }] = await sql<{ hr_max: number | null }[]>`
    select hr_max from users where id = ${me.id}
  `;
  const zones = zonesFor(hr_max);
  const doubles = (race.discipline ?? "").includes("doubles");
  const week = await weekFor(me.id, id, doubles);

  const body = {
    race: { ...race, doubles },
    /** the three numbers worth holding in your head */
    pacing: [
      { label: "Runs 1–4", hr: zones[2]?.label ?? "", pace: `${mmss(stored.plan.runs[0].target_pace_s_per_km)} /km` },
      { label: "Runs 5–8", hr: zones[3]?.label ?? "", pace: `${mmss(stored.plan.runs[4]?.target_pace_s_per_km ?? stored.plan.runs[0].target_pace_s_per_km)} /km` },
      { label: "Roxzone", hr: "moving", pace: `${stored.plan.roxzone.per_transition_s} s each` },
    ],
    splits: stored.plan.stations.map((s) => {
      const name = STATIONS.find((x) => x.id === s.station_id)?.name ?? s.station_id;
      return {
        name,
        mine: mmss(s.target_time_s * s.my_share),
        theirs: doubles ? mmss(s.target_time_s * (1 - s.my_share)) : null,
      };
    }),
    cumulative: [
      ...projection.cumulative.map((c) => ({ label: `After ${c.name}`, time: mmss(c.at_s) })),
      { label: "Finish", time: mmss(projection.projected_total_s) },
    ],
    projected: mmss(projection.projected_total_s),
    target: stored.plan.target_total_s ? mmss(stored.plan.target_total_s) : null,
    /*
     * The one instruction worth having pre-written. Mid-race is the worst moment
     * to work out whether to chase a lost minute, and the answer is almost
     * always no — so it is decided here, in advance, calmly.
     */
    behind: {
      title: "If you are behind at halfway",
      body: "Hold the pace you planned. A minute lost over the first four runs cannot be taken back over the last four, and trying is how the wall balls become a walk.",
    },
    checklist_remaining: (week?.checklist ?? []).filter((c) => !c.done).map((c) => c.label),
    offline_note: "This screen works with no signal. Nothing here needs the network.",
  };

  return NextResponse.json(body, {
    headers: {
      // Private, because it is one athlete's plan; long, because it does not
      // change on race day and the venue will have no signal.
      "cache-control": "private, max-age=3600, stale-while-revalidate=86400",
    },
  });
});
