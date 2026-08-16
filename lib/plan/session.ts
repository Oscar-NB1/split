/**
 * What a session actually contains: warm-up, the work, and the way out of it.
 *
 * The generator was naming sessions and sizing them, and nothing else. "4 × 8 min"
 * arrived at the athlete as a title with 7.4 km beside it and an empty screen
 * underneath — no warm-up, no rest between reps, no cool-down, and a distance that
 * came from dividing the week's volume rather than from what was in the session. Two
 * different sessions came out identical because the arithmetic never looked at them.
 *
 * This writes the prescription instead, in the intervals.icu syntax the app already
 * parses and the watch already understands, and reports what that prescription
 * actually costs in distance and time. One source, so the screen, the watch and the
 * weekly total cannot disagree.
 *
 * Pure: a label and a pace in, lines and totals out.
 */

/** What the ladder rung asks for, once read. */
export type Work =
  | { shape: "reps"; reps: number; metres: number }
  | { shape: "reps_time"; reps: number; seconds: number }
  | { shape: "continuous"; seconds: number }
  | { shape: "alternating"; reps: number; onSeconds: number; offSeconds: number }
  | { shape: "strides"; reps: number; metres: number }
  | { shape: "station" };

export type Built = {
  /** intervals.icu lines, one per step */
  target: string;
  km: number;
  minutes: number;
  /**
   * What the session is called once the week has had its say.
   *
   * A trimmed session is a different session — "4 × 800 m", not "6 × 800 m" — and
   * a title that still claims six is a plan telling the athlete to do something
   * the prescription underneath does not contain.
   */
  title?: string;
};

const WARMUP_KM = 2;
const COOLDOWN_KM = 1.6;
/** Rest between reps, by how long the rep is. Longer reps earn longer rests. */
const restFor = (workSeconds: number) =>
  workSeconds >= 600 ? 180 : workSeconds >= 300 ? 150 : workSeconds >= 120 ? 120 : 90;

/**
 * Read a rung label.
 *
 * The ladders write them for a human — "6 × 800 m", "3 × 15 min", "6 × (3 min run /
 * 1 min walk)" — and this is the one place that turns them back into numbers. A
 * label it cannot read is a session with no reps rather than a wrong session.
 */
export function readRung(label: string): Work | null {
  const s = label.toLowerCase().replace(/×/g, "x").trim();

  const alt = s.match(/^(\d+)\s*x\s*\(\s*(\d+)\s*min\s*run\s*\/\s*(\d+)\s*min\s*walk\s*\)/)
    ?? s.match(/^(\d+)\s*x\s*\((\d+)\s*\/\s*(\d+)\)/);
  if (alt) {
    return {
      shape: "alternating", reps: Number(alt[1]),
      onSeconds: Number(alt[2]) * 60, offSeconds: Number(alt[3]) * 60,
    };
  }

  const repsM = s.match(/^(\d+)\s*x\s*(\d+)\s*m\b/);
  if (repsM) {
    const reps = Number(repsM[1]), metres = Number(repsM[2]);
    return metres <= 300
      ? { shape: "strides", reps, metres }
      : { shape: "reps", reps, metres };
  }

  const repsT = s.match(/^(\d+)\s*x\s*(\d+)\s*min\b/);
  if (repsT) return { shape: "reps_time", reps: Number(repsT[1]), seconds: Number(repsT[2]) * 60 };

  const cont = s.match(/^(\d+)\s*min\b/);
  if (cont) return { shape: "continuous", seconds: Number(cont[1]) * 60 };

  if (/^strides/.test(s)) return { shape: "strides", reps: 6, metres: 100 };
  // Compromised running, transitions, simulations: station work, not a run ladder.
  if (/running|transition|simulation/.test(s)) return { shape: "station" };
  return null;
}

const km1 = (n: number) => Math.round(n * 10) / 10;

/** One more rep every other week, to a ceiling of three added. */
function grow(work: Work | null, progress: number): Work | null {
  if (!work || progress <= 0) return work;
  const extra = Math.min(3, Math.floor(progress / 2));
  if (extra === 0) return work;
  if (work.shape === "reps" || work.shape === "strides" || work.shape === "reps_time"
      || work.shape === "alternating") {
    return { ...work, reps: work.reps + extra };
  }
  if (work.shape === "continuous") {
    return { ...work, seconds: work.seconds + extra * 300 };
  }
  return work;
}

/** Seconds per kilometre as a pace anybody can read. */
const paceOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
/** The pace target as it is written into the prescription. */
const at = (s: number) => `@ ${paceOf(s)}/km`;
const between = (a: number, b: number) => `@ ${paceOf(a)}-${paceOf(b)}/km`;

