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

import type { Kit } from "./strength";
import { type Loads, raceOrder, stationsFor } from "./stations";

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
  /** what to say about it, where the session is attended rather than executed */
  note?: string;
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
 * Not a recordable run with a placeholder in the middle. It was written as a repeat
 * block ending "1 station Z4", which is not an instruction anybody can follow — it
 * is a note to the coach that a station goes here. A Hyrox session is a list of
 * things to do in an order, and it should read as one:
 *
 *   1. 400 m run
 *   2. 25 wall balls
 *   3. 400 m run
 *   4. 250 m SkiErg
 *
 * The stations are named, dosed, in race order, rotated by the week so the block
 * is not the same two every Saturday, and gated on the equipment the athlete said
 * they can reach — with the substitution written out rather than the station
 * quietly dropped.
 */
/**
 * The four race-specific sessions, and what actually distinguishes them.
 *
 * They were the same session with four names: run 400 m, do a station, repeat. The
 * ladder's whole purpose is that each rung trains a different thing, and printing the
 * same structure under each label is the plan claiming a progression it does not have.
 *
 *   compromised running  long runs off heavy stations. Few stations, generous rest.
 *                        The question is whether you can still run when your legs are
 *                        wrecked, so the running has to be long enough to answer it.
 *   transitions          short runs, many stations, no rest. The question is how fast
 *                        you move between things, which is where a minute and a half
 *                        hides in a race.
 *   half simulation      four stations in race order at race dose, 1 km between.
 *   full simulation      all eight, race order, race dose, race weight.
 */
type HyroxShape = {
  runM: number;
  /** stations per round */
  perRound: number;
  rounds: number;
  /** seconds between rounds; zero means straight into the next one */
  rest: number;
  /** race doses and weights rather than training doses */
  raceDose: boolean;
  cue: string;
};

/**
 * What the shape becomes for somebody who cannot yet run it.
 *
 * The shapes above describe an athlete who runs. Handed to somebody who does not, four
 * by eight hundred metres at threshold off a heavy sled is not a hard session — it is an
 * impossible one, and the honest response to it is to stop training rather than to fail
 * it every Saturday.
 *
 * The skill being trained still matters: running on legs that have just done something
 * heavy is exactly what a beginner needs to meet early, and it does not need to be
 * eight hundred metres to teach it. So the runs come down to what they can hold, the
 * round count comes down with them, and the load stops being a race weight — because
 * "25 m sled push at 152 kg" to somebody in their first month is how people get hurt.
 */
function forBeginner(shape: HyroxShape, base?: string | null): HyroxShape {
  if (base !== "doesnt_run" && base !== "walk_breaks") return shape;
  const walker = base === "doesnt_run";
  return {
    ...shape,
    // Short enough to run without stopping, which is the only distance worth setting.
    runM: walker ? 200 : 300,
    perRound: Math.min(shape.perRound, 2),
    rounds: Math.min(shape.rounds, walker ? 3 : 4),
    // Rest, always, and enough of it. Continuous work is a later problem.
    rest: Math.max(shape.rest, walker ? 120 : 90),
    raceDose: false,
    cue: walker
      ? "Run the 200 m if you can and walk it if you cannot — either is the session. The stations are the point at this stage, and the running is there so that carrying fatigue into it stops being a surprise. Work at a weight you could do twice as many reps of."
      : "Short runs so you can run all of them, rather than long ones you would have to walk. Keep the stations light enough that the running afterwards still happens — the weight comes later in the block, and the habit comes now.",
  };
}

/**
 * How far into the block this session is, as a step of 0, 1 or 2.
 *
 * Read off the phase rather than the week number, because the phase is the plan's own
 * statement about what these weeks are for — and it means a fifteen-week block and a
 * nine-week block both progress properly rather than one running out of ladder. The
 * second half of a phase counts as the next step, so a five-week build does not sit on
 * one setting for five weeks.
 */
