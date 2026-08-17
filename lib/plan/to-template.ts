import type { Generated, GeneratedWeek, Session } from "./generate";
import { intentRanges, type IntentRange } from "./intents";
import type { TemplateDay } from "../templates";

/**
 * The generator's output, in the shape the app stores and materialises.
 *
 * A translation and nothing more: no decisions are taken here. Anything that
 * looks like a judgement in this file is a bug — the generator has already made
 * every one of them, and a second opinion at the storage boundary is how two
 * versions of a plan start to exist.
 */

/** Minutes to allow for a session, when the plan thinks in kilometres. */
const MINUTES_PER_KM = 6;
const FLAT_MINUTES: Record<string, number> = {
  strength: 45, hyrox: 60, rest: 0, benchmark: 50, race: 75, commitment: 60,
};

/**
 * What a session is called when it has no name of its own.
 *
 * A session is named after what you do in it. "Key session" was the title of every
 * quality run — a session called after its own importance, which tells the athlete
 * nothing about what to run — while the generator had already produced "6 × 800 m"
 * and this table overwrote it. Key is a marker, and it is carried by
 * `significance`; the title is the work.
 */
const TITLES: Record<string, string> = {
  easy_run: "Easy run", quality_run: "Intervals", long_run: "Long run",
  easy_hyrox: "Easy Hyrox",
  strength: "Strength", hyrox: "Hyrox session", rest: "Rest",
  benchmark: "Benchmark test", race: "Race",
};

/**
 * The session's own name, where it has one.
 *
 * The generator writes the ladder rung onto quality runs and the Hyrox session:
 * "6 × 800 m", "3 × 15 min", "Compromised running". Anything it did not name comes
 * back with its kind as a label, which is what the table above is for.
 */
function titleOf(s: Session): string {
  if (s.commitment) return s.label;
  const kind = String(s.kind);
  const named = s.label && s.label !== kind ? s.label : null;
  return named ?? TITLES[kind] ?? kind;
}

/**
 * What kind of day this is: key | hard | benchmark | race, or nothing.
 *
 * "key" and "hard" are not the same claim and were being made with one word.
 * Both mean arrive fresh. Only "key" means the session the plan reads to decide
 * what to prescribe next — and that is the key running work and the strength
 * work, not the Hyrox session.
 *
 * A Hyrox session is unambiguously hard, and it should wake a reminder the night
 * before. But it is a rehearsal of the event rather than a measurement of
 * fitness: the stations are done at whatever weight the athlete can move, the
 * runs are compromised on purpose, and the pace it produces is a fact about
 * fatigue rather than about speed. Letting it read as "key" invites something
 * downstream to anchor a prescription to it.
 */
const KEY_KINDS = ["quality_run", "long_run", "strength"];

function significance(s: Session): string | undefined {
  const k = String(s.kind);
  if (k === "benchmark") return "benchmark";
  if (k === "race") return "race";
  if (s.commitment) return undefined;
  /*
   * A key kind is key whether or not the generator flagged it hard. A long run is
   * the session the plan reads for durability and it is not always marked hard —
   * it was coming through as an ordinary day, which is how a 19 km Sunday ends up
   * with no reminder the night before.
   */
  if (KEY_KINDS.includes(k)) return "key";
  return s.hard ? "hard" : undefined;
}

function minutes(s: Session): number {
  // What the prescription costs, where one was written.
  if (s.minutes) return s.minutes;
  const k = String(s.kind);
  if (s.commitment) return FLAT_MINUTES.commitment;
  if (k in FLAT_MINUTES) return FLAT_MINUTES[k];
  return Math.max(20, Math.round((s.km ?? 5) * MINUTES_PER_KM));
}

/**
 * The target line: what to actually do, in the plan's own words.
 *
 * A pace comes back as a pace; without an anchor the prescription is a heart-rate
 * ceiling or an RPE, and it says so rather than inventing a number. That is the
 * whole point of the UNCALIBRATED flag upstream and it must survive the trip.
 */
function target(s: Session): string | undefined {
  /*
   * The written prescription, where there is one.
   *
   * The screens and the watch both read this format; a session that arrived as
   * "13.4 km @ Zone 4" rendered as a single line with nothing to do in it.
   */
  if (s.target_text) return s.target_text;
  const km = s.km ? `${s.km} km` : null;
  const p = s.prescription;
  if (!p) return km ?? undefined;

  const pace = p.kind === "pace"
    ? `${Math.floor(p.seconds_per_km / 60)}:${String(p.seconds_per_km % 60).padStart(2, "0")} /km`
    : p.kind === "hr" ? p.label
    : p.kind === "rpe" ? p.label
    : null;

  return [km, pace].filter(Boolean).join(" @ ") || undefined;
}

