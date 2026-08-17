import type { Resolved } from "./resolve";

/**
 * Stage 2: the volume curve, its deloads, and the phases.
 *
 * Pure, and the part of the generator that carries most of the value on its own.
 * A correct curve with boring sessions is a usable plan; brilliant sessions on a
 * wrong curve are not.
 */

export type PhaseName = "base" | "build" | "specific" | "taper";

export type Week = {
  n: number;
  km: number;
  phase: PhaseName;
  deload: boolean;
  taper: boolean;
  note: string;
};

const DELOAD = 0.70;
export const TAPER = [0.75, 0.45]; // last-1, last

/** Which taper factor a week gets, or null where it is not a taper week. */
export const taperFactor = (n: number, length: number): number | null =>
  (n > length - TAPER.length ? TAPER[TAPER.length - (length - n) - 1] ?? null : null);

/**
 * Where the down weeks go.
 *
 * By block length rather than `w mod 4`, because a fixed fourth week puts three
 * low weeks into a ten-week plan. The rule is that no run of loading weeks may
 * exceed max_block.
 *
 * The taper absorbs the final down week, so a deload is kept away from it where
 * the block constraint allows — for a novice on a three-week block it does not,
 * and the constraint wins. A deload next to the taper is a smaller mistake than
 * four loading weeks on someone who can take three.
 */
export function deloadWeeks(length: number, maxBlock: number): number[] {
  const taperFrom = Math.max(1, length - 1); // the last two weeks taper
  const loadingEnd = taperFrom - 1;          // last week that can load or deload
  if (loadingEnd < 1) return [];

  const out: number[] = [];
  let run = 0;
  for (let w = 1; w <= loadingEnd; w++) {
    // the deload is the week AFTER the block, not the last week of it: a block
    // of five means five loading weeks and then one down
    if (run >= maxBlock) { out.push(w); run = 0; continue; }
    run++;
  }
  return out;
}

/** 30 / 30 / 25 / 15, at least one week each. Under six weeks there is no base. */
export function phases(length: number): { phases: PhaseName[]; flags: string[] } {
  const flags: string[] = [];
  const names: PhaseName[] = ["base", "build", "specific", "taper"];

  if (length < 6) {
    // Too short to build anything: what is left is sharpening what is there.
    flags.push(
      `${length} weeks is too short for a base phase. This sharpens what you already have rather than building anything new.`,
    );
    const out: PhaseName[] = [];
    const taper = Math.min(2, Math.max(1, Math.round(length * 0.15) || 1));
    const specific = Math.max(1, Math.round((length - taper) / 2));
    for (let i = 0; i < length - taper - specific; i++) out.push("build");
    for (let i = 0; i < specific; i++) out.push("specific");
    for (let i = 0; i < taper; i++) out.push("taper");
    return { phases: out.slice(0, length), flags };
  }

  const share = [0.30, 0.30, 0.25, 0.15];
  const counts = share.map((s) => Math.max(1, Math.round(length * s)));
  // rounding can overshoot or undershoot; the base phase gives and takes
  let total = counts.reduce((a, b) => a + b, 0);
  while (total > length) { counts[0] -= 1; total--; }
  while (total < length) { counts[0] += 1; total++; }

  const out: PhaseName[] = [];
  counts.forEach((n, i) => { for (let k = 0; k < n; k++) out.push(names[i]); });
  return { phases: out, flags };
}

/**
 * The curve.
 *
 * Loading weeks compound from the previous *loading* week, so a down week does
 * not reset the progression — a week-9 peak below week 7 is what happens when
 * it does.
 */
export function skeleton(r: Resolved, length: number): { weeks: Week[]; flags: string[] } {
  const ph = phases(length);
  const downs = new Set(deloadWeeks(length, r.max_block));
  const weeks: Week[] = [];

  let working = r.start_volume;
  for (let n = 1; n <= length; n++) {
    const isTaper = n > length - TAPER.length;
    const isDeload = !isTaper && downs.has(n);

    if (n > 1 && !isDeload && !isTaper) working = working * (1 + r.ramp_rate);
    working = Math.min(working, r.peak_ceiling);

    const factor = isTaper ? TAPER[TAPER.length - (length - n) - 1] : isDeload ? DELOAD : 1;
    weeks.push({
      n,
      km: Math.max(3, Math.round(working * factor * 10) / 10),
      phase: ph.phases[n - 1],
      deload: isDeload,
      taper: isTaper,
      note: isTaper
        ? (n === length ? "Race week" : "Taper")
        : isDeload ? "Down week" : "",
    });
  }
  /**
   * Race week is clamped to 40% of the peak.
   *
   * The brief gives a taper factor of 0.45 for the final week AND a validation
   * assertion that race week is at most 40% of peak. Off a peak reached in the
   * last loading week those disagree — 0.45 of it is 45%. The assertion wins,
   * because a plan that fails one is never shipped, and the taper factor is a
   * default rather than a promise.
   */
  const peak = Math.max(...weeks.map((w) => w.km));
  const last = weeks[weeks.length - 1];
  // floored, not rounded: rounding 40% of 51.4 up to 20.6 puts race week at
  // 40.1% and fails the very assertion this clamp exists to satisfy
  if (last && last.km > peak * 0.4) last.km = Math.max(3, Math.floor(peak * 0.4 * 10) / 10);

  return { weeks, flags: ph.flags };
}
