import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { RACE_DATE } from "@/lib/coach";
import { intervalsConnected, pushRacePlan } from "@/lib/intervals";
import {
  DEFAULT_ROX, SEED, type Segment,
  raceWorkoutText, sanitise, sanitiseRox, totals,
} from "@/lib/strategy";

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

export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await load(me.id, RACE_DATE);
  // an athlete who has never opened the screen gets the plan's own numbers,
  // marked as such so the UI can say the plan is not yet theirs
  const segments = row ? sanitise(row.segments) : SEED;
  const rox = row ? row.rox_seconds : DEFAULT_ROX;
  return NextResponse.json({
    race_date: RACE_DATE,
    segments,
    rox_seconds: rox,
    saved: !!row,
    exported_at: row?.exported_at ?? null,
    intervals_connected: await intervalsConnected(me.id),
    ...totals(segments, rox),
  });
});

export const PUT = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json();
  const segments = sanitise(body.segments);
  const rox = sanitiseRox(body.rox_seconds);
  await sql`
    insert into race_plans (user_id, race_date, segments, rox_seconds, updated_at)
    values (${me.id}, ${RACE_DATE}, ${sql.json(segments as never)}, ${rox}, now())
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
  const [row] = await load(me.id, RACE_DATE);
  const segments = row ? sanitise(row.segments) : SEED;
  const rox = row ? row.rox_seconds : DEFAULT_ROX;

  if (!(await intervalsConnected(me.id))) {
    throw badRequest(
      "intervals.icu is not connected. Add its athlete ID and API key under " +
      "Profile → Manage connections — it is the bridge that puts a workout on the Garmin.",
    );
  }

  const eventId = await pushRacePlan(me.id, {
    date: RACE_DATE,
    name: "RACE · Hyrox Doubles",
    body: raceWorkoutText(segments, rox),
    eventId: row?.event_id ?? null,
  });

  // the plan is written on export too, so sending an untouched plan stores the
  // numbers that were actually sent rather than leaving no record of them
  await sql`
    insert into race_plans (user_id, race_date, segments, rox_seconds, event_id, exported_at, updated_at)
    values (${me.id}, ${RACE_DATE}, ${sql.json(segments as never)}, ${rox}, ${eventId}, now(), now())
    on conflict (user_id, race_date) do update set
      segments = excluded.segments, rox_seconds = excluded.rox_seconds,
      event_id = excluded.event_id, exported_at = now(), updated_at = now()
  `;
  return NextResponse.json({ ok: true, event_id: eventId });
});
