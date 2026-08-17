import { sql } from "./db";
import { paramsFrom } from "./plan/from-intake";
import { generate } from "./plan/generate";
import { toTemplate } from "./plan/to-template";
import { materialise } from "./templates";
import { prefsFor } from "./day-prefs";
import { measuredFor } from "./race/measured";
import { recentFor } from "./recent";
import { loadIntakeRow, toIntake } from "./intake-store";

/**
 * Rebuilding the weeks after the athlete has taught the plan something.
 *
 * The plan is generated from the intake, so anything learned afterwards — a day
 * preference, a measured B-race — only reaches the sessions by regenerating. Doing
 * that from the intake endpoint would mean asking the athlete to re-answer forty
 * questions to move strength to a Monday.
 *
 * Deliberately narrow: it regenerates from the answers already stored and writes the
 * template and the future sessions. It does not invent an answer, and it does not
 * touch anything the athlete has already done — `materialise` only rewrites untouched
 * future rows, which is the same guard every other path relies on.
 */
export async function rememberDay(userId: string): Promise<number> {
  /*
   * The stored answers, read exactly as the intake screen would have sent them.
   *
   * Through the shared loader, not from the `answers` blob: the early steps of the
   * form are columns and only the later ones are jsonb, so building an Intake from
   * the blob alone produced a half-populated object and an "Invalid time value" out
   * of the generator, because the race date is a column.
   */
  const row = await loadIntakeRow(userId);
  // No intake, no plan to rebuild. The preference is stored either way, and the next
  // plan they build will read it.
  if (!row) return 0;

  const [tpl] = await sql<{ id: string; volume_feel_delta: number }[]>`
    select id, volume_feel_delta from plan_templates
     where athlete_id = ${userId} and active order by start_date desc limit 1
  `;
  if (!tpl) return 0;

  const intake = toIntake(row);
  const [urow] = await sql<{ hr_max: number | null }[]>`
    select hr_max from users where id = ${userId}
  `;
  const [conn] = await sql<{ ok: boolean }[]>`
    select exists (select 1 from oauth_accounts
                    where user_id = ${userId} and provider = 'strava') as ok
  `;
  const [{ races }] = await sql<{ races: number }[]>`
    select count(*)::int as races from races where user_id = ${userId}
  `;
  const absences = (await sql<{ from_date: string; to_date: string; kind: string }[]>`
    select from_date::text as from_date, to_date::text as to_date, kind
      from absences where user_id = ${userId}
  `).map((a) => ({
    from_date: a.from_date, to_date: a.to_date,
    type: a.kind as "no_training" | "some_access" | "normal",
  }));
  const { recent } = await recentFor(userId, conn?.ok ?? false);
  const measured = await measuredFor(userId);
  /*
   * What they confirmed they are training around.
   *
   * Only the confirmed column, and only while it is still about the note they have now:
   * a niggle that healed gets edited out of the intake text, and constraints from the
   * old text would go on removing training nobody needs removed.
   */
  const [around] = await sql<{ confirmed: unknown; stale: boolean }[]>`
    select c.confirmed,
           btrim(c.source_text) <> coalesce(
             nullif(btrim(u.injury_notes), ''), nullif(btrim(i.injuries), ''), ''
           ) as stale
      from training_constraints c
      join users u on u.id = c.user_id
      left join athlete_intake i on i.user_id = c.user_id
     where c.user_id = ${userId}
  `;
  const constraints = around && !around.stale
    ? (around.confirmed as Parameters<typeof paramsFrom>[1]["constraints"]) ?? []
    : [];

  const params = paramsFrom(intake, {
    recent, absences, max_hr: urow?.hr_max ?? null,
    measured: intake.benchmark === "logged",
    hyrox_races: races + (intake.pastRaces?.length ?? 0),
    measured_race_run_split_s: measured.run_split_s,
    // What their runs have said about the volume, since they answered the dial.
    volume_feel_delta: tpl.volume_feel_delta,
    constraints,
  });
  /*
   * The learned days, on top of the answers.
   *
   * Applied here rather than inside `paramsFrom` because they are not intake answers
   * — they are what the athlete has done since — and a pure function that reads the
   * database would stop being reproducible from its own stored inputs.
   */
  const withPrefs = { ...params, day_prefs: await prefsFor(userId) };

  const built = generate(withPrefs);
  const next = toTemplate(built, urow?.hr_max ?? null);

  /*
   * Nothing is written unless the new block is at least as complete as the old one.
   *
   * This is the guard that was missing, and it cost him his plan. `materialise` clears
   * every untouched future session and rewrites from the template, which is correct
   * and also means a garbage template deletes a good block. Two bugs of mine produced
   * exactly that: reading the intake from the `answers` blob alone gave a
   * half-populated athlete, the generator made a 12-week stub of it, and 116 future
   * sessions went with it.
   *
   * A regeneration is an optimisation — the athlete moved strength to a Monday. It is
   * never worth a plan. So the new block has to have at least as many weeks as the
   * current template and a real session count, or this returns having changed nothing
   * and the preference simply waits for the next full rebuild.
   */
  const [{ weeks: currentWeeks }] = await sql<{ weeks: number }[]>`
    select coalesce(jsonb_array_length(weeks), 0) as weeks
      from plan_templates where id = ${tpl.id}
  `;
  const sessions = next.weeks.reduce((n, w) => n + w.length, 0);
  if (next.weeks.length < currentWeeks || sessions < currentWeeks * 3) {
    console.error(
      `replan refused: ${next.weeks.length} weeks and ${sessions} sessions `
      + `against a live block of ${currentWeeks} weeks`,
    );
    return 0;
  }

  /*
   * The weeks, and nothing else.
   *
   * Not `rules`: this generator writes every week explicitly and `toTemplate` returns
   * an empty rules object, so including it would overwrite whatever adaptation rules
   * the plan is carrying with `{}` — quietly, on a request whose whole purpose was to
   * move strength to a Monday. And no `updated_at`, which this table does not have.
   */
  await sql`
    update plan_templates set weeks = ${sql.json(next.weeks as never)}
     where id = ${tpl.id}
  `;
  return (await materialise(tpl.id)).created;
}
