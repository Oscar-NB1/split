import { stationsFor, type Loads } from "./stations";
import type { Kit } from "./strength";
import { EXPECTED_LAPS, RUN_DISTANCE_M } from "./capture";
import { type Anchor, anchorFrom, prescribe } from "./paces";
import { mmss } from "./findings";

/**
 * The benchmark itself: what the test is, and what its numbers mean.
 *
 * Everything around this existed and this did not. There is a preflight page that explains
 * the lap protocol, a results screen with findings and a plan diff, a reading layer that
 * turns rounds into bands, an `anchorFrom(rounds)` that has never been called by anything,
 * and a `benchmark_results` table with no row in it and no code able to write one. Two
 * finished screens over a hole: Preflight was rendered with `protocol={null}` and "Apply to
 * the block" wrote a timestamp and changed nothing.
 *
 * So this is the middle. Three things, all deliberately dull:
 *
 *   the protocol   four rounds of a 400 m run and one station, eight laps, fixed
 *   the anchor     what the measured rounds say the athlete's paces are
 *   the diff       which lines of the plan that moves, so the screen can show it
 *
 * Fixed rather than clever, because a benchmark's only job is to be comparable to itself.
 * A protocol that adapted to the block would measure a different thing every time and the
 * fade across four rounds — which is the finding that actually changes the plan — would
 * mean nothing across two tests.
 */

export const PROTOCOL_VERSION = 1;

/** Four rounds: eight laps, run first. Matches `EXPECTED_LAPS` in ./capture. */
export const ROUNDS = EXPECTED_LAPS / 2;

export type Protocol = {
  variant: string;
  /** in order: the run and station doses, alternating */
  legs: { label: string; dose: string; load?: string | null }[];
  duration_min: number;
};

/**
 * The protocol, from the kit the athlete said they have.
 *
 * The stations come from `stationsFor` at week 1, which is deterministic and already knows
 * how to substitute for kit somebody does not have — so a test taken without a sled is
 * still a test, and it is the same test next time.
 */
export function protocolFor(
  kit: Kit, loads?: Loads | null, runPaceS = 300,
): Protocol {
  const stations = stationsFor(kit, ROUNDS, 1, loads);
  const legs: Protocol["legs"] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    legs.push({ label: `Run ${i + 1}`, dose: `${RUN_DISTANCE_M} m` });
    const st = stations[i % stations.length];
    /*
     * "25 m Sled push at 152 kg total" — the same shape a Hyrox session writes, because a
     * station line the athlete has read fifteen times should not change wording because it
     * is a test. `dose` and `load` are kept apart so the preflight card can show them apart.
     */
    legs.push({ label: st.name, dose: st.dose, load: st.load ?? null });
  }
  /*
   * Roughly, and said roughly on the screen. A station dose is a quarter of the race's, which
   * is nearer two minutes than three for most people, and the point of the number is that
   * somebody can tell whether they have half an hour.
   */
  const runS = (RUN_DISTANCE_M / 1000) * runPaceS;
  const duration_min = Math.round((ROUNDS * (runS + 140)) / 60);
  return {
    variant: kit.sled ? "full" : "no_sled",
    legs,
    duration_min,
  };
}

/** The prescription, in the syntax the app parses and the watch understands. */
export function benchmarkTarget(p: Protocol): string {
  const lines = ["- 10m Z2 warm up — easy, then two or three faster efforts"];
  for (const leg of p.legs) {
    lines.push(/^Run \d/.test(leg.label)
      ? `- ${RUN_DISTANCE_M}m Z4 ${leg.label.toLowerCase()} — hard but repeatable`
      : `- ${leg.dose} ${leg.label}${leg.load ? ` at ${leg.load}` : ""}`);
  }
  lines.push("- 5m Z1 cool down");
  return lines.join("\n");
}

export const BENCHMARK_NOTE =
  "Four rounds of 400 m and a station, straight through. Press lap at every boundary — "
  + "eight presses. Run it hard enough that round four is the same speed as round one: what "
  + "this measures is not your fastest 400, it is whether you can repeat it. Everything the "
  + "plan does with the result comes from the shape across the four, not from the quickest.";

/** What one round looked like, as recorded. */
export type RecordedRound = {
  run_s: number;
  distance_m?: number;
  station_s?: number;
  transition_s?: number;
};

/**
 * The anchor a test produces.
 *
 * `anchorFrom` has been sitting in ./paces unused since it was written — this is the call it
 * was for. Runs shorter than the standard distance are scaled to it, because a lap that
 * measured 380 m is a 380 m lap and pretending otherwise flatters the pace.
 */
export function anchorOf(rounds: RecordedRound[]): Anchor | null {
  if (rounds.length < 2) return null;
  return anchorFrom(rounds.map((r) => ({
    run_time_s: toStandard(r),
    station_time_s: r.station_s,
    transition_time_s: r.transition_s,
  })));
}

/**
 * A run leg's time at the protocol's distance.
 *
 * A GPS lap that measured 380 m is a 380 m lap, and reading it as a 400 flatters the pace by
 * five per cent — which is more than the entire difference between two bands. Scaled where
 * there is a distance to scale by, and left alone where there is not: a treadmill lap and a
 * hand-timed one both arrive without one, and inventing a distance for them would be worse
 * than trusting the athlete.
 */
function toStandard(r: RecordedRound): number {
  if (!r.distance_m || r.distance_m < 100) return r.run_s;
  return Math.round(r.run_s * (RUN_DISTANCE_M / r.distance_m));
}

/**
 * The lines of the plan a test can move, before and after.
 *
 * Keyed by the labels in `RULES` (./findings), because that is what `changes()` looks up to
 * find the reason a line moved — a label that is not in the table produces a diff row with
 * no explanation behind it, which is the one thing this screen must not do.
 */
export function planLines(anchor: Anchor | null, fade: number | null): Record<string, string> {
  if (!anchor) return {};
  /* Through `prescribe` rather than by multiplying here, so a line on this screen and the
     same line on a session can never disagree about what a rung is worth. */
  const key = prescribe(anchor, "cv", null, 4, 7);
  const easy = prescribe(anchor, "easy", null, 2, 3);
  const long = prescribe(anchor, "long", null, 2, 4);
  const out: Record<string, string> = {};
  if (key.kind === "pace") out["Key session pace"] = `${mmss(key.seconds_per_km)}/km`;
  if (easy.kind === "pace") out["Easy run pace"] = `${mmss(easy.seconds_per_km)}/km`;
  /*
   * The long run's pace is deliberately absent until the fade curve flattens. That is the
   * rule the results screen quotes — "long-run pace only moves once fade is under 12%, so
   * distance is not bought with form" — so it has to be the rule here rather than a
   * sentence somewhere.
   */
  if (fade != null && fade < 1.12 && long.kind === "pace") {
    out["Long run pace"] = `${mmss(long.seconds_per_km)}/km`;
  }
  return out;
}

/** Fade across the rounds: the last run over the first. */
export const fadeOf = (rounds: RecordedRound[]): number | null =>
  (rounds.length < 2 ? null : rounds[rounds.length - 1].run_s / rounds[0].run_s);
