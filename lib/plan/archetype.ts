import type { Capture } from "./capture";
import { type Change, type Reading, read } from "./findings";

/**
 * A name for a pattern already in the findings.
 *
 * Read-only synthesis. It derives nothing new and prescribes nothing: `limiter`,
 * `durability` and `pacing` are already computed from the benchmark and already
 * drive the plan changes the results screen shows. This labels the combination.
 *
 * If it disappeared tomorrow no plan would change, and that is the design. It
 * does not feed the generator and emits no signals — which is what makes it
 * safe to show an athlete a word about themselves.
 */

export const DERIVATION_VERSION = 1;

export const ARCHETYPES = [
  "fast_start", "thin_engine", "strong_runner", "both_ends", "even_keel",
] as const;
export type ArchetypeType = (typeof ARCHETYPES)[number];

/**
 * Precedence when more than one condition matches.
 *
 * Pacing wins because it is the cheapest thing to correct and the most
 * expensive to leave uncorrected. The order is precedence only — it is not a
 * ranking, and nothing should present it as one: `even_keel` is not a goal
 * state, it is a different starting point.
 */
const PRECEDENCE: ArchetypeType[] = [
  "fast_start", "thin_engine", "strong_runner", "both_ends", "even_keel",
];

export const SUMMARY: Record<ArchetypeType, string> = {
  thin_engine: "Runs degrade faster than stations; heavy fade",
  fast_start: "Round 1 well quicker than the rest, then decay",
  strong_runner: "Stations degrade faster than runs; pace holds",
  even_keel: "No dominant limiter, good durability",
  both_ends: "No dominant limiter, poor durability",
};

export type Dimension = {
  value: string;
  /** the station half can only ever come from a benchmark — see `recompute` */
  source: "benchmark" | "key_sessions";
  as_of: string;
};

export type Archetype = {
  type: ArchetypeType;
  derived_at: string;
  source_benchmark_id: string;
  confidence: "high" | "low";
  derivation_version: number;
  /** the readings that produced it, heaviest first, so a client can link the
   *  archetype to the finding cards below it without recomputing anything */
  contributing: string[];
  dimensions: {
    limiter: Dimension | null;
    durability: Dimension | null;
    pacing: Dimension | null;
  };
};

const bandOf = (rs: Reading[], dim: string) => rs.find((r) => r.dim === dim)?.band ?? null;

/** Fade as the ratio the bands are written against. */
function fadeOf(capture: Capture): number | null {
  const runs = capture.segments
    .filter((s) => s.type === "run" && s.duration_s > 0)
    .map((s) => s.duration_s);
  if (runs.length < 2) return null;
  return runs[runs.length - 1] / runs[0];
}

/**
 * Why a benchmark cannot support a confident label.
 *
 * A submaximal test was run at controlled effort, so pacing means nothing. An
 * aborted one is missing points from the fade curve. A field or substituted
 * variant cannot be compared across variants, so the limiter is not locatable.
 */
export function confidenceOf(capture: Capture, variantSubstituted = false): "high" | "low" {
  if (capture.submaximal || capture.completion.aborted) return "low";
  if (capture.variant === "field" || variantSubstituted) return "low";
  return "high";
}

/**
 * The archetype for a benchmark, or null if there is not one.
 *
 * Never derived without a benchmark. A self-reported 5 km cannot locate a
 * limiter and intake answers produce neither durability nor pacing, so the
 * honest answer is nothing at all and a prompt to take the test.
 */
export function archetypeOf(
  capture: Capture | null,
  benchmarkId: string | null,
  derivedAt: string,
  previous?: Capture,
): Archetype | null {
  if (!capture || !benchmarkId) return null;

  const readings = read(capture, previous);
  const limiter = bandOf(readings, "Limiter");
  const durability = bandOf(readings, "Durability");
  const pacing = bandOf(readings, "Pacing");
  const fade = fadeOf(capture);

  /**
   * The brief names `front-loaded` for fast_start, but the findings layer splits
   * "quicker out than the rest" into two bands — front-loaded above 3%, and
   * positive splitter above 8%. A positive splitter is more front-loaded, not
   * less, so excluding it would deny fast_start to exactly the athletes it
   * describes best. Both count.
   */
  const wentOutQuick = pacing === "front-loaded" || pacing === "positive splitter";

  const matches = new Set<ArchetypeType>();
  if (fade !== null) {
    if (wentOutQuick && fade >= 1.12) matches.add("fast_start");
    if (limiter === "aerobic" && fade >= 1.20) matches.add("thin_engine");
    if (limiter === "strength" && fade < 1.12) matches.add("strong_runner");
    if (limiter === "balanced" && fade < 1.12) matches.add("even_keel");
    if (limiter === "balanced" && fade >= 1.20) matches.add("both_ends");
  }

  // Nothing matched, so even_keel at low confidence rather than null: once a
  // benchmark exists there is always something to say.
  const type = PRECEDENCE.find((t) => matches.has(t));
  const stamp = (value: string | null): Dimension | null =>
    value === null ? null : { value, source: "benchmark", as_of: capture.started_at };

  return {
    type: type ?? "even_keel",
    derived_at: derivedAt,
    source_benchmark_id: benchmarkId,
    confidence: type ? confidenceOf(capture) : "low",
    derivation_version: DERIVATION_VERSION,
    contributing: contributingFor(type ?? "even_keel", readings),
    dimensions: {
      limiter: stamp(limiter),
      durability: stamp(durability),
      pacing: stamp(pacing),
    },
  };
}

/**
 * The readings behind a type, in the order they carried it.
 *
 * Named by dimension rather than by index: a finding list re-sorts by priority,
 * and an index into it would silently point at a different reading next time.
 */
function contributingFor(type: ArchetypeType, readings: Reading[]): string[] {
  const order: Record<ArchetypeType, string[]> = {
    fast_start: ["Pacing", "Durability"],
    thin_engine: ["Limiter", "Durability"],
    strong_runner: ["Limiter", "Durability"],
    both_ends: ["Limiter", "Durability"],
    even_keel: ["Limiter", "Durability"],
  };
  return order[type].filter((d) => readings.some((r) => r.dim === d));
}

// -------------------------------------------------------------- recomputation

/**
 * Applying a fresh read of the run half.
 *
 * The station half is frozen for the life of the block. `limiter` compares run
 * degradation with station degradation, and nothing after the benchmark
 * measures stations — so it keeps `source: 'benchmark'` and its original
 * `as_of` however many key sessions go by. Letting it drift on run data alone
 * would make it a statement about running wearing the word limiter.
 *
 * `durability` and `pacing` are both computable from key-session reps, so they
 * are stamped `key_sessions` with a current date.
 */
export function recompute(
  current: Archetype,
  fromKeySessions: { durability?: string; pacing?: string },
  at: string,
): { archetype: Archetype; changed: boolean } {
  const dims = { ...current.dimensions };
  if (fromKeySessions.durability) {
    dims.durability = { value: fromKeySessions.durability, source: "key_sessions", as_of: at };
  }
  if (fromKeySessions.pacing) {
    dims.pacing = { value: fromKeySessions.pacing, source: "key_sessions", as_of: at };
  }
  // limiter deliberately untouched

  const next: Archetype = { ...current, dimensions: dims, derived_at: at };
  return { archetype: next, changed: false };
}

/**
 * Does this type describe a materially different plan?
 *
 * The validation that keeps the feature honest: every type has to map to a
 * different set of plan changes that the benchmark already produced. Two types
 * with identical change lists are one type with two names.
 */
export const changeShape = (changes: Change[]) =>
  [...new Set(changes.map((c) => c.label))].sort().join("|");