/**
 * Why this session exists. Shown to the athlete, never parsed.
 *
 * Carries the flags the prescription arrived with, because an uncalibrated pace
 * that looks like a measured one is worse than no pace at all.
 */
function note(s: Session, w: GeneratedWeek): string | undefined {
  /*
   * Why it matters comes first: the session screen shows the first line of the note
   * under "why this session matters", and it was getting whichever flag the pace
   * prescription happened to carry.
   */
  /*
   * Lines, not one paragraph — and the first line is the message.
   *
   * These were joined with a space, so a Hyrox session arrived as a nine-sentence wall:
   * the coach note, the class note, the alternation rule, the scoring caveat and the
   * pace provenance, all run together. The session screen shows the first line as the
   * coach's message and everything after it is detail, which is only true if the join
   * is a newline.
   *
   * And each bit is said once. The pace-source flag repeated most of what the coach
   * note had already said about compromised running.
   */
  const bits: string[] = [];
  if (s.why_text) bits.push(s.why_text);
  if (s.note_text) bits.push(s.note_text);
  if (String(s.kind) === "benchmark") {
    bits.push("The baseline test. Every pace after this is written from it.");
  }
  if (s.commitment) bits.push("Yours, not prescribed — the week is built around it.");
  if (w.deload) bits.push("Down week: the point is to arrive fresh, not to be tired.");
  /*
   * The pace provenance, only where it is not already obvious.
   *
   * It is worth saying that targets came from a goal rather than a measurement, and
   * not worth repeating on every session that fresh running is quicker than
   * compromised running — the coach note for a Hyrox session opens with that.
   */
  const p = s.prescription;
  if (p?.kind === "pace") {
    for (const f of p.flags) {
      if (f.code === "paces_from_race" && /compromised/i.test(bits.join(" "))) continue;
      bits.push(f.message);
    }
  }
  // Deduplicated: two sources occasionally produce the same sentence.
  const seen = new Set<string>();
  const lines = bits.filter((b) => {
    const k = b.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return lines.length ? lines.join("\n") : undefined;
}

/** One week of the plan, as days. */
const weekToDays = (w: GeneratedWeek): TemplateDay[] =>
  (w.sessions as Session[])
    .filter((s) => String(s.kind) !== "rest")
    .sort((a, b) => a.day - b.day)
    .map((s) => ({
      day: s.day,
      kind: String(s.kind),
      title: titleOf(s),
      minutes: minutes(s),
      target: target(s),
      coach_note: note(s, w),
      significance: significance(s),
      // Two sessions on one day: the second is the evening one. Ordering is by
      // day already, so the first keeps AM.
      slot: undefined as string | undefined,
    }))
    .map((d, i, all) => {
      const sameDay = all.filter((x) => x.day === d.day);
      if (sameDay.length < 2) return d;
      return { ...d, slot: sameDay.indexOf(d) === 0 ? "AM" : "PM" };
    });

export type Template = {
  weeks: TemplateDay[][];
  volume: { n: number; km: number; note: string; phase: string }[];
  /**
   * One per phase, with the weeks it covers and what those weeks are for.
   *
   * This was one row per week carrying only its phase name, which is not what the
   * app reads: the week screen looks for the range containing this week so it can
   * say what the phase is for, which sessions to protect, what to drop and what to
   * watch. Finding nothing, it showed "Off block" over a plan that was running.
   */
  intents: IntentRange[];
  rules: Record<string, unknown>;
};

export function toTemplate(g: Generated, maxHr: number | null = null): Template {
  return {
    weeks: g.weeks.map(weekToDays),
    volume: g.weeks.map((w) => ({
      n: w.n, km: w.km, phase: String(w.phase),
      // The week's own label, where it has one worth a chip on the plan screen.
      note: w.note
        || (w.deload ? "Down week" : w.taper ? "Taper" : w.benchmark ? "Benchmark" : ""),
    })),
    intents: intentRanges(g, maxHr),
    /*
     * Empty on purpose. `rules` exists so the old template could progress a long
     * run week to week without storing every week; this generator writes all of
     * them explicitly, so there is nothing left to extrapolate — and a rule that
     * also moved the numbers would fight the weeks it was applied to.
     */
    rules: {},
  };
}
