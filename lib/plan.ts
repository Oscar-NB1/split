/**
 * Shared vocabulary for planned sessions: what a kind can be, what a skip
 * reason can be, and how a session is rewritten when it's scaled down.
 *
 * These live here rather than in the route files because a route module may
 * only export HTTP verbs, and because they are the parts worth unit testing.
 */

/** The kinds the rest of the app knows how to label, score and push. */
export const KINDS = [
  "run_easy", "run_intervals", "run_long", "hyrox", "strength", "rest",
] as const;
export type Kind = (typeof KINDS)[number];

export const SKIP_REASONS = ["tired", "sore", "no_time", "sick", "other"] as const;

/** Reasons that mean "my body said no" - the ones that adapt next week. */
export const FATIGUE_REASONS = ["tired", "sore", "sick"] as const;

export const isKind = (k: unknown): k is Kind => KINDS.includes(k as Kind);
export const isDateString = (s: unknown) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Checked before it reaches Postgres, where a bad uuid is a 500. */
export const isUuid = (s: unknown) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** The lighter version of each session type. */
export function lighten(kind: string, minutes: number) {
  const m = Math.max(20, Math.round(minutes * 0.6));
  if (kind === "run_intervals")
    return { kind: "run_easy", minutes: m, title: "Easy run (was: {t})" };
  if (kind === "run_long")
    return { kind: "run_easy", minutes: m, title: "Shorter run (was: {t})" };
  if (kind === "hyrox")
    return { kind: "hyrox", minutes: m, title: "Short stations (was: {t})" };
  return { kind, minutes: m, title: "{t} - short" };
}

/**
 * The title before any previous scaling. Scaling twice used to nest:
 * "Easy run (was: Easy run (was: Intervals))".
 */
export function baseTitle(title: string): string {
  const m = title.match(/\(was:\s*(.*)\)\s*$/);
  return (m ? m[1] : title.replace(/\s+-\s+short$/, "")).trim();
}

/** The title a scaled session ends up with. */
export function scaledTitle(kind: string, minutes: number, currentTitle: string) {
  return lighten(kind, minutes).title.replace("{t}", baseTitle(currentTitle));
}