/**
 * How much slower than critical velocity each kind of running is.
 *
 * The same table the pace module hangs off, restated here only as the two numbers
 * this file needs: easy running and the jog between reps.
 */
const EASY = 1.30;
const RECOVERY_JOG = 1.42;

/**
 * Fit the work inside what the week can afford.
 *
 * The ladder decides what kind of session this is; the week decides how much of it
 * there is room for. Without this a race week of 21.8 km was handed a 12.6 km
 * interval session, because the session was sized from the rung alone and the rung
 * knows nothing about the week it lands in. Reps come off the end, never below two —
 * a single rep is a different session, not a smaller one.
 */
function trim(work: Work | null, paceS: number, maxKm: number): Work | null {
  if (!work || maxKm === Infinity) return work;
  const room = Math.max(1, maxKm - WARMUP_KM - COOLDOWN_KM);

  /*
   * Fewer reps first; shorter reps only when two of them still will not fit.
   *
   * Two is the floor — one rep is a different session — so in a race week the reps
   * themselves have to come down. 2 × 15 min becomes 2 × 8 min rather than a
   * session that quietly overruns the week it is in.
   */
  if (work.shape === "reps" || work.shape === "strides") {
    const per = work.metres / 1000;
    const fit = Math.max(2, Math.min(work.reps, Math.floor(room / per)));
    if (fit > 2 || per * 2 <= room) return { ...work, reps: fit };
    const metres = Math.max(200, Math.round(((room / 2) * 1000) / 100) * 100);
    return { ...work, reps: 2, metres };
  }
  if (work.shape === "reps_time") {
    const per = work.seconds / paceS;
    const fit = Math.max(2, Math.min(work.reps, Math.floor(room / per)));
    if (fit > 2 || per * 2 <= room) return { ...work, reps: fit };
    const seconds = Math.max(180, Math.round(((room / 2) * paceS) / 60) * 60);
    return { ...work, reps: 2, seconds };
  }
  if (work.shape === "continuous") {
    const seconds = Math.min(work.seconds, Math.max(600, room * paceS));
    return { ...work, seconds: Math.round(seconds / 60) * 60 };
  }
  if (work.shape === "alternating") {
    const per = work.onSeconds / paceS;
    const fit = Math.max(2, Math.min(work.reps, Math.floor(room / per)));
    return { ...work, reps: fit };
  }
  return work;
}
const doseKm = (km: number) => (km >= 1 ? `${km1(km)}km` : `${Math.round(km * 1000)}m`);

/**
 * A quality run, written out.
 *
 * The pace decides the distance where the work is measured in time: fifteen minutes
 * at threshold is about 3.5 km for one athlete and 4.2 km for another, and inventing
 * a single number for both is how "2 × 15 min" ended up as 13.4 km.
 */
/**
 * How fast each ladder's work is, relative to critical velocity.
 *
 * Both quality sessions in a week were written at the same number, so a threshold
 * session and a VO2 session — different stimuli, the whole reason for having two —
 * were the same run twice. Threshold sits above CV pace, neuromuscular below it.
 */
export const LADDER_PACE: Record<string, number> = {
  L1: 1.20, L2: 1.14, L3: 1.06, L4: 1.00, L5: 0.90, L6: 1.04,
};

