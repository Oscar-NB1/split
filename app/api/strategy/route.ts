import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { blockFor } from "@/lib/block-db";
import { intervalsConnected, pushRacePlan } from "@/lib/intervals";
import {
  type Segment,
  raceWorkoutText, sanitise, sanitiseRox, seedFor, totals,
} from "@/lib/strategy";
import { decodePolyline } from "@/lib/analysis";
import { forecast } from "@/lib/weather";

/**
 * The race plan: read it, save it, send it to the watch.
 *
 * Everything here is keyed on the race date rather than on a row id, so the plan
 * is a property of the race and not of a particular editing session.
 */

type Row = {
  segments: Segment[]; rox_seconds: number;
  event_id: string | null; exported_at: string | null;
};

const load = (userId: string, date: string) => sql<Row[]>`
  select segments, rox_seconds, event_id, exported_at::text as exported_at
    from race_plans where user_id = ${userId} and race_date = ${date}
`;

/**
 * The race the plan is aimed at, or a 400.
 *
 * There is no app-wide race date any more — it belongs to the athlete's block, so
 * an athlete without one has no race to plan for and must be told that rather
 * than shown the other athlete's.
 */
async function raceDateFor(userId: string): Promise<string> {
  return (await raceFor(userId)).date;
}

/**
 * The race, and everything the starting plan is derived from.
 *
 * The seed used to be a constant: one athlete's 56:30, with notes about which
 * station they were strongest at. Sarah opening this screen with a ninety-minute
 * goal was shown a stranger's race. The shape of a Hyrox is the event's, so that
 * stays; the total, the split and the notes are hers.
 */
async function raceFor(userId: string) {
  const block = await blockFor(userId);
  if (!block?.race_date) {
    throw badRequest("There is no race on your plan yet, so there is nothing to build a strategy for.");
  }
  const [intake] = await sql<{ discipline: string | null; role: string | null }[]>`
    select discipline, role from athlete_intake where user_id = ${userId}
  `;
  return {
    date: block.race_date,
    goal_seconds: block.goal_seconds ?? null,
    doubles: /doubles/i.test(intake?.discipline ?? "Hyrox doubles"),
    /*
     * The training role, translated.
     *
     * The intake stores it in the athlete's own words — Protected, Engine, Even
     * split — and the seed wants to know which half of the race is the limiter. An
     * athlete whose partner protects them on the stations is the one whose finish
     * time is decided by their running.
     */
    role: /engine/i.test(intake?.role ?? "") ? "station_carrier" as const
      : /protect/i.test(intake?.role ?? "") ? "run_limiter" as const
      : "balanced" as const,
  };
}

/**
 * What race day is usually like, where it can be known.
 *
 * A race four months out has no forecast, and that is exactly when the answer
 * matters: 24°C changes a pacing plan, and it changes it before the plan is
 * written rather than on the morning. Beyond the forecast horizon this is the same
 * calendar day averaged over recent years, and it says so.
 */
async function conditionsFor(userId: string, date: string) {
  const [place] = await sql<{ polyline: string | null }[]>`
    select raw #>> '{map,summary_polyline}' as polyline
      from activities
     where user_id = ${userId} and coalesce(raw #>> '{map,summary_polyline}', '') <> ''
     order by local_date desc limit 1
  `;
  if (!place?.polyline) return null;
  const at = decodePolyline(place.polyline)[0];
  if (!at) return null;
  return forecast(Math.round(at[0] * 100) / 100, Math.round(at[1] * 100) / 100, date);
}

export const GET = route(async () => {
  const me = await requireUser();
  const race = await raceFor(me.id);
  const [row] = await load(me.id, race.date);
  // an athlete who has never opened the screen gets a plan built from their own
  // goal, marked as such so the UI can say the numbers are not yet theirs
  const seed = seedFor(race);
  const segments = row ? sanitise(row.segments) : seed.segments;
  const rox = row ? row.rox_seconds : seed.rox_seconds;
  const conditions = await conditionsFor(me.id, race.date);
  return NextResponse.json({
    race_date: race.date,
    segments,
    rox_seconds: rox,
    saved: !!row,
    /** the goal the seed was built from, so the screen can say where it came from */
    goal_seconds: race.goal_seconds,
    doubles: race.doubles,
    conditions,
    exported_at: row?.exported_at ?? null,
    intervals_connected: await intervalsConnected(me.id),
    ...totals(segments, rox),
  });
});

export const PUT = route(async (req: NextRequest) => {
  const me = await requireUser();
  const raceDate = await raceDateFor(me.id);
  const body = await req.json();
  const segments = sanitise(body.segments);
  const rox = sanitiseRox(body.rox_seconds);
  await sql`
    insert into race_plans (user_id, race_date, segments, rox_seconds, updated_at)
    values (${me.id}, ${raceDate}, ${sql.json(segments as never)}, ${rox}, now())
    on conflict (user_id, race_date) do update set
      segments = excluded.segments, rox_seconds = excluded.rox_seconds, updated_at = now()
  `;
  return NextResponse.json({ ok: true, ...totals(segments, rox) });
});

/**
 * Send it to the watch, via intervals.icu — Garmin's own Training API is
 * business-only, so this is the same bridge the weekly sessions already use.
 *
 * The response says what actually happened. The button this replaces set a
 * boolean and claimed "Sent to Garmin Forerunner 255" whether or not anything
 * had been sent, and intervals.icu is not even connected for this athlete yet.
 */
export const POST = route(async () => {
  const me = await requireUser();
  const raceDate = await raceDateFor(me.id);
  const [row] = await load(me.id, raceDate);
  const seed = seedFor(await raceFor(me.id));
  const segments = row ? sanitise(row.segments) : seed.segments;
  const rox = row ? row.rox_seconds : seed.rox_seconds;

  if (!(await intervalsConnected(me.id))) {
    throw badRequest(
      "intervals.icu is not connected. Add its athlete ID and API key under " +
      "Profile → Manage connections — it is the bridge that puts a workout on the Garmin.",
    );
  }

  const eventId = await pushRacePlan(me.id, {
    date: raceDate,
    // Named for the race they are actually doing, not for one of the two formats.
    name: `RACE · Hyrox ${(await raceFor(me.id)).doubles ? "Doubles" : "Singles"}`,
    body: raceWorkoutText(segments, rox),
    eventId: row?.event_id ?? null,
  });

  // the plan is written on export too, so sending an untouched plan stores the
  // numbers that were actually sent rather than leaving no record of them
  await sql`
    insert into race_plans (user_id, race_date, segments, rox_seconds, event_id, exported_at, updated_at)
    values (${me.id}, ${raceDate}, ${sql.json(segments as never)}, ${rox}, ${eventId}, now(), now())
    on conflict (user_id, race_date) do update set
      segments = excluded.segments, rox_seconds = excluded.rox_seconds,
      event_id = excluded.event_id, exported_at = now(), updated_at = now()
  `;
  return NextResponse.json({ ok: true, event_id: eventId });
});
