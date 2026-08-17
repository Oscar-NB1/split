import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { decodePolyline } from "@/lib/analysis";
import { forecast, forecastWeek } from "@/lib/weather";

/**
 * The forecast for a session, where the athlete trains.
 *
 * The location is not asked for. It comes from the start of their most recent
 * recorded run, rounded to two decimal places — about a kilometre, which is the
 * right resolution for weather and the wrong one for finding a house. Nothing is
 * stored: it is derived per request from data the athlete already imported.
 *
 * An athlete with no recorded runs gets `{ forecast: null }` and the screen says
 * nothing rather than guessing a city. Inventing a location would be inventing
 * training data, in the one place an athlete is entitled to expect the app not to.
 */
export const GET = route(async (req: Request) => {
  const me = await requireUser();
  const q = new URL(req.url).searchParams;
  const date = q.get("date");
  const from = q.get("from");
  const to = q.get("to");
  const iso = (v: string | null) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  /*
   * One day for a session, or a range for the week strip.
   *
   * A week as seven calls would be seven round trips to a third party every time
   * somebody opens their week. Open-Meteo takes a range, so this does too.
   */
  if (!iso(date) && !(iso(from) && iso(to))) {
    throw badRequest("Which day? Send date=YYYY-MM-DD, or from= and to= for a week.");
  }

  /*
   * The most recent run with a route, and only the first point of it.
   *
   * Recent rather than most common, because an athlete on a training camp wants the
   * weather where they are. Empty strings are excluded as well as nulls: an indoor
   * activity imports with `summary_polyline: ""`, and treating that as a route meant
   * a treadmill session decided there was nowhere to look up the weather. Rounded before it leaves this function so no code
   * downstream — including the request to Open-Meteo — ever sees a precise start.
   */
  const [row] = await sql<{ polyline: string | null }[]>`
    select raw #>> '{map,summary_polyline}' as polyline
      from activities
     where user_id = ${me.id} and coalesce(raw #>> '{map,summary_polyline}', '') <> ''
     order by local_date desc limit 1
  `;
  if (!row?.polyline) {
    return NextResponse.json({
      forecast: null,
      why: "No recorded route yet, so there is nowhere to look up. Import a run and this fills in.",
    });
  }

  const first = decodePolyline(row.polyline)[0];
  if (!first) return NextResponse.json({ forecast: null, why: "That route had no points in it." });

  const lat = Math.round(first[0] * 100) / 100;
  const lon = Math.round(first[1] * 100) / 100;
  if (from && to) {
    const days = await forecastWeek(lat, lon, from, to);
    return NextResponse.json({ days, source: days.length ? "Open-Meteo" : null });
  }

  const f = await forecast(lat, lon, date!);

  return NextResponse.json({
    forecast: f,
    // said plainly, because a forecast with no stated source is a number to distrust
    source: f ? "Open-Meteo" : null,
    why: f ? null : "The forecast service did not answer. Nothing is wrong with your plan.",
  });
});
