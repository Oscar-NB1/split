import { sql } from "./db";

/**
 * The days an athlete has taught the plan.
 *
 * Every other preference in this app was asked for in the intake. This one is
 * learned, because it is the kind of thing nobody can answer in the abstract: an
 * athlete does not know they want strength on Mondays until they have moved it there
 * three weeks running. The app was already recording those moves in
 * `session_changes` and learning nothing from them.
 */

/** 0 = Monday, matching the placer and every week screen in the app. */
export const MON = 0;

export type DayPrefs = Record<string, number>;

export async function prefsFor(athleteId: string): Promise<DayPrefs> {
  const rows = await sql<{ kind: string; weekday: number }[]>`
    select kind, weekday from day_preferences where athlete_id = ${athleteId}
  `;
  return Object.fromEntries(rows.map((r) => [r.kind, r.weekday]));
}

/**
 * Remember, or forget.
 *
 * `weekday: null` deletes it — an athlete who has changed their mind about lifting on
 * Mondays should be able to stop the plan insisting, and the way to say that is the
 * same control that set it.
 */
export async function setPref(
  athleteId: string, kind: string, weekday: number | null,
): Promise<void> {
  if (weekday === null) {
    await sql`
      delete from day_preferences where athlete_id = ${athleteId} and kind = ${kind}
    `;
    return;
  }
  const day = Math.max(0, Math.min(6, Math.round(weekday)));
  await sql`
    insert into day_preferences (athlete_id, kind, weekday)
    values (${athleteId}, ${kind}, ${day})
    on conflict (athlete_id, kind) do update set weekday = ${day}, created_at = now()
  `;
}

const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * What to tell them, once it is remembered.
 *
 * Named in full and with the honest caveat: this is a preference the placer pays a
 * penalty to break, not a rule it cannot break. An athlete told "strength is now
 * always on Mondays" who then finds it on a Tuesday because their Monday holds a
 * fixed class has been lied to by one word.
 */
export const sayPref = (kind: string, weekday: number, label: string): string =>
  `${label} will be scheduled on ${DAY_NAME[weekday] ?? "that day"} from now on, `
  + "unless a fixed commitment or another key session already has the day.";
