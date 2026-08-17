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
  /**
   * Each work rep's pace, seconds per kilometre.
   *
   * The engine reads a session as one number — the average of its work laps — which
   * is the right way to compare sessions and the wrong way to read one. A set where
   * every rep beat its target is not the same evidence as a set that averaged the
   * same figure by going out fast and hanging on, and the difference is exactly what
   * "am I fitter" turns on.
   *
   * Empty where the laps were not imported, which is why nothing here can be
   * required.
   */
  reps?: number[];
};

/** One session, as the engine read it. */
export type Point = Signal & {
  /**
   * The delta the reps proved, conditions allowed for.
   *
   * Not an average and not a median — see `repRead`. Zero when the set was mixed,
   * which is the honest answer to "how much should the plan move" for an athlete who
   * hit the pace on some reps and not others.
   */
  delta: number;
  /** the set average, which is what the watch showed and what the athlete remembers */
  average: number;
  /** the rep-by-rep breakdown, or null where no laps came through */
  reps_read: RepRead | null;
  /** seconds per km lost across the set, or null with too few reps to tell */
  fade: number | null;
};

export type Read = {
  points: Point[];
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
 * How many reps a single session needs before it can speak on its own.
 *
 * Three. Two reps quicker than target is a good day or a downhill; three or more,
 * every one of them, is a prescription that has stopped describing the athlete —
 * and waiting three sessions to say so means three weeks of training at a pace they
 * have already outgrown.
 */
export const CLEAN_SWEEP_REPS = 3;

/**
 * Whether one session beat its target outright.
 *
 * Every rep, by more than the tolerance band, with no rep slower than prescribed.
 * The last condition is what keeps this honest: a set of five where four flew and
 * one blew up is a pacing story, not a fitness one, and it should wait for the
 * streak like everything else.
 */
export function cleanSweep(s: Signal, band = BAND): boolean {
  const rr = repRead(s, band);
  if (!rr || rr.total < CLEAN_SWEEP_REPS) return false;
  // Conditions do not enter this. They are only ever an excuse for being slow, and
  // a set of reps run faster than target in bad air is stronger evidence, not weaker.
  return rr.behind === 0 && rr.provable <= -band
    && rr.ahead >= Math.ceil(rr.total * MOST);
}

/**
 * What a session proves, rep by rep.
 *
 * No average and no median. Both collapse a set into one number, and the number
 * cannot tell apart the two sessions a coach would read completely differently:
 *
 *   4:05, 4:06, 4:07, 4:30   three reps beat a 4:10 target and one blew up
 *   3:55, 4:05, 4:15, 4:25   went out too hard and lost 30 s/km across the set
 *
 * Their averages are both 4:10 — on plan, apparently, in both cases. The first is an
 * athlete whose prescription is too slow; the second is an athlete who cannot yet
 * hold the prescription they have. A median is better than a mean here and still
 * wrong: it is a single rep standing in for the set.
 *
 * So every rep is compared to what was prescribed, and the session is read from that
 * distribution. The magnitude comes from the **binding rep** — the slowest one, when
 * they all beat the target — because that is the only pace the athlete has actually
 * demonstrated they can hold for the whole set. A plan should move by what every rep
 * supported, not by what the good ones did.
 */
export type RepRead = {
  total: number;
  /** reps quicker than prescribed by more than the band */
  ahead: number;
  /** reps inside the band, either side */
  on: number;
  /** reps slower than prescribed by more than the band */
  behind: number;
  /**
   * The provable delta, in seconds per km, or 0 when the set does not prove one.
   *
   * Negative when every rep beat the target: the slowest of them, because that pace
   * was held on every single rep. Positive when every rep missed it: the quickest of
   * them, for the same reason in reverse. Zero for a mixed set — an athlete who hit
   * the pace on some reps and not others has a durability finding, not a pace one,
   * and easing the target would be answering the wrong question.
   */
  provable: number;
  /** seconds per km lost between the first half of the set and the last */
  fade: number | null;
};

/** Where two thirds of the set has to agree before the set says anything. */
export const MOST = 2 / 3;

export function repRead(s: Signal, band = BAND): RepRead | null {
  const reps = (s.reps ?? []).filter((r) => Number.isFinite(r) && r > 0);
  if (reps.length < 2) return null;

  const dir = s.dir ?? 1;
  const off = reps.map((r) => (r - s.prescribed) * dir);
  const ahead = off.filter((d) => d <= -band).length;
  const behind = off.filter((d) => d >= band).length;
  const on = off.length - ahead - behind;

  /*
   * The binding rep, and why two thirds rather than all of them.
   *
   * Requiring every rep to beat the target means one rep interrupted by a road
   * crossing cancels a session that was otherwise emphatic. Two thirds ahead with
   * none behind is the same finding with room for a set of six to contain a
   * mistake — and the magnitude is still the slowest qualifying rep, so a single
   * flyer cannot inflate it.
   */
  let provable = 0;
  if (behind === 0 && ahead >= Math.ceil(reps.length * MOST)) {
    const qualifying = off.filter((d) => d <= -band);
    provable = Math.max(...qualifying);
  } else if (ahead === 0 && behind >= Math.ceil(reps.length * MOST)) {
    const qualifying = off.filter((d) => d >= band);
    provable = Math.min(...qualifying);
  }

  /*
   * Fade: the back half against the front half.
   *
   * The one place halves are compared rather than reps, because fade is a claim
   * about the shape of the set and not about any rep in it. Reported, never used to
   * move a target — a Hyrox is decided in its back half, and an athlete who faded
   * 20 s/km needs to be told that rather than have their paces quietly adjusted.
   */
  const half = Math.floor(reps.length / 2);
  const fade = reps.length < 4 ? null : Math.round((
    reps.slice(reps.length - half).reduce((n, x) => n + x, 0) / half
    - reps.slice(0, half).reduce((n, x) => n + x, 0) / half) * 10) / 10;

  return { total: reps.length, ahead, on, behind, provable, fade };
}

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
    /*
     * Rep by rep where the laps came through; the one number they gave us where they
     * did not. A lift, or a continuous tempo, genuinely is one effort — the
     * per-rep read applies to sessions that have reps.
     */
    const rr = repRead(s, band);
    const raw = rr ? rr.provable : (s.achieved - s.prescribed) * (s.dir ?? 1);
    const allowance = s.conditions_s ?? 0;
    return {
      ...s,
      delta: raw > 0 && allowance > 0 ? Math.max(0, raw - allowance) : raw,
      /** what the watch showed, for the screen — never what the verdict came from */
      average: s.achieved,
      reps_read: rr,
      fade: rr?.fade ?? null,
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
  /*
   * A clean sweep counts as being ahead on its own.
   *
   * Otherwise the two halves of this disagree: the shift would move on one sweeping
   * session while the state — which is what the screen puts in its headline — still
   * read "on plan", and the athlete would be offered a change to a plan the app had
   * just told them was fine.
   */
  const sweptLast = cleanSweep(points[points.length - 1], band);
  const state: Read["state"] =
    lastSide === -1 && (trend <= -band || sweptLast) ? "ahead"
    : lastSide === 1 && trend >= band ? "behind"
    : "on";

  /*
   * One session can be enough, if it swept.
   *
   * The streak rule exists so a single freak session cannot move a plan, and it is
   * the right default. But a set where every rep came in ahead of target is not a
   * freak session — it is a prescription that has stopped fitting, and making the
   * athlete prove it three times means three more weeks of training at a pace they
   * have already outgrown. The bar is deliberately higher than the streak's:
   * *every* rep, by more than the band, and nothing slower than prescribed.
   *
   * It only ever unlocks the quick direction. Nothing about one bad session
   * justifies making a plan easier on the spot.
   */
  const last = points[points.length - 1];
  const swept = sweptLast && last.delta <= -band;
  const enough = streak >= MIN_STREAK || (swept && lastSide === -1);

  /*
   * The magnitude comes from the least-improved session of the run, not from a
   * weighted mean of them.
   *
   * Same argument as inside a session, one level up: three sessions at −8, −9 and −2
   * average to about −7, and the athlete has only actually demonstrated −2 on all
   * three of them. A plan should move by the amount every piece of evidence supports,
   * so the binding session sets the size exactly as the binding rep does.
   *
   * `trend` is still reported — it is a genuine description of the direction and the
   * screen labels it as one — but nothing is sized from it.
   */
  const run = points.slice(-Math.max(1, streak));
  const sameSide = run.filter((p) => (lastSide === -1 ? p.delta <= -band : p.delta >= band));
  const binding = sameSide.length
    ? sameSide.reduce((a, b) => (Math.abs(a.delta) <= Math.abs(b.delta) ? a : b)).delta
    : last.delta;

  const shift = state === "on" ? 0
    : !enough ? 0
    : Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Math.round(
      (swept && streak < MIN_STREAK ? last.delta : binding) * 0.6)));

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
