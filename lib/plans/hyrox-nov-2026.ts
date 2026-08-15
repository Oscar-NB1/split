import type { Rules, TemplateDay } from "../templates";
import { WEEKS } from "../coach";

/**
 * Hyrox doubles, Mon 17 Aug → Sat 28 Nov 2026, with Olivier. Target 55:00–56:30.
 *
 * This is the plan document expressed as fifteen explicit week shapes rather
 * than one shape plus progression rules. That is deliberate: the block is not a
 * repeating week that grows: the key session changes character at week 9 (it
 * becomes the race), weeks 4 and 8 are benchmarks, week 11 is built around a
 * B-race on the Wednesday, and week 15 is the race itself. A progression rule
 * cannot express any of that, and pretending it can is how a plan drifts from
 * what was actually written.
 *
 * So the engine's own progression and deload are switched OFF here — the plan
 * already contains its own down weeks, with stated kilometres.
 */

export const PLAN_NAME = "Hyrox doubles · Nov 2026";
export const PLAN_START = "2026-08-17";

/** No auto-progression, no auto-deload: the fifteen weeks are already written. */
export const RULES: Rules = {
  long_run_delta_min: 0,
  deload_every: 0,
  // the fatigue rule stays on — it reacts to what actually happened, which the
  // plan cannot know in advance
  fatigue_skips_to_deload: 2,
  fatigue_cut: 0.85,
};

/** Minutes for a distance at a given pace, rounded to something a human wrote. */
const mins = (km: number, secPerKm: number) => Math.round((km * secPerKm) / 60 / 5) * 5;

const PACE = { easy: 330, long: 315, key: 270 };

const GUARDRAIL = (target: string) =>
  `Watch alert at ${target} minus 3 s/km — an alarm, not a target. The first rep may ` +
  `never be the fastest; if it is, the session is logged as failed whatever the average says.`;

const ROXZONE =
  "Roxzone: drill entry, exit, set-up and handover. Mechelen 5:40, Heerenveen 5:20 — " +
  "top 27% against top 5–13% everywhere else. 90–110 seconds available for zero fitness cost. Target 4:00.";

const STATION_RECOVERY =
  "On the ski and the row, bring HR *down* while working: controlled breathing, longer " +
  "stroke, lower rate, eyes on the HR field. Your stations gave 3 bpm of relief at " +
  "Heerenveen; they should give 10–15. Arriving at run 2 at 178 instead of 185 changes the race.";

const reps = (n: number, distance: string, restSec: number, wu = 15, cd = 10) =>
  [`- ${wu}m Z2 warm up`, `- ${n}x`, `- ${distance} Z4`, `- ${restSec}s Z1 walk`,
   `- ${cd}m Z1 cool down`].join("\n");

type Key = {
  km: number; title: string; target: string; note: string; significance?: string;
};