function stepOf(phase?: string | null, weekInPhase = 0): number {
  const base = phase === "build" ? 1 : phase === "specific" || phase === "taper" ? 2 : 0;
  return Math.min(2, base + (weekInPhase >= 2 ? 1 : 0));
}

/**
 * The shape, and how it grows.
 *
 * It did not. Week 1's compromised running was week 14's — 4 × 800 m off two stations,
 * every week of the block, with only the choice of station rotating, which is a
 * different session in the way that a different colour of shirt is a different outfit.
 * A race-specific session has to get harder for the same reason an interval session
 * does, and it has three honest dials: how far the runs are, how many stations sit
 * between them, and how little rest there is.
 *
 *   compromised running  the run grows — 600 m, 800 m, 1 km — and a fourth round
 *                        arrives. The run is the session, so the run is what builds.
 *   transitions          the count grows — 4 stations, 6, 8 — and the runs stay short.
 *                        The changeover is the session, so more changeovers is harder.
 *   simulations          already at race distances, so the rest comes out instead.
 */
function shapeOf(label: string, step = 0): HyroxShape {
  const l = label.toLowerCase();
  const pick = <T,>(a: T[]): T => a[Math.min(step, a.length - 1)];

  if (/full simulation/.test(l)) {
    return {
      runM: 1000, perRound: 8, rounds: 1, rest: 0, raceDose: true,
      cue: "The whole event, in order, at race weight. Treat it as a race: it is the only session in the block that earns a taper of its own.",
    };
  }
  if (/half simulation/.test(l)) {
    return {
      runM: 1000, perRound: 4, rounds: 1, rest: pick([60, 30, 0]), raceDose: true,
      cue: step >= 2
        ? "Race order, race weight, race distances, and no rest anywhere. This is the dress rehearsal."
        : "Race order, race weight, race distances — half of it. Hold your race pace on the runs rather than proving something on the first one.",
    };
  }
  if (/transition/.test(l)) {
    return {
      runM: 200, perRound: pick([4, 6, 8]), rounds: 2, rest: 0, raceDose: false,
      cue: "Short runs, and no rest anywhere. The changeover is the session — every second you spend deciding what to do next is a second of your race.",
    };
  }
  return {
    runM: pick([600, 800, 1000]), perRound: 2, rounds: pick([3, 4, 4]),
    rest: pick([90, 90, 60]), raceDose: false,
    cue: "Long runs off heavy stations. The station is there to wreck your legs; the run is the session, and it should be held at the pace on your card.",
  };
}

