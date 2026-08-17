import { sql } from "./db";
import type { Day, Intake } from "./intake";

/**
 * The reworked form's steps, which live in one jsonb column rather than eleven.
 *
 * They are answers, not relations, and nothing queries across them — so a blob is
 * the honest shape. Read back with a null for anything an older intake never had.
 */
const EXTRA_KEYS = [
  "goal", "goalMin", "startDate", "targetSessions", "allowDoubles",
  "wantRestDay", "longRunDay", "sessionPref", "hyroxExp", "runDelta", "stationDelta",
  "gymAccess",
  // Typed-in race results. The only source of a roxzone in the whole app, so they
  // travel with the answers rather than being derived from anything.
  "pastRaces", "bRaces", "runStationLink",
] as const;

export const extraAnswers = (a: Record<string, unknown> | null) => {
  const out: Record<string, unknown> = {};
  for (const k of EXTRA_KEYS) out[k] = a?.[k] ?? null;
  return out as Pick<Intake, (typeof EXTRA_KEYS)[number]>;
};

/**
 * Reading an athlete's stored intake back as an `Intake`.
 *
 * Lifted out of the intake route because it is not only the intake route's any more:
 * anything that regenerates a plan needs the same answers, and the answers are not in
 * one place — the early steps are columns and the reworked steps are a jsonb blob.
 * Rebuilding a plan from `answers` alone produced a half-populated Intake and an
 * "Invalid time value" from deep inside the generator, because the race date lives
 * in a column.
 *
 * One loader, so a plan regenerated after the athlete moves a session is built from
 * exactly what the intake screen would have sent.
 */

export type Row = Omit<Intake, "hasRace" | "raceDistance" | "raceDate" | "runningSelf"
  | "paceMin" | "paceSec" | "paceUnknown" | "commitDay"
  | "peakWeekKm" | "longestRunKm" | "volumeSource"
  | "goal" | "goalMin" | "startDate" | "targetSessions" | "allowDoubles"
  | "wantRestDay" | "sessionPref" | "hyroxExp" | "runDelta" | "stationDelta"
  | "gymAccess"> & {
  has_race: string; race_distance: string | null; race_date: string | null;
  running_self: string; pace_min: number | null; pace_sec: number | null;
  pace_unknown: boolean; commit_day: Record<string, Day[]>;
  peak_week_km: number | null; longest_run_km: number | null;
  volume_source: string | null; answers: Record<string, unknown> | null;
  completed_at: string;
};

export const toIntake = (r: Row): Intake => ({
  hasRace: r.has_race as Intake["hasRace"],
  discipline: r.discipline,
  raceDistance: r.race_distance as Intake["raceDistance"],
  raceDate: r.race_date,
  role: r.role,
  division: r.division,
  base: r.base,
  runningSelf: r.running_self as Intake["runningSelf"],
  paceMin: r.pace_min, paceSec: r.pace_sec, paceUnknown: r.pace_unknown,
  peakWeekKm: r.peak_week_km, longestRunKm: r.longest_run_km,
  volumeSource: r.volume_source as Intake["volumeSource"],
  // The reworked form's steps live in one jsonb column rather than eleven
  // columns: they are answers, not relations, and nothing queries across them.
  ...(extraAnswers(r.answers)),
  days: r.days, commitments: r.commitments, freq: r.freq, commitDay: r.commit_day,
  commitMode: (r.answers?.commitMode as Intake["commitMode"]) ?? {},
  equipment: r.equipment, sled: r.sled,
  injuries: r.injuries, volume: r.volume, difficulty: r.difficulty,
  benchmark: r.benchmark,
});

export const loadIntakeRow = async (userId: string) => {
  const [row] = await sql<Row[]>`
    select has_race, discipline, race_distance, race_date::text as race_date, role,
           division, base, running_self, pace_min, pace_sec, pace_unknown,
           peak_week_km, longest_run_km, volume_source, answers, answers,
           days, commitments, freq, commit_day, equipment, sled, injuries,
           volume, difficulty, benchmark, completed_at::text as completed_at
      from athlete_intake where user_id = ${userId}
  `;
  return row ?? null;
};

