import { sql } from "./db";

/**
 * The messages an athlete reads in their week.
 *
 * Two kinds. A context message is keyed to a kind of week and shown every time
 * one comes round; a warm message belongs to no week and rotates. Both are
 * written by the coach in advance, because the useful version of this is not a
 * notification at 6am — it is something already there when the week opens.
 */

export type ContextKey =
  | "benchmark" | "deload" | "taper" | "raceclose" | "peak" | "build" | "base";

/** In the order they are offered for editing: rarest kind of week first. */
export const CONTEXTS: { key: ContextKey; label: string; hint: string }[] = [
  { key: "benchmark", label: "Benchmark week", hint: "Shown the week a test is scheduled." },
  { key: "deload", label: "Down week", hint: "Shown when volume steps back." },
  { key: "taper", label: "Taper", hint: "The last two weeks before the race." },
  { key: "raceclose", label: "Race approaching", hint: "Inside four weeks. {weeks} becomes the number." },
  { key: "peak", label: "Peak week", hint: "The biggest week of the block. {km} becomes the distance." },
  { key: "build", label: "Build week", hint: "Any week that steps up." },
  { key: "base", label: "Base week", hint: "Everything else." },
];

/** Placeholders a context message may use. Anything else is left as typed. */
export function fill(body: string, vars: { weeks?: number; km?: number }) {
  return body
    .replace(/\{weeks\}/g, vars.weeks === undefined ? "" : String(vars.weeks))
    .replace(/\{km\}/g, vars.km === undefined ? "" : String(Math.round(vars.km)));
}

/**
 * Which kind of week this is.
 *
 * Order is precedence, not preference: a deload that happens to contain the
 * benchmark is a benchmark week, and a taper week inside four weeks of the race
 * is a taper. Each week resolves to exactly one message.
 */
export function contextFor(w: {
  benchmark?: boolean; deload?: boolean; phase?: string;
  weeksToRace: number; km: number; peakKm: number;
}): ContextKey {
  if (w.benchmark) return "benchmark";
  if (w.phase === "taper" || w.weeksToRace <= 2) return "taper";
  if (w.deload) return "deload";
  if (w.km >= w.peakKm) return "peak";
  if (w.weeksToRace <= 4) return "raceclose";
  if (w.phase === "build" || w.phase === "specific") return "build";
  return "base";
}

export type Stored = { id: string; kind: string; context: string | null; body: string; position: number };

export const messagesFor = (coachId: string, athleteId: string) => sql<Stored[]>`
  select id, kind, context, body, position from coach_messages
   where coach_id = ${coachId} and athlete_id = ${athleteId}
   order by kind, position, context
`;

/**
 * The one an athlete sees this week.
 *
 * The context message if the coach wrote one for this kind of week, otherwise a
 * warm one — chosen by week number rather than at random, so opening the app
 * twice on a Tuesday does not show two different messages.
 */
export function pick(rows: Stored[], context: ContextKey, weekNumber: number): string | null {
  const keyed = rows.find((r) => r.kind === "context" && r.context === context);
  if (keyed) return keyed.body;
  const warm = rows.filter((r) => r.kind === "warm" && r.body.trim());
  if (!warm.length) return null;
  return warm[weekNumber % warm.length].body;
}