/** Tuesday's quality session, week by week. */
const KEY: Record<number, Key> = {
  1: { km: 8, title: "5 × 800 m @ 4:20", target: reps(5, "800m", 90), note: GUARDRAIL("4:20") },
  2: { km: 9, title: "6 × 800 m @ 4:20", target: reps(6, "800m", 90), note: GUARDRAIL("4:20") },
  3: { km: 10, title: "4 × 1200 m @ 4:20", target: reps(4, "1200m", 90), note: GUARDRAIL("4:20") },
  4: { km: 10, title: "BENCHMARK · 5 × 1000 m", target: reps(5, "1000m", 90),
       note: `Benchmark week. On track is ≤ 4:05 average; sub-55 territory is ≤ 3:57. 90 s walk between. ${GUARDRAIL("4:05")}`,
       significance: "benchmark" },
  5: { km: 10, title: "5 × 1200 m @ 4:20", target: reps(5, "1200m", 90), note: GUARDRAIL("4:20") },
  6: { km: 12, title: "6 × 1200 m @ 4:20", target: reps(6, "1200m", 90), note: GUARDRAIL("4:20") },
  7: { km: 12, title: "5 × 1600 m @ 4:20", target: reps(5, "1600m", 120), note: GUARDRAIL("4:20") },
  8: { km: 10, title: "BENCHMARK · 5K time trial",
       target: ["- 15m Z2 warm up", "- 5000m Z5", "- 10m Z1 cool down"].join("\n"),
       note: "Negative split it. On track is ≤ 20:15; sub-55 territory is ≤ 19:45. Second half faster than the first, or it doesn't count.",
       significance: "benchmark" },
  9: { km: 12, title: "RACE SESSION · 8 × 1000 m @ 4:15", target: reps(8, "1000m", 75),
       note: `This is literally your race — no 10K plan contains it. Standing rest, 75 s. ${GUARDRAIL("4:15")}`,
       significance: "key" },
  10: { km: 13, title: "6 × 1000 m @ 4:15", target: reps(6, "1000m", 75),
        note: `Kept short — the full sim with Olivier is Saturday. ${GUARDRAIL("4:15")}`,
        significance: "key" },
  11: { km: 6, title: "Easy 6 km", target: "", note: "No key session — the B-race is Wednesday." },
  12: { km: 12, title: "RACE SESSION · 8 × 1000 m @ 4:10", target: reps(8, "1000m", 75),
        note: `The 4:10 session, moved here because week 11 has the B-race. ${GUARDRAIL("4:10")}`,
        significance: "key" },
  13: { km: 10, title: "RACE SESSION · 6 × 1000 m @ 4:05", target: reps(6, "1000m", 75),
        note: GUARDRAIL("4:05"), significance: "key" },
  14: { km: 8, title: "4 × 1000 m @ 4:15", target: reps(4, "1000m", 90, 12, 8),
        note: `Taper sharpener. Sharp, not long. ${GUARDRAIL("4:15")}`, significance: "key" },
  15: { km: 4, title: "Short race-pace touch", target: reps(3, "600m", 90, 10, 8),
        note: "Nothing you do now makes you fitter. This only keeps the legs awake.",
        significance: "key" },
};

const STRENGTH_A =
  "Trap bar deadlift 3x5 @ 130\nBack squat 3x5 @ 105\nWeighted pull-up 3x6 @ 12";
const STRENGTH_B =
  "Front squat 3x5 @ 85\nRomanian deadlift 3x8 @ 90\nWalking lunge 3x20 @ 24";

/**
 * One week of the plan, as day shapes.
 *
 * Strength drops from twice a week to once from week 9, which the plan is
 * explicit about: gym days were logging strains of 13–19 and competing directly
 * with the running rebuild.
 */
