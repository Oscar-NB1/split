import { type Capture, type Segment } from "./capture";

/**
 * Reading a benchmark.
 *
 * `capture.ts` records what happened; this says what it means. The split
 * matters because the numbers are facts and the reading is a judgement — the
 * capture can be replayed years later against a changed interpretation, which
 * is not true if the two are computed together.
 *
 * Every dimension is a band table rather than a written case. Copy is templated
 * from the band, so there is one place to change a threshold and no chance of
 * two paragraphs disagreeing about the same number.
 */

export type Severity = "good" | "neutral" | "attention";

export type Reading = {
  dim: string;
  band: string;
  severity: Severity;
  /** what the results screen sorts by: what most needs saying, first */
  priority: number;
  headline: string;
  body: string;
  effect: string;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct1 = (x: number) => Math.round(x * 1000) / 10;

export const mmss = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const durationsOf = (segments: Segment[], type: Segment["type"]) =>
  segments.filter((s) => s.type === type && s.duration_s > 0).map((s) => s.duration_s);

/**
 * Round times as a pace per kilometre where the distance is known.
 *
 * A 400 m leg reported as "1:41" is a duration wearing the word pace; the same
 * leg as "4:12 /km" is comparable with every other pace in the app, which is
 * the only reason to show it at all. Without a distance it stays a duration and
 * is labelled as one.
 */
function paceOf(segments: Segment[]): { text: (s: number) => string; per_km: boolean } {
  const runs = segments.filter((s) => s.type === "run" && s.duration_s > 0);
  const d = runs[0]?.distance_m;
  if (!d || runs.some((r) => r.distance_m !== d)) {
    return { text: (s) => mmss(s), per_km: false };
  }
  return { text: (s) => `${mmss(s * (1000 / d))} /km`, per_km: true };
}

// ------------------------------------------------------------- band tables

/** Fade across the runs — the ratio of the last to the first. */
const DURABILITY = [
  { under: 1.05, band: "strong", severity: "good", tail: "barely fades at all", priority: 40 },
  { under: 1.12, band: "good", severity: "good", tail: "holds well under fatigue", priority: 40 },
  { under: 1.20, band: "moderate", severity: "neutral", tail: "a normal amount of fade for this fitness", priority: 40 },
  { under: 1.30, band: "heavy", severity: "attention", tail: "more fade than the plan should accept", priority: 90 },
  { under: Infinity, band: "severe", severity: "attention", tail: "the session fell apart in the back half", priority: 90 },
] as const;

/**
 * How much quicker round 1 was than the decay trend predicts it should be.
 *
 * Not against the mean of the later rounds, which is what this used to be. That
 * quantity is positive for any fade at all — a perfectly even 5% decay read as
 * "went out quick" — so it conflated going out too hard with simply fading, and
 * every fading athlete was labelled a front-runner.
 */
const PACING = [
  { over: 8, band: "positive splitter", severity: "attention", priority: 95 },
  { over: 3, band: "front-loaded", severity: "neutral", priority: 55 },
  { over: -3, band: "even", severity: "good", priority: 30 },
  { over: -Infinity, band: "conservative", severity: "neutral", priority: 30 },
] as const;

/** Heart-rate fall per transition, in bpm. */
const RECOVERY = [
  { over: 12, band: "fast", severity: "good", note: "You clear work quickly, so short recoveries are usable." },
  { over: 8, band: "moderate", severity: "neutral", note: "Normal clearance. Recoveries stay as written." },
  { over: -Infinity, band: "slow", severity: "attention", note: "Slow clearance — easy days need to be genuinely easy." },
] as const;

/** Mean transition, in seconds. */
const TRANSITIONS = [
  { under: 30, band: "sharp", severity: "good" },
  { under: 45.001, band: "average", severity: "neutral" },
  { under: Infinity, band: "slow", severity: "attention" },
] as const;

/** How far apart the two sides have to fade before one is called the limiter. */
const LIMITER_MARGIN = 0.03;

// ----------------------------------------------------------------- the read

/**
 * What the test found, most important first.
 *
 * A dimension is omitted rather than guessed at when its inputs are missing —
 * an aborted session says nothing about durability, a submaximal one says
 * nothing about pacing, and no heart-rate stream says nothing about recovery.
 * Silence is the honest output; a neutral band would read as a measurement.
 */
export function read(capture: Capture, previous?: Capture): Reading[] {
  const runs = durationsOf(capture.segments, "run");
  if (runs.length < 2) return [];

  const out: Reading[] = [];
  const aborted = capture.completion.aborted;
  const fade = runs[runs.length - 1] / runs[0];

  if (!aborted) {
    const d = DURABILITY.find((b) => fade < b.under)!;
    out.push({
      dim: "Durability", band: d.band, severity: d.severity, priority: d.priority,
      headline: `You faded ${pct1(fade - 1)}% across ${runs.length} rounds`,
      body: `Round 1 ran ${mmss(runs[0])} and round ${runs.length} ran ${mmss(runs[runs.length - 1])} — ${d.tail}.`,
      effect: d.severity === "attention"
        ? "Second quality session becomes a fatigue-resistance set rather than pure speed."
        : "Quality work stays as prescribed.",
    });
  }

  const front = frontLoading(runs);
  if (!capture.submaximal && front !== null) {
    const p = PACING.find((b) => front > b.over)!;
    out.push({
      dim: "Pacing", band: p.band, severity: p.severity, priority: p.priority,
      headline: front > 3 ? `Round 1 was ${front}% quicker than the rest` : "You paced it evenly",
      body: front > 8
        ? "That is the pattern that costs a race: the opening round is bought with the closing two. Pace targets are written to be held, not opened with."
        : front > 3
          ? "Slightly quick out, then settled. Worth noting rather than fixing."
          : `Round 1 sits within ${Math.abs(front)}% of where the rest of the session says it should have been, which is what a rehearsed race looks like.`,
      effect: front > 8 ? "Key sessions get a capped opening rep." : "No change.",
    });
  }

  const stations = durationsOf(capture.segments, "station");
  if (stations.length >= 2 && !aborted) {
    const stationFade = stations[stations.length - 1] / stations[0];
    const gap = fade - stationFade;
    const [band, headline] =
      gap > LIMITER_MARGIN ? ["aerobic", "Running is the limiter"]
      : gap < -LIMITER_MARGIN ? ["strength", "Station strength is the limiter"]
      : ["balanced", "Neither side dominates"];
    out.push({
      dim: "Limiter", band, severity: "neutral", priority: 70,
      headline,
      body: `Runs slowed ${Math.round((fade - 1) * 100)}% while the stations slowed ${Math.round((stationFade - 1) * 100)}%. ` +
        (band === "aerobic" ? "Your engine gives way before your strength does."
          : band === "strength" ? "Your strength gives way before your engine does."
          : "The two degrade together."),
      effect: band === "aerobic" ? "Split shifts toward running volume."
        : band === "strength" ? "Split shifts toward station work." : "Split unchanged.",
    });
  }

  const drops = hrDrops(capture);
  if (drops.length > 0) {
    const drop = mean(drops);
    const r = RECOVERY.find((b) => drop > b.over)!;
    out.push({
      dim: "Recovery", band: r.band, severity: r.severity, priority: 35,
      headline: `Heart rate drops ${Math.round(drop)} bpm per transition`,
      body: `Measured across ${drops.length} transitions. ${r.note}`,
      effect: r.band === "slow" ? "Easy-run heart-rate ceiling lowered." : "Recovery intervals unchanged.",
    });
  }

  // A derived transition is a guess at where a gap was, so it is never read as
  // a measurement of roxzone — the one thing that only a pressed lap can say.
  const transitions = capture.segments
    .filter((s) => s.type === "transition" && !s.low_confidence && s.duration_s > 0)
    .map((s) => s.duration_s);
  if (transitions.length > 0) {
    const t = mean(transitions);
    const b = TRANSITIONS.find((x) => t < x.under)!;
    out.push({
      dim: "Transitions", band: b.band, severity: b.severity, priority: 45,
      headline: `Transitions averaged ${Math.round(t)} seconds`,
      body: b.band === "sharp" ? "Nothing to find here."
        : `Across eight transitions on race day that is ${mmss(t * 8)} standing still.`,
      effect: b.band === "sharp" ? "Roxzone target held." : "Every station session times its transitions.",
    });
  }

  const pace = mean(runs);
  const as = paceOf(capture.segments);
  const prevRuns = previous ? durationsOf(previous.segments, "run") : [];
  if (prevRuns.length >= 2) {
    const before = mean(prevRuns);
    const delta = pct1((before - pace) / before);
    out.push({
      dim: "Speed", band: delta > 0 ? "improving" : "flat",
      severity: delta > 0 ? "good" : "neutral", priority: 100,
      headline: `${Math.abs(delta)}% ${delta > 0 ? "faster" : "slower"} than last time`,
      body: `Average round pace moved from ${as.text(before)} to ${as.text(pace)}, and fade came in from ` +
        `${Math.round((prevRuns[prevRuns.length - 1] / prevRuns[0] - 1) * 100)}% to ${Math.round((fade - 1) * 100)}%.`,
      effect: "Every pace target rewritten from the new numbers.",
    });
  } else {
    out.push({
      dim: "Speed", band: "measured", severity: "neutral", priority: 20,
      headline: `Average round pace ${as.text(pace)}`,
      body: "First test, so this is a starting point rather than a verdict. The next one tells you whether it is moving.",
      effect: "Pace anchor replaced with a measured number.",
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/** Fall in heart rate across each recorded transition. */
function hrDrops(capture: Capture): number[] {
  const series = capture.hr.series;
  if (!series?.length) return [];
  const at = (t: number) => {
    let best = series[0];
    for (const s of series) if (Math.abs(s.t_offset_s - t) < Math.abs(best.t_offset_s - t)) best = s;
    return best.bpm;
  };
  return capture.segments
    .filter((s) => s.type === "transition" && s.duration_s > 0)
    .map((s) => at(s.offset_s) - at(s.offset_s + s.duration_s))
    .filter((d) => d > 0);
}

// ------------------------------------------------- from the test to the plan

/**
 * Why each plan line moved.
 *
 * A number that changes without a reason is not trustworthy, so every line the
 * regeneration rewrites names the dimension that moved it, the rule that did
 * the moving, and what that feels like in a session. The rule is stated in
 * full: "faster because you were faster" explains nothing.
 */
export const RULES: Record<string, { dim: string; rule: string; feel: string }> = {
  "Key session pace": {
    dim: "Speed",
    rule: "Key sessions are written at measured average round pace, not at fresh 5 km pace.",
    feel: "Tuesday reps should feel repeatable — the last one at the same pace as the first.",
  },
  "Easy run pace": {
    dim: "Recovery",
    rule: "Easy pace sits 90 seconds slower than measured race pace, capped by your heart-rate ceiling.",
    feel: "Slower than you think it should be. That is the point of it.",
  },
  "Long run pace": {
    dim: "Durability",
    rule: "Long-run pace only moves once fade is under 12%, so distance is not bought with form.",
    feel: "Unchanged until the fade curve flattens.",
  },
  "Station share": {
    dim: "Limiter",
    rule: "Whichever side degraded faster in the test takes points from the other.",
    feel: "One more station block a week, or one fewer, depending on which way it moved.",
  },
  "Roxzone target": {
    dim: "Transitions",
    rule: "Eight transitions at 20% under your measured average — arithmetic, not a round number.",
    feel: "Every station session now runs a clock between stations.",
  },
  "Week 1 volume": {
    dim: "Durability",
    rule: "Volume only rises when fade improves; a heavy fade holds it where it is.",
    feel: "The week looks similar, but the quality inside it changes.",
  },
  "Quality sessions": {
    dim: "Recovery",
    rule: "A third quality session unlocks when heart rate clears fast between efforts.",
    feel: "A hard day is added only if recovery says you can absorb it.",
  },
};

export type Change = {
  label: string; before: string; after: string;
  dim: string; band: string; headline: string; rule: string; feel: string;
};

/**
 * The lines that actually moved, each carrying its reason.
 *
 * Unchanged lines are dropped: a diff of fourteen rows where seven say the same
 * thing on both sides buries the seven that matter.
 */
export function changes(
  before: Record<string, string>, after: Record<string, string>, readings: Reading[],
): Change[] {
  const out: Change[] = [];
  for (const label of Object.keys(after)) {
    if (before[label] === after[label]) continue;
    const rule = RULES[label];
    const from = rule ? readings.find((r) => r.dim === rule.dim) : undefined;
    out.push({
      label, before: before[label] ?? "—", after: after[label],
      dim: rule?.dim ?? "—", band: from?.band ?? "—",
      headline: from?.headline ?? "",
      rule: rule?.rule ?? "", feel: rule?.feel ?? "",
    });
  }
  return out;
}

/**
 * Front-loading: round 1 against the trend of the rounds after it.
 *
 * A straight line is fitted through rounds 2..n and extrapolated back to round
 * 1. If the athlete actually ran round 1 faster than that line predicts, they
 * went out quicker than their own decay accounts for — which is the thing worth
 * knowing, and is independent of how much they faded.
 *
 * Returns null below three rounds: two points define the line exactly, leaving
 * nothing for round 1 to be compared against.
 */
export function frontLoading(runs: number[]): number | null {
  const later = runs.slice(1);
  if (later.length < 2) return null;

  // least squares over (index, duration), indices 2..n
  const xs = later.map((_, i) => i + 2);
  const mx = mean(xs), my = mean(later);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < later.length; i++) {
    sxy += (xs[i] - mx) * (later[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const predicted = my + slope * (1 - mx);
  // A trend implying a non-positive round 1 is not a trend worth extrapolating.
  if (predicted <= 0) return null;

  return pct1((predicted - runs[0]) / predicted);
}
