import { sql } from "../db";
import { materialise } from "../templates";
import { parseSteps, parseStrength } from "../prescription";
import { PHASE_LABEL } from "./intents";
import { type Imported, type ImportedWeek, classKm, weekKm } from "./import";

/**
 * Putting an authored plan into the app, and refusing to put in a broken one.
 *
 * The template document is the same shape the generator produced, which is the whole reason
 * this is a small piece of code: every screen, the watch push, the activity comparison and the
 * strength log read `plan_templates.weeks` and know nothing about where it came from. What
 * changes is only that `origin` says `imported`, and that nothing may regenerate it.
 *
 * The order matters and is deliberate. Validate everything first and write nothing if anything
 * fails; then deactivate whatever was there; then write; then materialise. A half-imported
 * plan is worse than a failed import, because the athlete cannot tell which weeks are which.
 */

const km1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A prescription's distance, read exactly as the app reads it — repeats expanded, and the
 * `m`-under-60-is-minutes rule the rest of the app applies.
 */
function readKm(target: string): number {
  let km = 0;
  for (const g of parseSteps(target)) {
    for (const st of g.items) {
      const m = /^(\d+(?:\.\d+)?)\s*(km|k|m|min|s|sec|mi)\b/i.exec(st.dose.trim());
      if (!m) continue;
      const n = Number(m[1]), unit = m[2].toLowerCase();
      const paceAll = [...(st.pace ?? "").matchAll(/(\d{1,2}):([0-5]\d)/g)]
        .map((x) => Number(x[1]) * 60 + Number(x[2]));
      const pace = paceAll.length ? paceAll.reduce((a, b) => a + b, 0) / paceAll.length : 0;
      let d = 0;
      if (unit === "km" || unit === "k") d = n;
      else if (unit === "mi") d = n * 1.609;
      else if (unit === "m") d = n < 60 ? (pace ? (n * 60) / pace : 0) : n / 1000;
      else if (unit === "min") d = pace ? (n * 60) / pace : 0;
      else d = pace ? n / pace : 0;
      km += d * g.repeat;
    }
  }
  return km;
}

/** Only these reach a session. Anything else in a document is a problem, not a row. */
const KINDS = new Set([
  "quality_run", "easy_run", "long_run", "hyrox", "easy_hyrox", "strength", "race",
  "kickboxing", "benchmark",
]);

export type WriteResult = {
  ok: boolean;
  problems: string[];
  /** what the import resolved and wants said — never a reason to stop */
  notes: string[];
  weeks: number;
  sessions: number;
  created: number;
  /** per week: what the document stated, what the sessions come to, and the class bonus */
  volume: { n: number; stated: number; written: number; classes: number }[];
};

/**
 * Everything that must be true before a single row is written.
 *
 * The weekly kilometre check is the one that matters. The author already did that arithmetic,
 * so a disagreement means this import misread something — and a misreading that only shows up
 * as a slightly wrong weekly total is exactly the kind that would never be noticed.
 */
export function check(
  imported: Imported, tolerance = 0.6,
  /**
   * Divergences from the document that have been looked at and accepted, by week number.
   *
   * A map rather than a looser tolerance, and it is the difference between a check that still
   * works and one that has been switched off. Every entry here is a place where the document
   * disagrees with itself and somebody decided which side wins — so it has to be named, and
   * any divergence that is not on this list still fails the import.
   */
  allow: Record<number, number> = {},
): string[] {
  const problems = [...imported.problems];
  if (imported.weeks.length === 0) problems.push("No weeks were found in the document.");

  const seen = new Set<number>();
  for (const w of imported.weeks) {
    if (seen.has(w.n)) problems.push(`week ${w.n} appears twice`);
    seen.add(w.n);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.monday)) {
      problems.push(`week ${w.n}: no readable Monday date`);
    }
    if (w.sessions.length === 0) problems.push(`week ${w.n}: no sessions`);

    for (const s of w.sessions) {
      const where = `week ${w.n} day ${s.day}`;
      if (!KINDS.has(s.kind)) problems.push(`${where}: unknown kind "${s.kind}"`);
      if (s.day < 0 || s.day > 6) problems.push(`${where}: day out of range`);
      if (!s.target) {
        /*
         * A session with no prescription is legitimate for exactly two things: something the
         * athlete already does, and the race. Anything else with an empty target is a session
         * screen with nothing on it.
         */
        if (!s.commitment && s.kind !== "race") {
          problems.push(`${where}: "${s.title}" has no prescription`);
        }
        continue;
      }
      const readable = s.kind === "strength"
        ? parseStrength(s.target).length > 0
        : parseSteps(s.target).some((g) => g.items.length > 0);
      if (!readable) problems.push(`${where}: the app cannot read "${s.title}" — ${s.target}`);

      /*
       * And what the app makes of it must match what this module meant.
       *
       * The check below compared the document against `s.km`, which is this module's own
       * intention — so a target the app reads differently passed silently. It did: an embedded
       * block long run was written with a repeat marker and a tail after it, which the reader
       * folds into the repeat, and an 18 km run became 32 on the session screen while the
       * import reported the week as exact.
       *
       * Measuring the prescription the way the app will is the only version of this check
       * worth having.
       */
      if (s.kind !== "strength" && s.km > 0) {
        const asRead = km1(readKm(s.target));
        if (Math.abs(asRead - s.km) > 0.3) {
          problems.push(
            `${where}: "${s.title}" is meant to be ${s.km} km and the app reads it as `
            + `${asRead} km — ${JSON.stringify(s.target)}`,
          );
        }
      }
    }

    /* The author's own arithmetic, against this module's reading of it. */
    const written = weekKm(w);
    const diff = Math.round((written - w.stated_km) * 10) / 10;
    const allowed = allow[w.n];
    const unexplained = allowed === undefined ? diff : Math.round((diff - allowed) * 10) / 10;
    if (w.stated_km > 0 && Math.abs(unexplained) > tolerance) {
      problems.push(
        `week ${w.n}: the document states ${w.stated_km} km and the sessions come to ${written} km`
        + (allowed === undefined ? "" : ` (${allowed} km of that was expected)`),
      );
    }
  }
  return problems;
}

