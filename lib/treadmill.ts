/**
 * When the watch cannot tell us the one thing that mattered.
 *
 * A treadmill run arrives as a single total distance. Indoors there is no GPS, so that distance
 * is the machine's or the athlete's correction of it, while the splits and laps are the watch
 * guessing from wrist movement — hers was 1.6x out. And even with a perfect distance, nothing in
 * the file says where the work was: a 2 km time trial inside a 4.2 km session, with the watch's
 * automatic mile splits as the only laps, cannot be found. `classifySegments` wants four usable
 * laps and a clear speed gap before it will call anything a rep, and a single continuous time
 * trial can never satisfy that.
 *
 * The number is not lost, though. It is on the console she is standing in front of. This module
 * decides when to ask for it.
 */

/** Strava's names for a run that went nowhere. */
export function isTreadmill(sportType: string | null | undefined, trainer: unknown): boolean {
  if (trainer === true || trainer === "true") return true;
  return /virtual|treadmill|indoor/i.test(sportType ?? "");
}

export type WorkShape =
  /** one continuous effort — a time trial: ask for the finish time */
  | { kind: "single"; distanceM: number; targetSeconds: number | null }
  /** repeats — ask for a belt speed, or a time per rep */
  | { kind: "reps"; count: number; distanceM: number; targetSeconds: number | null };

/**
 * Why we are asking, or null when we are not.
 *
 * Deliberately conservative on two counts. A session with no stated work has nothing to report,
 * and a run with laps that match what was prescribed already told us — asking then is noise, and
 * noise is how a prompt that matters gets dismissed by reflex.
 */
export function needsWorkReport(opts: {
  shape: WorkShape | null;
  treadmill: boolean;
  /** usable laps on the paired activity */
  lapCount: number;
  /** summary distance vs the sum of the lap distances, where both are known */
  summaryM?: number | null;
  lapSumM?: number | null;
  alreadyReported: boolean;
  declined: boolean;
}): { why: string } | null {
  const { shape, treadmill, lapCount, summaryM, lapSumM, alreadyReported, declined } = opts;
  if (!shape || alreadyReported || declined) return null;

  const wanted = shape.kind === "reps" ? shape.count : 1;

  /*
   * The distances disagree, so every pace derived from the laps is suspect — which is the
   * treadmill case even when nothing says "trainer", and the one that produced a 2 km time
   * trial on file at 8:41/km when she had run it at 5:26.
   */
  const mismatched = summaryM != null && lapSumM != null && lapSumM > 0
    && Math.abs(summaryM / lapSumM - 1) > 0.02;

  if (mismatched) return { why: "the distances on this one do not agree" };
  if (treadmill) return { why: "a treadmill only tells us your total distance" };
  /*
   * Not a treadmill and the distances agree, but the laps cannot describe the session: six
   * prescribed reps and two laps on file is a watch that was never lapped.
   */
  if (lapCount < wanted) return { why: "we cannot see the reps in what your watch recorded" };
  return null;
}

/** A belt speed is the number on the machine; a pace is the number in the plan. */
export const paceFromSpeed = (kmh: number): number => (kmh > 0 ? 3600 / kmh : 0);
export const speedFromPace = (secPerKm: number): number => (secPerKm > 0 ? 3600 / secPerKm : 0);

/** Seconds for one rep of `distanceM` held at `kmh`. */
export function secondsFor(distanceM: number, kmh: number): number {
  return Math.round((distanceM / 1000) * paceFromSpeed(kmh));
}

/** What one reported rep says the pace was, in seconds per kilometre. */
export function paceOfReport(distanceM: number, seconds: number): number | null {
  if (!distanceM || !seconds) return null;
  return Math.round(seconds / (distanceM / 1000));
}

/**
 * What the session asks for, read off its own prescription.
 *
 * The title carries the pace — that is where `prescribedPace` reads it and where the calibration
 * engine reads it from — and the target carries the shape. Between them: how many efforts, how
 * long each one is, and what it was meant to take, which is what the input can be pre-filled
 * with so she corrects a number rather than composing one.
 */
export function workShapeOf(title: string, target: string | null): WorkShape | null {
  const lines = (target ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const paceOf = (s: string): number | null => {
    const band = s.match(/@\s*(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)/);
    if (band) {
      const a = Number(band[1]) * 60 + Number(band[2]);
      const b = Number(band[3]) * 60 + Number(band[4]);
      return Math.round((a + b) / 2);
    }
    const one = s.match(/@\s*(\d{1,2}):([0-5]\d)/);
    return one ? Number(one[1]) * 60 + Number(one[2]) : null;
  };
  const distOf = (s: string): number | null => {
    const km = s.match(/([\d.]+)\s*km/i);
    if (km) return Math.round(Number(km[1]) * 1000);
    const m = s.match(/(\d{3,5})\s*m\b/i);
    return m ? Number(m[1]) : null;
  };

  const reps = lines.map((l) => l.match(/^-\s*(\d+)x$/)).find(Boolean);
  const count = reps ? Number(reps[1]) : 0;

  // A time trial first: it is one effort, and it is the case the laps can never describe.
  const tt = lines.find((l) => /time trial/i.test(l));
  if (tt) {
    const d = distOf(tt);
    if (!d) return null;
    const pace = paceOf(title) ?? paceOf(tt);
    return { kind: "single", distanceM: d, targetSeconds: pace ? Math.round((d / 1000) * pace) : null };
  }

  if (count > 1) {
    /*
     * The rep is the line with a pace on it that is not the warm-up or the cool down. A
     * time-based rep — "3 min Z2 @ 6:30-7:00/km" — is left alone: she ran for three minutes
     * whatever the belt was doing, so there is no unknown to fill in.
     */
    const rep = lines.find((l) => /@/.test(l) && !/warm up|cool down|walk/i.test(l) && !/\bmin\b/.test(l));
    const d = rep ? distOf(rep) : null;
    if (!rep || !d) return null;
    const pace = paceOf(rep) ?? paceOf(title);
    return {
      kind: "reps", count, distanceM: d,
      targetSeconds: pace ? Math.round((d / 1000) * pace) : null,
    };
  }
  return null;
}