export function hyroxSession(
  label: string, paceS: number, _rounds = 4, kit?: Kit, week = 1, loads?: Loads | null,
  /** their running base, because the shapes above assume somebody who runs */
  base?: string | null,
  /** which phase this week is in, and how far into it — the session grows with both */
  phase?: string | null,
  weekInPhase = 0,
): Built {
  const k = kit ?? { barbell: true, kettlebells: true, rig: true, sled: true };
  const shape = forBeginner(shapeOf(label, stepOf(phase, weekInPhase)), base);
  const need = shape.perRound * shape.rounds;
  /*
   * No prescribed weight for a beginner.
   *
   * `loads` is the division's race weight, which is the right number for somebody
   * training for that division and the wrong one for somebody in their first month.
   * Without it the station reads "25 m sled push" and the cue says how to pick a load.
   */
  const useLoads = base === "doesnt_run" || base === "walk_breaks" ? null : loads;
  const stations = shape.raceDose
    ? raceOrder(k, useLoads).slice(0, shape.perRound)
    : stationsFor(k, need, week, useLoads);

  /*
   * The warm-up is cardio, not necessarily running.
   *
   * It said "2 km Z2" with a pace target — a running warm-up before a session of sleds
   * and skis, on a day that already has kilometres of running in it. Anything that
   * raises a heart rate does this job.
   */
  const lines = ["- 10m Z2 warm up — row, bike, ski or jog, your choice"];

  /*
   * Different stations every round, wherever there are enough of them.
   *
   * This was backwards: it wrote one round and a repeat count whenever it had enough
   * stations to fill every round — so "4 ×" meant the same sled push and the same ski,
   * four times. A race has eight different stations and no repeats, and a session that
   * rehearses it should rotate too: the run is the constant, the station is the variable.
   *
   * A repeat count is only used where there genuinely are not enough stations to go
   * round, which is an athlete with almost no equipment.
   */
  const same = shape.rounds > 1 && stations.length < need;
  const write = (from: number, count: number) => {
    for (let i = 0; i < count; i += 1) {
      const st = stations[(from + i) % stations.length];
      lines.push(`- ${shape.runM}m Z3 ${at(Math.round(paceS * 0.94))}`);
      lines.push(`- ${st.dose} ${st.name}${st.load ? ` at ${st.load}` : ""}`);
    }
  };
  if (same) {
    lines.push(`- ${shape.rounds}x`);
    write(0, shape.perRound);
    if (shape.rest > 0) lines.push(`- ${shape.rest}s Z1 rest between rounds`);
  } else {
    for (let r = 0; r < shape.rounds; r += 1) {
      write(r * shape.perRound, shape.perRound);
      if (shape.rest > 0 && r < shape.rounds - 1) {
        lines.push(`- ${shape.rest}s Z1 rest between rounds`);
      }
    }
  }
  lines.push("- 5m Z1 cool down — easy on any machine");

  /*
   * Only the runs count as running.
   *
   * The warm-up and cool-down are whatever machine they choose, so they are not
   * kilometres in the weekly ledger — the same rule that keeps compromised running out
   * of it.
   */
  const km = km1((shape.runM / 1000) * need);
  /*
   * A station takes about ninety seconds at a training dose, and about three minutes at
   * a race one — not "as long as the run beside it", which is what this said and which
   * credited four minutes to a sled because the run next to it was 800 m. That put a
   * 94-minute estimate on an hour's work.
   */
  const stationSeconds = shape.raceDose ? 180 : 90;
  const minutes = Math.round(
    15 + (need * ((shape.runM / 1000) * paceS + stationSeconds)) / 60
    + ((shape.rounds - 1) * shape.rest) / 60);
  return { target: lines.join("\n"), km, minutes, note: shape.cue };
}

/**
 * The easy Hyrox session: the aerobic half of the race, without the load.
 *
 * It was being written as a three-round Hyrox session, which meant an easy day
 * cycling through the sled and the sandbag — the two stations that cost the most and
 * take the longest to recover from. The point of this session is aerobic work on the
 * machines that make up a quarter of station time, with none of the impact of another
 * eight kilometres of running and none of the load that would compromise Sunday.
 *
 * Machines and bodyweight only: ski, row, burpee broad jumps. No sled, no carry, no
 * sandbag. If it needs a rack it does not belong on an easy day.
 */
export function easyHyrox(rounds = 3): Built {
  const lines = ["- 5m Z1 easy spin or row to open up"];
  const block = [
    ["500m", "row Z2"],
    ["500m", "SkiErg Z2"],
    ["20m", "burpee broad jump, unhurried"],
  ];
  for (let i = 0; i < rounds; i += 1) {
    for (const [dose, what] of block) lines.push(`- ${dose} ${what}`);
    if (i < rounds - 1) lines.push("- 90s Z1 walk or easy spin");
  }
  lines.push("- 5m Z1 easy spin");
  /*
   * No running kilometres at all.
   *
   * Reporting any would put them in the week's running total, and compromised work
   * never counts towards running volume — that was the whole fault this session was
   * built to stop repeating.
   */
  return {
    target: lines.join("\n"),
    km: 0,
    minutes: 15 + rounds * 12,
    note: "Conversational the whole way. If you cannot talk through it, it has become a session it was not meant to be.",
  };
}