/** The template day shape, which is the generator's own — see lib/templates.ts. */
function daysOf(w: ImportedWeek) {
  return w.sessions
    .slice()
    .sort((a, b) => a.day - b.day || (a.slot === "PM" ? 1 : 0) - (b.slot === "PM" ? 1 : 0))
    .map((s) => ({
      day: s.day,
      kind: s.kind,
      /*
       * `title` is parsed — a pace target is read out of it by the calibration code — so it
       * stays the plan's own name for the session, and `purpose` carries the same words for
       * the screen. An imported plan names its own sessions; nothing here renames them.
       */
      title: s.title,
      ...(s.purpose && s.purpose !== s.title ? { purpose: s.purpose } : {}),
      minutes: s.minutes,
      ...(s.target ? { target: s.target } : {}),
      ...(s.note ? { coach_note: s.note } : {}),
      ...(s.significance ? { significance: s.significance } : {}),
      ...(s.slot ? { slot: s.slot } : {}),
    }));
}

/** Phase ranges, built from the weeks rather than from a generator that did not run. */
function intentsOf(weeks: ImportedWeek[]) {
  const out: { from: number; to: number; phase: string; purpose: string;
    protect: string[]; sacrifice: string; watch: string }[] = [];
  for (const w of weeks) {
    const label = PHASE_LABEL[w.phase] ?? w.phase;
    const last = out[out.length - 1];
    if (last && last.phase === label) { last.to = w.n; continue; }
    /*
     * The protected sessions are the ones the plan itself calls key, named as the week names
     * them. Not invented here: on an authored plan the author already decided which days the
     * week is built around, and Rebuild My Week reads this to know what it may not drop.
     */
    const key = w.sessions.filter((s) => s.significance === "key");
    out.push({
      from: w.n, to: w.n, phase: label,
      purpose: w.note || "",
      protect: key.map((s) => s.title),
      sacrifice: "Easy running comes off first. The key days are the plan.",
      watch: "",
    });
  }
  return out;
}

