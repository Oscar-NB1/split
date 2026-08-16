import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { materialise } from "@/lib/templates";
import {
  BASE, BENCH_VARIANTS, COMMITMENT, COMMITMENTS, DAYS, DIFFICULTY, DISCIPLINE,
  DIVISION_DOUBLES, DIVISION_SOLO, EQUIPMENT, EQUIPMENT_RUNNING, HAS_RACE,
  RACE_DISTANCE, ROLE, RUNNING_SELF, RUN_CEIL, SLED, VOLUME_PREF,
  type Day, type Intake, liveQuestions, validate,
} from "@/lib/intake";
import { generate as legacyGenerate, resolve } from "@/lib/generate";
import { generate as buildPlan } from "@/lib/plan/generate";
import { paramsFrom } from "@/lib/plan/from-intake";
import { toTemplate } from "@/lib/plan/to-template";
import { recentFor } from "@/lib/recent";
import { checkIntent, intentLocked, type Intent } from "@/lib/race/brace";
import { today } from "@/lib/dates";

/**
 * The intake: what the athlete says about themselves, and the block it builds.
 *
 * Three endpoints rather than one, because the design's flow has three moments:
 * answering the questions, seeing the scaffold and the benchmark offer, and
 * generating. Submitting writes the answers, the plan derived from them, and the
 * first weeks of sessions in one go — a form that stores answers and produces
 * nothing visible is indistinguishable from a form that did nothing.
 */

type Row = Omit<Intake, "hasRace" | "raceDistance" | "raceDate" | "runningSelf"
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