export function week(n: number): TemplateDay[] {
  const w = WEEKS.find((x) => x.n === n);
  if (!w) return [];
  const days: TemplateDay[] = [];
  const bRace = n === 11;
  const race = n === 15;
  const twiceStrength = n <= 8;

  // --- Monday: strength AM, kickboxing PM -----------------------------
  days.push({ day: 0, kind: "strength", title: "Strength A", minutes: 40, slot: "AM",
    target: STRENGTH_A,
    coach_note: "Heavy and short. Three compound lifts, low reps, 40 minutes. You already get the metabolic work from the Hyrox sessions." });
  days.push({ day: 0, kind: "hyrox", title: "Kickboxing", minutes: 60, slot: "PM",
    coach_note: "Rounds are not a third hard day. Tuesday and Saturday are the ceiling." });

  // --- Tuesday: the key session ---------------------------------------
  const k = KEY[n];
  if (k) {
    days.push({ day: 1, kind: n === 11 ? "run_easy" : "run_intervals", title: k.title,
      minutes: mins(k.km, bRace ? PACE.easy : PACE.key), slot: "AM",
      target: k.target || undefined, coach_note: k.note || undefined,
      significance: k.significance });
  }

  // --- Wednesday: Hyrox intervals, the B-race, or a shakeout ----------
  if (bRace) {
    days.push({ day: 2, kind: "hyrox", title: "B-RACE with Sarah", minutes: 60, slot: "AM",
      significance: "race",
      coach_note: "Run 1 slower than target. Negative split the eight runs. Time every roxzone transition — real venue, real handovers, zero stakes. You take 70–80% of stations here, the inverse of November." });
  } else if (race) {
    days.push({ day: 2, kind: "run_easy", title: "Shakeout 4 km", minutes: 25, slot: "AM",
      coach_note: "Easy. Legs open, nothing more." });
  } else {
    days.push({ day: 2, kind: "hyrox", title: "Hyrox intervals", minutes: 35, slot: "AM",
      coach_note: n >= 9 ? `Rehearsal, not fitness — transitions, splits, roxzone.\n\n${ROXZONE}` : undefined });
  }

  // --- Thursday: easy run AM, kickboxing PM ---------------------------
  if (!race) {
    days.push({ day: 3, kind: "run_easy", title: "Easy run", minutes: mins(8, PACE.easy), slot: "AM",
      coach_note: "HR 135–152. Yours sit at 146–158, the top edge of zone 2. Push them 5–8 bpm down — the aerobic return is better and it protects Tuesday and Saturday." });
    if (n <= 13) {
      days.push({ day: 3, kind: "hyrox", title: "Kickboxing", minutes: 60, slot: "PM",
        coach_note: n >= 11 ? "First thing to drop this block if anything has to go." : undefined });
    }
  }

  // --- Friday: strength B, or rest ------------------------------------
  if (twiceStrength && !bRace) {
    days.push({ day: 4, kind: "strength", title: "Strength B", minutes: 40, slot: "AM",
      target: STRENGTH_B,
      coach_note: "Drops to once a week from week 9. First session to sacrifice in a bad week." });
  } else if (!race) {
    days.push({ day: 4, kind: "run_easy", title: "Easy 8 km", minutes: mins(8, PACE.easy), slot: "AM" });
  }

  // --- Saturday: Hyrox, or the race -----------------------------------
  if (race) {
    days.push({ day: 5, kind: "hyrox", title: "RACE · Hyrox Doubles with Olivier", minutes: 60, slot: "AM",
      significance: "race",
      coach_note: "Run 1 ≤ 172 bpm, hard cap. Runs 2–4 at 178–182. Runs 5–8 up to 185. Ski and row: actively drop 8–12 bpm. Sleds and lunges: whatever it takes. You may not lead runs 1–4 — agreed with Olivier in advance, in writing." });
  } else if (n === 10) {
    days.push({ day: 5, kind: "hyrox", title: "FULL SIM with Olivier", minutes: 60, slot: "AM",
      significance: "benchmark",
      coach_note: `On track is ≤ 58:00; sub-55 territory is ≤ 56:00.\n\n${ROXZONE}\n\n${STATION_RECOVERY}` });
  } else if (n === 13) {
    days.push({ day: 5, kind: "hyrox", title: "Dress rehearsal", minutes: 65, slot: "AM",
      significance: "key",
      coach_note: `Everything as it will be on the day.\n\n${ROXZONE}\n\n${STATION_RECOVERY}` });
  } else {
    days.push({ day: 5, kind: "hyrox", title: "Hyrox continuous", minutes: bRace ? 50 : 65, slot: "AM",
      coach_note: `${ROXZONE}\n\n${STATION_RECOVERY}` });
  }

  // --- Sunday: the long run -------------------------------------------
  if (!race) {
    // what is left of the week's kilometres after the sessions above
    const used = (k?.km ?? 0) + 8 + (twiceStrength && !bRace ? 0 : 8);
    const longKm = Math.max(8, Math.round(w.km - used));
    days.push({ day: 6, kind: "run_long", title: `Long run ${longKm} km`,
      minutes: mins(longKm, PACE.long), slot: "AM",
      coach_note: n <= 3
        ? "Never the session to drop. The block is bought with consistency in August."
        : "Long-run pace at HR ~150 is the real benchmark. March was 4:50/km at 159; 1 Aug was 5:18 at 152. When it returns to 5:00, the engine is back." });
  }

  return days;
}

/** All fifteen weeks, as the `weeks` jsonb the template engine reads. */
export const WEEK_SHAPES: TemplateDay[][] = WEEKS.map((w) => week(w.n));