export function qualityRun(
  label: string, paceS: number, easyS: number, maxKm = Infinity, progress = 0,
  ladder = "L4",
): Built {
  const workPace = Math.round(paceS * (LADDER_PACE[ladder] ?? 1));
  /*
   * The same session, done more of, until the rung itself moves.
   *
   * Weeks one to four were "4 × 8 min" every Monday: the ladder rung was pinned by
   * the phase cap, and nothing else varied. Progression inside a rung is what a
   * coach actually writes — four reps, then five, then six — and the week's own
   * ceiling still decides whether there is room for it.
   */
  const work = trim(grow(readRung(label), progress), paceS, maxKm);
  /*
   * Every step carries its pace.
   *
   * The prescription used to say "8m Z4" and leave the screen to find a pace from
   * somewhere else, which meant the watch could not be sent anything and a step
   * with no pace of its own — a walking recovery — was indistinguishable from a
   * step whose pace had simply gone missing.
   */
  const easyPace = Math.round(paceS * EASY);
  const lines: string[] = [
    `- ${doseKm(WARMUP_KM)} Z2 warm up ${between(easyPace, Math.round(easyPace * 1.08))}`,
  ];
  let workKm = 0;
  let workSeconds = 0;

  if (!work || work.shape === "station") {
    // Nothing readable in the label: say what is known rather than inventing reps.
    return continuousRun(Math.round((WARMUP_KM + 5) * 10) / 10, easyS, "Z3");
  }

  let title: string | undefined;
  if (work.shape === "reps" || work.shape === "strides") {
    const rest = work.shape === "strides" ? 60 : restFor((work.metres / 1000) * paceS);
    title = `${work.reps} × ${work.metres} m`;
    const repPace = work.shape === "strides" ? Math.round(paceS * 0.88) : workPace;
    lines.push(`- ${work.reps}x`);
    lines.push(`- ${work.metres}m ${work.shape === "strides" ? "Z5" : "Z4"} ${at(repPace)}`);
    // A walking recovery has no pace, and saying so is the honest instruction.
    lines.push(`- ${rest}s Z1 walk`);
    workKm = (work.metres / 1000) * work.reps;
    workSeconds = work.reps * ((work.metres / 1000) * paceS + rest);
  } else if (work.shape === "reps_time") {
    const rest = restFor(work.seconds);
    title = `${work.reps} × ${Math.round(work.seconds / 60)} min`;
    lines.push(`- ${work.reps}x`);
    lines.push(`- ${Math.round(work.seconds / 60)}m ${ladder === "L3" ? "Z3" : "Z4"} ${at(workPace)}`);
    lines.push(`- ${rest}s Z1 jog ${at(Math.round(paceS * RECOVERY_JOG))}`);
    workKm = (work.seconds / workPace) * work.reps;
    workSeconds = work.reps * (work.seconds + rest);
  } else if (work.shape === "continuous") {
    title = `${Math.round(work.seconds / 60)} min continuous`;
    lines.push(`- ${Math.round(work.seconds / 60)}m Z3 ${at(Math.round(paceS * 1.06))}`);
    workKm = work.seconds / workPace;
    workSeconds = work.seconds;
  } else {
    const rounds = work.reps;
    lines.push(`- ${rounds}x`);
    lines.push(`- ${Math.round(work.onSeconds / 60)}m Z3 ${at(Math.round(paceS * 1.06))}`);
    lines.push(`- ${Math.round(work.offSeconds / 60)}m Z1 walk`);
    workKm = (work.onSeconds / paceS) * rounds;
    workSeconds = rounds * (work.onSeconds + work.offSeconds);
  }

  lines.push(`- ${doseKm(COOLDOWN_KM)} Z1 cool down ${at(Math.round(paceS * RECOVERY_JOG))}`);

  const km = km1(WARMUP_KM + workKm + COOLDOWN_KM);
  const minutes = Math.round(
    ((WARMUP_KM + COOLDOWN_KM) * easyS + workSeconds) / 60);
  return { target: lines.join("\n"), km, minutes, title };
}

/** An easy or long run: one instruction, and the discipline is in holding it. */
export function continuousRun(km: number, paceS: number, zone = "Z2"): Built {
  return {
    // paceS here is already the pace this run is meant to be held at, so the range
    // around it is the tolerance rather than a conversion.
    target: `- ${doseKm(km1(km))} ${zone} ${between(paceS, Math.round(paceS * 1.06))}`,
    km: km1(km),
    minutes: Math.max(15, Math.round((km * paceS) / 60)),
  };
}

/**
 * The Hyrox session: runs and stations alternating, which is the whole point of it.
 *
 * Written as a repeat block rather than one line, because "compromised running" is
 * not an instruction — running off a station is, and it has to be visible as the
 * shape of the session before anyone can do it properly.
 */
export function hyroxSession(label: string, paceS: number, rounds = 4): Built {
  const runM = /simulation/.test(label.toLowerCase()) ? 1000 : 400;
  const n = /full simulation/.test(label.toLowerCase()) ? 8 : rounds;
  const lines = [
    `- ${doseKm(WARMUP_KM)} Z2 warm up ${between(paceS, Math.round(paceS * 1.08))}`,
    `- ${n}x`,
    // Running off a station is slower than fresh running, and the target says so
    // rather than setting one nobody hits and everybody chases.
    `- ${runM}m Z3 ${at(Math.round(paceS * 0.94))}`,
    `- 1 station Z4`,
    `- ${doseKm(1)} Z1 cool down ${at(paceS)}`,
  ];
  const km = km1(WARMUP_KM + (runM / 1000) * n + 1);
  // A station is roughly the time of the run beside it, plus the transition.
  const stationSeconds = (runM / 1000) * paceS + 60;
  const minutes = Math.round(
    ((WARMUP_KM + 1) * paceS + n * ((runM / 1000) * paceS + stationSeconds)) / 60);
  return { target: lines.join("\n"), km, minutes };
}