const toIntake = (r: Row): Intake => ({
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

const load = async (userId: string) => {
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

/**
 * The option lists, served rather than hard-coded in the screens.
 *
 * Adding an option here is the only change needed to offer it, and the branching
 * rules come from the same place the validator reads — so the form can never ask
 * a question the validator does not expect, or skip one it demands.
 */
const OPTIONS = {
  hasRace: HAS_RACE,
  discipline: DISCIPLINE,
  raceDistance: RACE_DISTANCE,
  role: ROLE,
  division: { solo: DIVISION_SOLO, doubles: DIVISION_DOUBLES },
  base: BASE,
  runningSelf: RUNNING_SELF,
  runningCeilings: RUN_CEIL,
  days: DAYS,
  commitments: COMMITMENTS,
  commitmentEffects: COMMITMENT,
  equipment: { default: EQUIPMENT, running: EQUIPMENT_RUNNING },
  sled: SLED,
  volume: VOLUME_PREF,
  difficulty: DIFFICULTY,
  benchVariants: BENCH_VARIANTS,
};

export const GET = route(async () => {
  const me = await requireUser();
  const row = await load(me.id);
  const [plan] = await sql<{ id: string; name: string; plan_state: string | null }[]>`
    select id, name, plan_state from plan_templates
     where athlete_id = ${me.id} and active limit 1
  `;
  return NextResponse.json({
    intake: row,
    plan: plan ?? null,
    options: OPTIONS,
    questions: row
      ? liveQuestions({ discipline: row.discipline, hasRace: row.has_race as Intake["hasRace"] })
      : null,
  });
});

/** Read a submitted form into the shape the generator takes. Nothing is guessed. */
function parse(body: Record<string, unknown>): Intake {
  const int = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const str = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
  };
  /**
   * A distance in kilometres, or nothing.
   *
   * Zero and blank both mean "I do not track this" rather than "I ran none",
   * and are stored as null so the generator falls back to the matrix instead of
   * building a block around a zero.
   */
  const km = (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(Math.min(n, 400) * 10) / 10;
  };
  const list = <T,>(v: unknown, allowed: readonly T[]): T[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is T => allowed.includes(x as T)))] : [];

  /*
   * Known chips plus anything the athlete typed.
   *
   * This allowlisted against COMMITMENTS, so a commitment named on the step —
   * jiu-jitsu, netball, whatever — was accepted by the screen and dropped here.
   * Silently, which is the worst version: the plan was then built as though the
   * athlete had nothing on that day. Sanitised rather than rejected, because the
   * name is only ever displayed and counted, never matched against a table.
   */
  const commitments = [...new Set(
    (Array.isArray(body.commitments) ? body.commitments : [])
      .map((c: unknown) => String(c ?? "").trim().slice(0, 40))
      .filter(Boolean),
  )].slice(0, 8) as Intake["commitments"];
  const freq: Record<string, number> = {};
  const commitDay: Record<string, Day[]> = {};
  for (const c of commitments) {
    const n = int((body.freq as Record<string, unknown>)?.[c]) ?? 1;
    freq[c] = Math.max(1, Math.min(7, n));
    // a commitment cannot be fixed to more days than it happens
    commitDay[c] = list((body.commitDay as Record<string, unknown>)?.[c], DAYS).slice(0, freq[c]);
  }

  const discipline = body.discipline as Intake["discipline"];
  const equipmentAllowed = discipline === "Running race" ? EQUIPMENT_RUNNING : EQUIPMENT;

  return {
    hasRace: body.hasRace as Intake["hasRace"],
    discipline,
    raceDistance: (str(body.raceDistance) as Intake["raceDistance"]) ?? null,
    raceDate: str(body.raceDate),
    role: (str(body.role) as Intake["role"]) ?? null,
    division: (str(body.division) as Intake["division"]) ?? null,
    base: body.base as Intake["base"],
    runningSelf: body.runningSelf as Intake["runningSelf"],
    paceMin: int(body.paceMin),
    paceSec: int(body.paceSec) ?? 0,
    paceUnknown: body.paceUnknown === true,
    peakWeekKm: km(body.peakWeekKm),
    longestRunKm: km(body.longestRunKm),
    volumeSource: body.volumeSource === "strava" ? "strava"
      : body.volumeSource === "self" ? "self" : null,
    goal: str(body.goal),
    goalMin: int(body.goalMin),
    startDate: str(body.startDate),
    targetSessions: str(body.targetSessions),
    allowDoubles: str(body.allowDoubles),
    wantRestDay: str(body.wantRestDay),
    sessionPref: str(body.sessionPref),
    hyroxExp: str(body.hyroxExp),
    runDelta: str(body.runDelta),
    stationDelta: str(body.stationDelta),
    gymAccess: str(body.gymAccess),
    runStationLink: str(body.runStationLink),
    /*
     * Times are validated, not trusted. A race result reaches the capability
     * hierarchy, so a mistyped roxzone would move every pace in the plan — the
     * row is dropped rather than half-read.
     */
    pastRaces: (Array.isArray(body.pastRaces) ? body.pastRaces : [])
      .map((r: Record<string, unknown>) => ({
        event: String(r.event ?? "").trim().slice(0, 120),
        division: str(r.division),
        finish: String(r.finish ?? "").trim(),
        run_avg: String(r.run_avg ?? "").trim(),
        stations: String(r.stations ?? "").trim(),
        rox: String(r.rox ?? "").trim(),
      }))
      .filter((r: Intake["pastRaces"][number]) =>
        r.event.length > 1
        && [r.finish, r.run_avg, r.stations, r.rox]
          .every((t) => /^\d{1,2}:[0-5]\d(:[0-5]\d)?$/.test(t)))
      .slice(0, 10),
    /*
     * Secondary races. The intent is re-checked server-side at /plans/:id/races
     * against the gap — this is the athlete's answer, not the authority.
     */
    bRaces: (Array.isArray(body.bRaces) ? body.bRaces : [])
      .map((r: Record<string, unknown>) => ({
        date: String(r.date ?? ""),
        venue: String(r.venue ?? "").trim().slice(0, 120),
        intent: ["training", "sharpen", "compete"].includes(String(r.intent))
          ? String(r.intent) : "training",
      }))
      .filter((r: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
      .slice(0, 6),
    days: list(body.days, DAYS),
    commitments,
    freq,
    commitDay,
    commitMode: Object.fromEntries(commitments.map((c) => [c,
      (body.commitMode as Record<string, unknown>)?.[c] === "replace" ? "replace" : "add"])),
    equipment: list(body.equipment, equipmentAllowed as readonly Intake["equipment"][number][]),
    sled: (str(body.sled) as Intake["sled"]) ?? null,
    injuries: str(body.injuries),
    volume: body.volume as Intake["volume"],
    difficulty: body.difficulty as Intake["difficulty"],
    benchmark: (str(body.benchmark) as Intake["benchmark"]) ?? "offered",
  };
}

/**
 * The scaffold and the offer, without committing to anything.
 *
 * The design shows the resolved variables and the benchmark offer before a plan
 * exists, so this resolves without writing — an athlete can see what their
 * answers produce, and what the test would buy them, before deciding.
 */
export const PUT = route(async (req: NextRequest) => {
  await requireUser();
  const intake = parse(await req.json());
  const problems = validate(intake);
  if (problems.length > 0) return NextResponse.json({ problems }, { status: 400 });

  const r = resolve(intake);
  const plan = legacyGenerate(intake);
  return NextResponse.json({
    resolved: {
      weeks: r.weeks, start: r.start, race_date: r.raceDate,
      base_km: r.baseKm, ceiling: r.ceil, raw_start: r.rawStart, start_km: r.startKm,
      base_ramp: r.baseRamp, run_ramp: r.runRamp, ramp: r.ramp,
      allocation: { run: r.alloc[0], station: r.alloc[1], strength: r.alloc[2] },
      pace_known: r.paceKnown, goal_seconds: r.goalSeconds,
      plan_state: r.planState, phase_split: r.phaseSplit,
    },
    corrections: r.corrections,
    offer: {
      // the offer is suppressed rather than hidden: the screen says why
      suppressed: r.offerSuppressed,
      weeks_to_race: r.weeksToRace,
      gated: !!r.gate,
      gate: r.gate,
      variant: r.variant,
      ...BENCH_VARIANTS[r.variant],
      rounds: r.variant === "submax" ? 3 : 4,
    },
    preview: { volume: plan.volume, intents: plan.intents, guardrails: plan.guardrails },
    flags: plan.flags,
  });
});

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const intake = parse(await req.json());

  const problems = validate(intake);
  if (problems.length > 0) {
    // the whole list, not the first: a form that reveals one problem per submit
    // is a form people abandon
    return NextResponse.json({ problems }, { status: 400 });
  }

  const plan = legacyGenerate(intake);
  if (plan.weeks < 2) throw badRequest("That leaves too little time to build a block.");

  /*
   * The plan the athlete trains is built by lib/plan/, not lib/generate.ts.
   *
   * The old generator still runs above: it resolves the corrections panel and the
   * benchmark offer, which have no equivalent yet. But the weeks that get written
   * and materialised now come from the tested generator. Two of them writing the
   * same table would be the worst of both.
   */
  const [urow] = await sql<{ hr_max: number | null }[]>`
    select hr_max from users where id = ${me.id}
  `;
  const [conn] = await sql<{ ok: boolean }[]>`
    select exists (select 1 from oauth_accounts
                    where user_id = ${me.id} and provider = 'strava') as ok
  `;
  const [{ races }] = await sql<{ races: number }[]>`
    select count(*)::int as races from races where user_id = ${me.id}
  `;
  const { recent } = await recentFor(me.id, conn?.ok ?? false);
  const absences = (await sql<{ from_date: string; to_date: string; kind: string }[]>`
    select from_date::text as from_date, to_date::text as to_date, kind
      from absences where user_id = ${me.id}
  `).map((a) => ({
    from_date: a.from_date, to_date: a.to_date,
    type: a.kind as "no_training" | "some_access" | "normal",
  }));

  const params = paramsFrom(intake, {
    recent, absences, max_hr: urow?.hr_max ?? null,
    measured: intake.benchmark === "logged",
    // A race on file and a race typed into the intake are the same race.
    hyrox_races: races + (intake.pastRaces?.length ?? 0),
  });
  const built = buildPlan(params);
  const tpl0 = toTemplate(built);
  /*
   * The start date the generator actually planned from.
   *
   * The legacy generator snapped it to a Monday; this one does not, and
   * materialise now lays weeks out from whatever it is given. Storing the legacy
   * value would place every session two days from where the plan intended it.
   */
  const startDate = params.week_start(1);

  await sql`
    insert into athlete_intake (
      user_id, has_race, discipline, race_distance, race_date, role, division,
      base, running_self, pace_min, pace_sec, pace_unknown,
      peak_week_km, longest_run_km, volume_source, answers,
      days, commitments, freq, commit_day, equipment, sled,
      injuries, volume, difficulty, benchmark, updated_at
    ) values (
      ${me.id}, ${intake.hasRace}, ${intake.discipline}, ${intake.raceDistance},
      ${intake.raceDate}, ${intake.role}, ${intake.division},
      ${intake.base}, ${intake.runningSelf}, ${intake.paceMin}, ${intake.paceSec},
      ${intake.paceUnknown}, ${intake.peakWeekKm}, ${intake.longestRunKm},
      ${intake.volumeSource}, ${sql.json(extraOf(intake) as never)},
      ${intake.days}, ${intake.commitments},
      ${sql.json(intake.freq as never)}, ${sql.json(intake.commitDay as never)},
      ${intake.equipment}, ${intake.sled}, ${intake.injuries},
      ${intake.volume}, ${intake.difficulty}, ${intake.benchmark}, now()
    )
    on conflict (user_id) do update set
      has_race = excluded.has_race, discipline = excluded.discipline,
      race_distance = excluded.race_distance, race_date = excluded.race_date,
      role = excluded.role, division = excluded.division, base = excluded.base,
      running_self = excluded.running_self, pace_min = excluded.pace_min,
      pace_sec = excluded.pace_sec, pace_unknown = excluded.pace_unknown,
      peak_week_km = excluded.peak_week_km,
      longest_run_km = excluded.longest_run_km,
      volume_source = excluded.volume_source, answers = excluded.answers,
      days = excluded.days, commitments = excluded.commitments, freq = excluded.freq,
      commit_day = excluded.commit_day, equipment = excluded.equipment,
      sled = excluded.sled, injuries = excluded.injuries, volume = excluded.volume,
      difficulty = excluded.difficulty, benchmark = excluded.benchmark, updated_at = now()
  `;

  // Rebuilding replaces the block rather than adding a second one. Only untouched
  // future sessions go: anything logged, moved or commented on is a record of
  // what happened and survives a change of plan.
  const old = await sql<{ id: string }[]>`
    select id from plan_templates where athlete_id = ${me.id} and active
  `;
  for (const t of old) {
    await sql`
      delete from planned_sessions
       where user_id = ${me.id} and source = 'template'
         and source_ref like ${t.id + "%"}
         and status = 'planned' and activity_id is null
         and planned_date >= current_date
         and not exists (select 1 from session_comments c where c.session_id = planned_sessions.id)
         and not exists (select 1 from session_sets s where s.session_id = planned_sessions.id)
    `;
    await sql`update plan_templates set active = false where id = ${t.id}`;
  }

  const [tpl] = await sql<{ id: string }[]>`
    insert into plan_templates (
      athlete_id, author_id, name, start_date, weeks, rules, horizon, active,
      race_date, race_name, goal_label, goal_seconds, volume, intents,
      plan_state, benchmark, guardrails, easy_pace, corrections
    ) values (
      ${me.id}, ${me.id}, ${plan.name}, ${startDate},
      ${sql.json(tpl0.weeks as never)}, ${sql.json(tpl0.rules as never)}, 3, true,
      ${plan.race_date}, ${plan.race_name}, ${plan.goal_label}, ${plan.goal_seconds},
      ${sql.json(tpl0.volume as never)}, ${sql.json(tpl0.intents as never)},
      ${plan.plan_state}, ${sql.json(plan.benchmark as never)},
      ${sql.json(plan.guardrails as never)}, ${plan.easy_pace},
      ${sql.json(plan.corrections as never)}
    )
    on conflict (athlete_id, name) do update set
      start_date = excluded.start_date, weeks = excluded.weeks, rules = excluded.rules,
      active = true, race_date = excluded.race_date, race_name = excluded.race_name,
      goal_label = excluded.goal_label, goal_seconds = excluded.goal_seconds,
      volume = excluded.volume, intents = excluded.intents,
      plan_state = excluded.plan_state, benchmark = excluded.benchmark,
      guardrails = excluded.guardrails, easy_pace = excluded.easy_pace,
      corrections = excluded.corrections
    returning id
  `;
  /*
   * The races themselves, which nothing was writing.
   *
   * The intake collected a race date and a list of secondary races and then
   * dropped both on the floor — so the race planner, the race week and race day
   * had nothing to plan against, and the B-race stage reshaped weeks around races
   * that existed only in the answers blob. Written here because this is the point
   * the athlete commits to the block.
   *
   * Replaced rather than merged: rebuilding a plan re-declares the races, and a
   * leftover race from a previous build would quietly reshape the new one.
   */
  await sql`delete from race_targets where athlete_id = ${me.id}`;
  if (intake.raceDate) {
    await sql`
      insert into race_targets (
        athlete_id, race_date, start_date, discipline, division, goal,
        target_time_s, role
      ) values (
        ${me.id}, ${intake.raceDate}, ${startDate}, ${intake.discipline},
        ${intake.division}, ${intake.goal},
        ${intake.goalMin ? Math.round(intake.goalMin * 60) : null}, 'target'
      )
    `;
    for (const b of intake.bRaces ?? []) {
      // The intent the athlete chose is re-checked here against the real gap:
      // the answer was given before the start date was necessarily settled.
      const ok = checkIntent(b.intent as Intent, b.date, intake.raceDate);
      await sql`
        insert into race_targets (
          athlete_id, race_date, venue, discipline, division, role, intent,
          intent_locked
        ) values (
          ${me.id}, ${b.date}, ${b.venue || null}, ${intake.discipline},
          ${intake.division}, 'secondary',
          ${ok.ok ? b.intent : "training"},
          ${intentLocked(b.date, today())}
        )
      `;
    }
  }

  const { created } = await materialise(tpl.id);

  return NextResponse.json({
    ok: true,
    plan: {
      id: tpl.id, name: plan.name, weeks: built.weeks.length, start: startDate,
      race_date: plan.race_date, plan_state: plan.plan_state,
      total_km: tpl0.volume.reduce((n, v) => n + v.km, 0),
      volume: tpl0.volume, intents: tpl0.intents,
      weeks_generated: built.weeks.length, role: built.role,
      generator: built.version,
      guardrails: plan.guardrails, benchmark: plan.benchmark,
    },
    corrections: plan.corrections,
    /** the new generator's own flags, which name what it had to compromise */
    flags: [...plan.flags, ...built.flags.map((f) => f.message)],
    violations: built.violations,
    sessions_created: created,
  });
});

/** The reworked form's steps, stored together. */
const EXTRA_KEYS = [
  "goal", "goalMin", "startDate", "targetSessions", "allowDoubles",
  "wantRestDay", "sessionPref", "hyroxExp", "runDelta", "stationDelta", "gymAccess",
  // Typed-in race results. The only source of a roxzone in the whole app, so
  // they travel with the answers rather than being derived from anything.
  "pastRaces", "bRaces", "runStationLink",
] as const;

const extraOf = (i: Intake) =>
  Object.fromEntries(EXTRA_KEYS.map((k) => [k, i[k] ?? null]));

/** Read back with a null for anything an older intake never had. */
function extraAnswers(a: Record<string, unknown> | null) {
  const out: Record<string, unknown> = {};
  for (const k of EXTRA_KEYS) out[k] = a?.[k] ?? null;
  return out as Pick<Intake, (typeof EXTRA_KEYS)[number]>;
}
