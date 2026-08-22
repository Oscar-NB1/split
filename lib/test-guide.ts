/**
 * What a time trial is for, and how to run one.
 *
 * A test is the one session an athlete arrives at with no idea how hard to go. Every other
 * session states its pace; this one asks for whatever they have, which is a harder instruction
 * to follow than it sounds — go too hard in the first kilometre and the number that comes back
 * is worse than the athlete is, which then re-paces the whole block downwards.
 *
 * Her first one was titled "TEST" and carried three lines of prescription: 900 m warm up, 2 km
 * time trial, 600 m cool down. No target, nothing about pacing it, and nothing saying that this
 * is the session every pace in her block is derived from. She ran it on a treadmill with an
 * uncalibrated watch, and the block was mis-paced off the result for two days.
 *
 * So the guidance is generated rather than written per session: any session whose prescription
 * contains a time trial gets it, and it says the same things in the same order every time. The
 * target comes from the pace the plan already states in the title — the number the calibration
 * engine reads — so the guide and the plan can never disagree about what is being asked.
 */

export type TestGuide = {
  /** the headline, replacing a title like "TEST" that says nothing */
  purpose: string;
  /** why this session exists, in the athlete's terms */
  why: string;
  /** the distance under test, in metres */
  distance_m: number;
  /** the target as a range of finish times in seconds, where a pace is stated */
  target_low_s: number | null;
  target_high_s: number | null;
  /** how to run it */
  strategy: string[];
  /** said last, because it is the part athletes most need permission for */
  reassurance: string;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * Every pace in the string, in seconds per kilometre, low to high.
 *
 * A leading zero means a clock, not a pace — the same rule `prescribedPace` applies, and for the
 * same reason: nobody writes a pace as "04:15", so "RACE @ 09:30" is a start time. Without this
 * a race title produced a target of 47 minutes for 5 km and the guide read as though the plan
 * had asked for a jog.
 */
function paces(s: string): number[] {
  return [...s.matchAll(/(\d{1,2}):([0-5]\d)/g)]
    .filter((m) => !(m[1].length === 2 && m[1].startsWith("0")))
    .map((m) => Number(m[1]) * 60 + Number(m[2]))
    .filter((v) => v >= 120 && v <= 900)
    .sort((a, b) => a - b);
}

/** The distance being tested, from the line that says "time trial". */
function distanceOf(line: string): number | null {
  const km = line.match(/([\d.]+)\s*km/i);
  if (km) return Math.round(Number(km[1]) * 1000);
  const m = line.match(/(\d{3,5})\s*m\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * The guide for a session that is a test, or null for one that is not.
 *
 * Recognised from the prescription rather than a flag on the row: a time trial is written as one
 * in the target, every plan document writes it that way, and a flag would have to be set by hand
 * on every session for the rest of the block.
 */
export function testGuideFor(title: string, target: string | null): TestGuide | null {
  const lines = (target ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const tt = lines.find((l) => /time trial/i.test(l));
  if (!tt) return null;
  const distance_m = distanceOf(tt);
  if (!distance_m) return null;

  const km = distance_m / 1000;
  const band = paces(title);
  const [low, high] = band.length >= 2
    ? [band[0], band[band.length - 1]]
    : band.length === 1
      /* A single stated pace becomes a band of a few seconds either side: nobody runs a number. */
      ? [band[0] - 5, band[0] + 5]
      : [null, null];

  const target_low_s = low != null ? Math.round(low * km) : null;
  const target_high_s = high != null ? Math.round(high * km) : null;

  const label = km >= 1 ? `${Number(km.toFixed(2))} km` : `${distance_m} m`;
  const halves = km >= 2;

  return {
    purpose: "Finding your pace",
    why: `This is a measurement, not a workout — every pace in your block is set from it. `
      + `Warm up properly, then run the ${label} as hard as you can hold all the way to the end.`,
    distance_m,
    target_low_s,
    target_high_s,
    strategy: [
      target_low_s && target_high_s
        ? `Aim for ${fmt(target_low_s)}–${fmt(target_high_s)}. On a treadmill that is `
          + `${(3600 / (target_high_s / km)).toFixed(1)}–${(3600 / (target_low_s / km)).toFixed(1)} km/h.`
        : "Run it at the hardest pace you believe you can hold to the finish.",
      "Don't start at a sprint. The first minute always feels easy and it is the one that "
        + "decides whether the last one is possible.",
      halves
        ? "Even effort for the first half, and if anything is left, come home faster on the second."
        : "Settle into it quickly, then hold on — it is short enough that even is fast enough.",
      "If you have to slow down, keep going rather than stopping. A slower finish is still a "
        + "result; a session abandoned is not.",
    ],
    reassurance: "Try to finish it. Give it everything you have. If you go quicker than the "
      + "target, brilliant — and if you go slower, that is completely fine too. The number is "
      + "information, not a grade.",
  };
}