export async function writeImported(
  athleteId: string, imported: Imported,
  opts: {
    name?: string; authorId?: string; dryRun?: boolean; tolerance?: number;
    raceDate?: string | null;
    /** accepted divergences from the document, by week — see `check` */
    allow?: Record<number, number>;
  } = {},
): Promise<WriteResult> {
  const problems = check(imported, opts.tolerance, opts.allow);
  const volume = imported.weeks.map((w) => ({
    n: w.n, stated: w.stated_km, written: weekKm(w), classes: classKm(w),
  }));
  const sessions = imported.weeks.reduce((n, w) => n + w.sessions.length, 0);

  if (problems.length > 0 || opts.dryRun) {
    return {
      ok: problems.length === 0, problems, notes: imported.notes,
      weeks: imported.weeks.length, sessions, created: 0, volume,
    };
  }

  const ordered = [...imported.weeks].sort((a, b) => a.n - b.n);
  const start = ordered[0].monday;
  const name = opts.name ?? imported.title;

  const template = {
    weeks: ordered.map(daysOf),
    volume: ordered.map((w) => ({
      n: w.n,
      /* What the sessions come to, so no two numbers on the screen disagree. */
      /* The author's own number: running on your own two feet, classes excluded. */
      km: weekKm(w),
      /* And what the classes add, so a screen can show the week both ways. */
      class_km: classKm(w),
      phase: w.phase,
      /*
       * The week's own label with its date range taken off.
       *
       * "14-20 Sep - Down week" is a note that says "Down week". Matched as a whole range rather
       * than by stripping up to a dash, because the ranges themselves contain dashes and the
       * months move: "17-23 Aug", "31 Aug - 6 Sep" and "26 Oct - 1 Nov - B-race" all have to
       * leave the right thing behind, and two earlier attempts left a stray dash and then an end
       * date standing in as the note.
       */
      note: w.label
        .replace(/^\d{1,2}\s*[A-Za-z]*\s*[-–—]\s*\d{1,2}\s*[A-Za-z]{3,}\.?/, "")
        .replace(/^[\s-–—]+/, "").trim()
        || (w.deload ? "Down week" : w.taper ? "Taper" : ""),
    })),
    intents: intentsOf(ordered),
    rules: {},
  };

  /*
   * One active plan per athlete. The old one is deactivated rather than deleted — it is the
   * record of what they were following, and `materialise` clears stale future sessions by
   * athlete rather than by template id, so nothing of it is left on the calendar.
   */
  await sql`
    update plan_templates set active = false
     where athlete_id = ${athleteId} and active and name <> ${name}
  `;

  /*
   * The same columns the intake writes, rather than a second shape.
   *
   * `volume` and `intents` are what the plan and week screens read for the weekly figure and
   * for what a phase is for — a template with weeks and neither shows "Off block" over a plan
   * that is running. `plan_state` is 'authored': the paces are a coach's, so they are neither
   * estimated from a form nor measured by a benchmark.
   */
  const [row] = await sql<{ id: string }[]>`
    insert into plan_templates (
      athlete_id, author_id, name, start_date, weeks, rules, horizon, active, origin,
      race_date, volume, intents, plan_state, guardrails, corrections
    ) values (
      ${athleteId}, ${opts.authorId ?? athleteId}, ${name}, ${start},
      ${sql.json(template.weeks as never)}, ${sql.json({} as never)},
      /* The whole block, not a rolling window: an imported plan is a document somebody wants
         to read end to end, and there is nothing left to compute later. */
      ${ordered.length + 1}, true, 'imported',
      ${opts.raceDate ?? null},
      ${sql.json(template.volume as never)}, ${sql.json(template.intents as never)},
      'authored', ${sql.json([] as never)}, ${sql.json([] as never)}
    )
    on conflict (athlete_id, name) do update set
      start_date = excluded.start_date, weeks = excluded.weeks, horizon = excluded.horizon,
      active = true, origin = 'imported', race_date = excluded.race_date,
      volume = excluded.volume, intents = excluded.intents,
      plan_state = excluded.plan_state
    returning id
  `;

  const { created } = await materialise(row.id);

  /*
   * And whatever the previous plan left on today.
   *
   * `materialise` clears stale future sessions with `planned_date > now`, which is right for
   * its own purpose — a session today may already be half done, and rewriting it under
   * somebody mid-session is worse than leaving it. But an import that starts today then shows
   * both plans' Mondays side by side: his week 1 came out with eleven sessions instead of
   * eight, three of them from a block he is no longer following.
   *
   * So today is cleared too, and only of rows a deactivated template wrote, and only where
   * nothing has happened against them. Anything logged, moved, commented on or with sets
   * recorded is what actually happened and survives any change of plan.
   */
  const stale = await sql<{ id: string }[]>`
    delete from planned_sessions p
     using plan_templates t
     where p.user_id = ${athleteId} and p.source = 'template'
       and p.source_ref like t.id || '%' and t.id <> ${row.id} and not t.active
       and p.planned_date >= ${start}
       and p.status = 'planned' and p.activity_id is null
       and not exists (select 1 from session_comments c where c.session_id = p.id)
       and not exists (
             select 1 from session_sets ss
              where ss.session_id = p.id
                -- The same test materialise() uses, and for the same reason: a prescribed set
                -- is not a record of anything. Loads are pre-filled, so opening a strength
                -- session writes a row per set with the prescribed load and reps already in
                -- it — and the load cannot be the test, because it is seeded from the last
                -- time the athlete lifted that movement. What makes a set theirs is ticking
                -- it off, writing a note, or entering a rep count other than the one asked
                -- for. Without this, every strength session he has ever opened would survive
                -- the import and sit beside its replacement.
                and (ss.done
                     or ss.note is not null
                     or ss.reps is distinct from ss.prescribed_reps)
           )
     returning p.id
  `;
  if (stale.length > 0) {
    imported.notes.push(
      `${stale.length} untouched session${stale.length === 1 ? "" : "s"} from the previous plan `
      + "were removed from the calendar.",
    );
  }

  return {
    ok: true, problems: [], notes: imported.notes,
    weeks: ordered.length, sessions, created, volume,
  };
}
