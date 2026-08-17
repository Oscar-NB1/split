/**
 * Am I ahead of the plan, behind it, or on it?
 *
 * A pure function, deliberately. The architecture note makes the case better
 * than I would: *"keep it deterministic — the same signals must always produce
 * the same verdict, because you will be asked 'why did it say that' and a model
 * cannot answer for arithmetic it did not do."*
 *
 * So no model touches this. A milestone session produces one signal — how far
 * off prescription the working pace landed — and the read over the last few
 * signals is the verdict.
 */

export type Signal = {
  /** when it happened, YYYY-MM-DD */
  on: string;
  label: string;
  /** interval | time trial | tempo | top set | race — weights differ */
  type: string;
  /** how much this kind of session says about fitness */
  weight: number;
  prescribed: number;
  achieved: number;
  /** -1 when more is better (a lift), +1 when less is (a pace) */
  dir?: number;
  /**
   * What the conditions cost, in seconds per km, where they are known.
   *
   * A session run at 29°C is not evidence that an athlete got slower, and this
   * engine cannot tell the difference on its own: it reads pace against
   * prescription and nothing else. Without this, a hot fortnight recommends
   * slowing a whole plan down — permanently, from a temporary cause.
   *
   * Used in one direction only. A missed target in bad conditions is discounted;
   * a target *beaten* in bad conditions is left exactly as it is, because that is
   * a real signal and arguably a stronger one than the same run in still air.
   */
  conditions_s?: number;
};

export type Read = {
  points: (Signal & { delta: number })[];
  /** recency-weighted average miss, in the signal's own units */
  trend: number;
  /** consecutive signals on the same side of the tolerance band */
  streak: number;
  state: "ahead" | "on" | "behind";
  /** the adjustment to pace targets this justifies, seconds per km */
  shift: number;
  projected: number;
  confidence: "Building" | "Medium" | "High";
  sideWord: string;
};

/** Only the last five milestone sessions describe current fitness. */
export const WINDOW = 5;
/** Each older session counts for 65% of the one after it. */
export const DECAY = 0.65;
/** Inside this many seconds per km, you are on plan, not off it. */
export const BAND = 2;
/** No recommendation until three consecutive sessions agree. */
export const MIN_STREAK = 3;
/** And never move a pace target by more than this. */
export const MAX_SHIFT = 6;

/**
 * The read. `goalSeconds` is the target the projection is measured against.
 *
 * The tolerance band is what stops this being a mood ring: a session two seconds
 * off prescription is noise, and a plan that reacts to noise is worse than one
 * that reacts to nothing.
 */
export function read(signals: Signal[], goalSeconds: number, band = BAND): Read {
  if (signals.length === 0) {
    return {
      points: [], trend: 0, streak: 0, state: "on", shift: 0,
      projected: goalSeconds, confidence: "Building", sideWord: "no milestone sessions yet",
    };
  }

  /*
   * Delta is sign-normalised so negative always means better than prescribed, and
   * discounted for conditions in the slower direction only.
   *
   * Asymmetric on purpose. Crediting a fast run back towards its target would be
   * the app arguing with evidence in its favour; discounting a slow one is the app
   * refusing to draw a conclusion the weather already explains. The discount can
   * only ever pull a delta towards zero — never past it into the opposite verdict.
   */
  const points = signals.map((s) => {
    const raw = (s.achieved - s.prescribed) * (s.dir ?? 1);
    const allowance = s.conditions_s ?? 0;
    return {
      ...s,
      delta: raw > 0 && allowance > 0 ? Math.max(0, raw - allowance) : raw,
    };
  });

  const recent = points.slice(-WINDOW);
  let wSum = 0, dSum = 0;
  recent.forEach((p, i) => {
    const w = p.weight * Math.pow(DECAY, recent.length - 1 - i);
    wSum += w;
    dSum += p.delta * w;
  });
  const trend = wSum > 0 ? dSum / wSum : 0;

  const side = (d: number) => (d <= -band ? -1 : d >= band ? 1 : 0);
  const lastSide = side(points[points.length - 1].delta);
  let streak = lastSide === 0 ? 0 : 1;
  for (let i = points.length - 2; i >= 0 && lastSide !== 0 && side(points[i].delta) === lastSide; i--) {
    streak++;
  }

  // The verdict follows the same evidence as the streak: direction from the run
  // of sessions, magnitude from the weighted trend. Both have to agree, so one
  // freak session cannot move it.
  const state: Read["state"] =
    lastSide === -1 && trend <= -band ? "ahead"
    : lastSide === 1 && trend >= band ? "behind"
    : "on";

  const shift = state === "on" || streak < MIN_STREAK
    ? 0
    : Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Math.round(trend * 0.6)));

  return {
    points, trend, streak, state, shift,
    projected: Math.round(goalSeconds + trend * 8),
    confidence: streak >= 3 ? "High" : streak === 2 ? "Medium" : "Building",
    sideWord: lastSide === -1 ? "beating the plan"
      : lastSide === 1 ? "missing the plan" : "within tolerance",
  };
}

/** mm:ss from seconds, for pace and for time. */
export function clock(sec: number): string {
  const s = Math.round(Math.abs(sec));
  const sign = sec < 0 ? "-" : "";
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "+4 s/km" — a delta, with its sign kept. */
export const secs = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))} s/km`;

/**
 * "8 × 1000 m @ 4:15" → 255 seconds per kilometre.
 *
 * The plan states the prescribed pace in the session title, which is the only
 * place it is written as a number — the intervals.icu target says "1000m Z4",
 * which is a zone, not a pace. A title with no stated pace produces no signal
 * rather than a guessed one.
 */
export function prescribedPace(title: string): number | null {
  const m = title.match(/@\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  // A leading zero means a clock: nobody writes a pace as "04:15", and "@ 09:30"
  // is a start time. Without this, a session titled "Race @ 09:30" reports a
  // 9:30/km prescription and the engine treats the whole race as a huge miss.
  if (m[1].length === 2 && m[1][0] === "0") return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  // and a pace outside 2:00–9:00 per km is a finish time, not a target
  return sec >= 120 && sec <= 540 ? sec : null;
}
