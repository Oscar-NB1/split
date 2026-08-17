import { sql } from "../db";

/**
 * What the races in this block have measured about the athlete.
 *
 * The intake's past-race step is what somebody remembered when they signed up. A
 * B-race they have since run is the same measurement taken later, by the app, with
 * a usability verdict attached — and it describes them as they are now rather than
 * as they were before the block began.
 *
 * Only fields the verdict passed are returned. A pair who ran at the slower
 * partner's pace did not measure this athlete's running, and a result stored with
 * `run_paces: "distorted"` must not reach the anchor however recent it is.
 */

export type Measured = {
  /** average run split, seconds per km, from the most recent usable result */
  run_split_s: number | null;
  /** per-transition roxzone, seconds — a B-race is the only in-plan source */
  roxzone_s: number | null;
  station_total_s: number | null;
  /** the race it came from, for saying so on the screen */
  from: { race_date: string; venue: string | null } | null;
};

const EMPTY: Measured = {
  run_split_s: null, roxzone_s: null, station_total_s: null, from: null,
};

type Row = {
  race_date: string; venue: string | null;
  run_avg_s: number | null; rox_s: number | null; stations_s: number | null;
  field_usability: { run_paces?: string; roxzone?: string; station_times?: string } | null;
};

export async function measuredFor(athleteId: string): Promise<Measured> {
  /*
   * Newest first, and each field taken from the newest result that measured it.
   *
   * Not all from one race: an athlete may have raced a doubles in July where their
   * partner set the pace — usable roxzone, distorted run — and a singles in
   * September that measured everything. Taking the newest *usable* value per field
   * uses both for what each is good for, rather than discarding a whole race
   * because one of its three fields was compromised.
   */
  const rows = await sql<Row[]>`
    select t.race_date::text as race_date, t.venue,
           r.run_avg_s, r.rox_s, r.stations_s, r.field_usability
      from race_results r
      join race_targets t on t.id = r.race_id
     where r.athlete_id = ${athleteId}
     order by t.race_date desc
  `;
  if (rows.length === 0) return EMPTY;

  const out: Measured = { ...EMPTY };
  for (const r of rows) {
    const u = r.field_usability ?? {};
    if (out.run_split_s === null && r.run_avg_s && u.run_paces !== "distorted") {
      out.run_split_s = r.run_avg_s;
      out.from = { race_date: r.race_date, venue: r.venue };
    }
    if (out.roxzone_s === null && r.rox_s && u.roxzone !== "distorted") {
      out.roxzone_s = r.rox_s;
      out.from ??= { race_date: r.race_date, venue: r.venue };
    }
    if (out.station_total_s === null && r.stations_s && u.station_times !== "distorted") {
      out.station_total_s = r.stations_s;
      out.from ??= { race_date: r.race_date, venue: r.venue };
    }
  }
  return out;
}