/**
 * The long run, and what is asked of it.
 *
 * A flat Zone 2 at every setting, while the dials screen promised "finishes at
 * effort" for Challenging and Hard — a claim the plan did not keep. What a long run
 * is *for* changes with the difficulty:
 *
 *   steady       nothing but distance. The pace is whatever holds the distance.
 *   challenging  the last quarter at steady effort — running tired, on purpose.
 *   hard         blocks inside it, and later a timed run at an average. Switching
 *                pace under fatigue is the demand of the race, and it is the one
 *                thing a flat long run never trains.
 *
 * The blocks grow with the phase: a single 2 km insert in the base weeks, two by
 * the specific phase, and a whole run at an average once there is a race pace worth
 * holding.
 */
export type LongShape = "steady" | "finish" | "blocks" | "timed";

export function longRun(
  km: number, easyS: number, steadyS: number, shape: LongShape, phase = "base",
): Built {
  const total = km1(km);
  if (shape === "steady" || total < 8) {
    return continuousRun(total, easyS);
  }

  if (shape === "finish") {
    const fast = km1(Math.max(2, total * 0.25));
    const easy = km1(total - fast);
    return {
      target: [
        `- ${doseKm(easy)} Z2 ${between(easyS, Math.round(easyS * 1.06))}`,
        `- ${doseKm(fast)} Z3 ${at(steadyS)}`,
      ].join("\n"),
      km: total,
      minutes: Math.round((easy * easyS + fast * steadyS) / 60),
    };
  }

  if (shape === "timed") {
    // One number to hold for the whole run. Nowhere to hide, which is the point.
    const avg = Math.round((easyS + steadyS) / 2);
    return {
      target: `- ${doseKm(total)} Z3 ${at(avg)}`,
      km: total,
      minutes: Math.round((total * avg) / 60),
    };
  }

  const blocks = phase === "base" ? 1 : 2;
  const each = km1(Math.min(4, Math.max(2, total * 0.15)));
  const easyEach = km1(Math.max(2, (total - blocks * each) / (blocks + 1)));
  const lines: string[] = [];
  for (let i = 0; i < blocks; i++) {
    lines.push(`- ${doseKm(easyEach)} Z2 ${between(easyS, Math.round(easyS * 1.06))}`);
    lines.push(`- ${doseKm(each)} Z3 ${at(steadyS)}`);
  }
  lines.push(`- ${doseKm(easyEach)} Z2 ${between(easyS, Math.round(easyS * 1.06))}`);

  const fastKm = blocks * each;
  const easyKm = total - fastKm;
  return {
    target: lines.join("\n"),
    km: total,
    minutes: Math.round((easyKm * easyS + fastKm * steadyS) / 60),
  };
}

/**
 * A Hyrox session the athlete attends rather than executes.
 *
 * "Station work: written sessions or classes?" was collected and then ignored —
 * everyone got the same written session whatever they answered. That is worse than
 * not asking: an athlete who told the plan they train in classes was handed a
 * prescription they were never going to follow, and the week counted five or seven
 * kilometres of running inside a class that contains maybe two.
 *
 * So a class is written as a class: what to look for, what to prioritise inside it,
 * and what it is worth in running. The running the plan can rely on drops to what a
 * class really delivers, and the difference goes back to the easy running — which is
 * why the week's aerobic volume stops being fiction.
 */
export const CLASS_RUN_KM = 2;

export function hyroxClass(rung: string): Built {
  const kind = rung.toLowerCase();
  const priority = /simulation/.test(kind)
    ? "One continuous piece, stations in race order, no long rests. A circuit with a rest between rounds is conditioning, not this."
    : /transition/.test(kind)
      ? "Time your own transitions even if the class does not. That is the number this session exists to move."
      : "It has to alternate a weighted station straight into a run or a machine. Stations in one block and cardio in another trains something else.";

  return {
    target: [
      "- Hyrox class",
      `- ${CLASS_RUN_KM}km Z3 running inside it`,
      "- Stations at race weight",
    ].join("\n"),
    km: CLASS_RUN_KM,
    minutes: 60,
    title: "Hyrox class",
    note: `${priority} Keep your run efforts at the pace on your card rather than all-out — the class is scored, your block is not.`,
  };
}
