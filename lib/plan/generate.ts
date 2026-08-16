import { type Allocation, type Goal, type Role, allocationFor, roleFrom } from "./allocate";
import { applyAbsences, benchmarkWeeks, creditFor } from "./adjust";
import { type Absence } from "./intake-rules";
import { canDoStations, ladderFor, otherLadder, otherRung, rungFor } from "./ladders";
import {
  continuousRun, hyroxClass, hyroxSession, longRun, qualityRun, type LongShape,
} from "./session";
import { kitFrom, strengthNote, strengthTarget } from "./strength";
import { type Anchor, prescribe } from "./paces";
import { type ResolveInput, type Resolved, resolve } from "./resolve";
import { type PhaseName, type Week, skeleton } from "./skeleton";
import { type Commitment, type SlotKind, allocateSlots, placeWeek } from "./slots";
import { type PlanWeek, type Violation, soften, validate } from "./validate";

/**
 * The generator, composed.
 *
 * `generate(params) → { weeks, flags }` and nothing else: no I/O, no clock, no
 * model call. Same input, same output, which is what makes a plan explainable
 * six months later and what stops anything inventing a 40 km week for a
 * beginner.
 */

export const GENERATOR_VERSION = "3.0.0";

export type Params = ResolveInput & {
  length: number;
  /** which days of the week, 0 = Monday. `available_days` on ResolveInput is a count. */
  days: number[];
  rest_day: "full" | "easy" | "none";
  /** quality runs a week, from the difficulty dial */
  quality_target?: number;
  /** what the athlete said they can reach, for the strength lifts */
  equipment?: string[];
  /** whether the station work is written out, attended as classes, or mixed */
  session_style?: "written" | "classes" | "mix";
  /** whether the long run carries a pace target */
  long_run_pace?: boolean;
  /** 0 = Monday, or null for no preference */
  long_run_day: number | null;
  discipline: "doubles" | "singles" | "running";
  goal: Goal;
  partner: { run_delta: number; station_delta: number } | null;
  variant: string;
  max_hr: number | null;
  anchor: Anchor | null;
  commitments: Commitment[];
  absences: Absence[];
  exclusions: string[];
  /**
   * Whether the athlete wants a baseline test at the start. Optional, asked
   * once, never scheduled again — see benchmarkWeeks.
   */
  benchmark?: boolean;
  week_start: (n: number) => string;
  /** the athlete's first day, which may be mid-week; week 1 is short */
  first_day?: string;
};

export type Session = {
  day: number; kind: SlotKind | string; hard: boolean;
  label: string; km?: number;
  /** which ladder this session came from, which decides how fast its work is */
  ladder?: string;
  /** the prescription, in the syntax the app parses and the watch understands */
  target_text?: string;
  /** one line about the session, where the kind has something worth saying */
  note_text?: string;
  /** how long it takes, from what is in it rather than from its distance */
  minutes?: number;
  /** true when this is the athlete's own session, scheduled around rather than prescribed */
  commitment?: boolean;
  prescription: ReturnType<typeof prescribe> | null;
};

export type GeneratedWeek = PlanWeek & {
  phase: PhaseName; allocation: Allocation; benchmark: boolean;
  sessions: Session[];
};

export type Generated = {
  version: string;
  role: Role;
  resolved: Resolved;
  weeks: GeneratedWeek[];
  flags: { code: string; message: string }[];
  violations: Violation[];
};

/** Roughly what share of a week's kilometres each kind of session carries. */
/**
 * Where a long run stops being worth it.
 *
 * The race is eight one-kilometre repeats with stations between them. Twenty-two
 * kilometres builds every bit of durability that demands; twenty-six buys fatigue.
 */
export const LONG_RUN_CAP = 22;

const SHARE: Partial<Record<SlotKind, number>> = {
  long_run: 0.32, quality_run: 0.22, easy_run: 0.20, hyrox: 0.18, easy_hyrox: 0.10,
};

function build(p: Params, r: Resolved): Omit<Generated, "violations"> {
  const flags: { code: string; message: string }[] = [];
  for (const f of r.flags) flags.push({ code: "resolve", message: f });

  const role = p.partner
    ? roleFrom(p.partner.run_delta, p.partner.station_delta)
    : ("balanced" as Role);
  if (!p.partner && p.discipline === "doubles") {
    flags.push({
      code: "no_partner_deltas",
      message:
        "No comparison with your partner yet, so the week is split evenly. Answer that and the plan specialises.",
    });
  }

  const { weeks: bare, flags: phaseFlags } = skeleton(r, p.length);
  for (const f of phaseFlags) flags.push({ code: "phase", message: f });

  const { weeks: adjusted, flags: absenceFlags } =
    applyAbsences(bare, p.absences, p.week_start);
  flags.push(...absenceFlags);

  const awayWeeks = new Set(adjusted.filter((w) => w.reason?.startsWith("Away")).map((w) => w.n));
  const benchmarks = new Set(
    benchmarkWeeks(p.length, (n) => awayWeeks.has(n), p.benchmark !== false),
  );

  const stations = canDoStations(p.variant) && p.discipline !== "running";
  const seenPhase = new Map<PhaseName, number>();

  const weeks: GeneratedWeek[] = adjusted.map((w: Week & { reason?: string }) => {
    const inPhase = seenPhase.get(w.phase) ?? 0;
    seenPhase.set(w.phase, inPhase + 1);

    const allocation = allocationFor(role, p.goal, w.phase,
      p.discipline === "singles" ? "singles" : "doubles");

    const slotPlan = allocateSlots({
      target_sessions: r.sessions, allocation,
      discipline: p.discipline, commitments: p.commitments, max_hard: r.max_hard,
      quality_target: p.quality_target, phase: w.phase,
      /*
       * Alternating weeks, from the block's own count rather than a setting: every
       * other loading week absorbs. The deload weeks are already light, so they are
       * left out of the alternation rather than being made lighter again.
       */
      absorb: !w.deload && !w.taper && w.n % 2 === 0,
    });
    for (const f of slotPlan.flags) flags.push({ code: "slots", message: f });

    const placed = placeWeek({
      slots: slotPlan.slots, available_days: p.days,
      commitments: p.commitments, training_age: r.training_age,
      rest_day: p.rest_day, allow_doubles: p.allow_doubles ?? false,
      long_run_day: p.long_run_day,
    });
    for (const f of placed.flags) flags.push({ code: "placement", message: f });

    // commitments give some of the week's volume back, less and less as the
    // block goes on
    /*
     * The week's running is the week's running.
     *
     * Commitments used to buy it down — two kickboxing sessions credited nine
     * kilometres of "equivalent volume", so a 60 km week prescribed 48 km of actual
     * running and the athlete was short of their own target every week. A class the
     * athlete already attends is load on top of the plan, not running the plan no
     * longer has to write. The credit still exists for the load budget; it no longer
     * reduces what gets prescribed.
     */
    const runnable = Math.max(3, Math.round(w.km * 10) / 10);

    const ladder = ladderFor(w.phase, inPhase, stations);
    const rung = rungFor(ladder, p.running_base, inPhase, w.phase);
    /*
     * The Hyrox session is named as well.
     *
     * It was labelled "hyrox" and titled "Hyrox session", which says only that it
     * exists. The race-specific ladder already describes what the session is —
     * compromised running, transitions, a half or full simulation — and it
     * progresses with the phase, so the name says what week of the block it is.
     */
    const hyroxRungAt = stations ? rungFor("L6", p.running_base, inPhase, w.phase) : null;
    const hyroxRung = hyroxRungAt?.label ?? null;
    // The second one in a week is deliberately a different rung of the same ladder.
    const hyroxRung2 = hyroxRungAt ? otherRung("L6", hyroxRungAt.rung) : null;

    // the benchmark replaces ONE quality run, not every one of them
    let benchTaken = false;
    /*
     * The second quality run is a different session, not the same one twice.
     *
     * A Hard week asks for two, and both were written from the same ladder rung —
     * "4 × 8 min" on Monday and "4 × 8 min" on Tuesday. The second draws from the
     * next rung in the cycle, so the week holds two different stimuli.
     */
    let qualitySeen = 0;
    /** Which ladder each quality run came from, so it can be paced as itself. */
    const secondLadder = otherLadder(ladder, stations);
    /*
     * Two Hyrox sessions in a week were the same session twice — the same rung, the
     * same name, on consecutive days. The second takes the next rung of the
     * race-specific ladder, so a week that carries two carries two different ones.
     */
    let hyroxSeen = 0;
    const sessions: Session[] = placed.week.map((s) => {
      const isQuality = s.kind === "quality_run";
      const second = isQuality && qualitySeen++ > 0;
      const thisLadder = second ? secondLadder : ladder;
      const thisRung = second
        ? rungFor(secondLadder, p.running_base, inPhase, w.phase)
        : rung;
      const isBench = benchmarks.has(w.n) && isQuality && !benchTaken;
      if (isBench) benchTaken = true;
      const share = SHARE[s.kind as SlotKind];
      const isCommitment = p.commitments.some((c) => c.activity === s.kind);
      return {
        day: s.day,
        kind: isBench ? "benchmark" : s.kind,
        ...(isCommitment ? { commitment: true } : {}),
        hard: s.hard,
        label: s.label ?? (isBench ? "Benchmark test"
          : isQuality ? thisRung.label
          : s.kind === "easy_hyrox" ? "Easy Hyrox · ski, row and carries"
          : s.kind === "hyrox" && hyroxRung
            ? `Hyrox · ${(hyroxSeen++ === 0 ? hyroxRung : hyroxRung2 ?? hyroxRung).toLowerCase()}`
          : String(s.kind)),
        km: share ? Math.round(runnable * share * 10) / 10 : undefined,
        ladder: isQuality ? thisLadder : undefined,
        prescription: share
          ? prescribe(p.anchor, isQuality ? "cv" : s.kind === "long_run" ? "long" : "easy",
              p.max_hr, isQuality ? 4 : 2, isQuality ? 7 : 4)
          : null,
      };
    });

    /*
     * What is actually in each session, and what that costs.
     *
     * Until here a session was a name and a share of the week's kilometres, which
     * is why "2 × 15 min" and "5 × 1000 m" both came out as 13.4 km and 80 minutes,
     * and why the screen underneath either of them was empty. The prescription is
     * written now — warm-up, the reps, the rest between them, the cool-down — and
     * the distance and the time are read back off it.
     *
     * The easy runs absorb the difference, so the week still totals what the volume
     * curve says: a quality session that costs less than its share gives the
     * remainder back to the easy running rather than to nobody.
     */
    const cvPace = p.anchor?.cv_pace_s_per_km ?? 300;
    // Easy is a fixed distance from the critical-velocity pace: there is no
    // separate easy anchor, and inventing one here would be a second opinion.
    const easyPace = Math.round(cvPace * 1.25);
    /*
     * The long run is paid first.
     *
     * It was paid last, out of whatever the quality sessions had not spent — which
     * in a 54 km week left a "long run" of 4.4 km. It is the session the block is
     * built from, so it takes its share of the week before anything else is sized,
     * and the quality work fits around it.
     */
    const long = sessions.find((s) => String(s.kind) === "long_run");
    if (long) {
      /*
       * What the long run asks for follows the difficulty dial, which the screen has
       * been promising and the plan has been ignoring: distance alone on Steady, a
       * quarter at effort on Challenging, and blocks — or a whole run at an average —
       * on Hard, because switching pace under fatigue is the demand of the race.
       */
      /*
       * The long run carries the quality in the absorb week, and nothing in the
       * load week.
       *
       * A week with two hard sessions in it does not need a third; a week with one
       * can afford to put pace inside the long run, which is where running under
       * fatigue is actually trained. So the same block alternates: intervals and a
       * plain long run one week, one interval session and a structured long run the
       * next — at the same volume, differently spent.
       */
      const absorbWeek = !w.deload && !w.taper && w.n % 2 === 0;
      const shape: LongShape = !p.long_run_pace || !absorbWeek ? "steady"
        : (p.quality_target ?? 1) < 2 ? "finish"
        : w.n % 4 === 0 ? "timed"
        : "blocks";
      const steady = Math.round(cvPace * 1.12);
      /*
       * It grows with the block and then stops.
       *
       * Past about 22 km a long run costs a Hyrox athlete more in recovery than it
       * returns: the race is eight kilometre repeats, not a marathon, and the
       * durability it needs is trained by the blocks inside the run rather than by
       * another four kilometres on the end.
       */
      const built = longRun(
        Math.max(5, Math.min(LONG_RUN_CAP, w.km * 0.32, runnable * 0.36)),
        easyPace, steady, w.taper || w.deload ? "steady" : shape, String(w.phase));
      long.km = built.km;
      long.target_text = built.target;
      long.minutes = built.minutes;
    }

    let spent = long?.km ?? 0;
    for (const s of sessions) {
      const kind = String(s.kind);
      if (kind === "long_run") continue;
      if (kind === "quality_run" || kind === "benchmark") {
        // No single session may exceed 40% of the week — the bound the plan asserts
        // against itself, applied where the session is built rather than checked
        // after the fact.
        const built = qualityRun(s.label, cvPace, easyPace, w.km * 0.38, inPhase,
          s.ladder ?? "L4");
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
        if (built.title && kind === "quality_run") s.label = built.title;
      } else if (kind === "hyrox") {
        /*
         * A class where the athlete said they train in classes. "Mix" is classes for
         * the stations too — the intervals are the part it keeps written.
         */
        const asClass = p.session_style === "classes" || p.session_style === "mix";
        const built = asClass ? hyroxClass(s.label) : hyroxSession(s.label, easyPace);
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
        if (built.title) s.label = built.title;
        if (built.note) s.note_text = built.note;
      } else if (kind === "easy_hyrox") {
        const built = hyroxSession(s.label, easyPace, 3);
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
      } else if (kind === "strength") {
        /*
         * The lifts, which were never written at all — the screen said "no lifts
         * prescribed for this one" above a session the plan had told the athlete to
         * protect. Chosen from the equipment they said they can reach.
         */
        s.target_text = strengthTarget(w.phase, w.n, kitFrom(p.equipment));
        s.note_text = strengthNote(w.phase);
      }
      /*
       * Easy runs are not counted here: they are sized from what is left, and
       * counting their placeholder share first meant they were subtracted from
       * their own budget. That is why an absorb week came out smaller — the second
       * interval session became an easy run and then the easy runs were funded from
       * a total that already pretended they existed.
       */
      if (kind !== "easy_run") spent += s.km ?? 0;
    }
    const easies = sessions.filter((s) => String(s.kind) === "easy_run");
    /*
     * Easy running fills the week to its target.
     *
     * Not "whatever is left over" — the difference between the prescribed sessions
     * and the week's volume is real running that has to be written somewhere, and
     * easy running is where it belongs. This is also what stops an absorb week from
     * being a smaller week: the second interval session becomes an easy run of the
     * same volume, not a shorter one.
     */
    const left = Math.max(easies.length * 4, runnable - spent);
    /*
     * An easy run has a ceiling, and it is the long run.
     *
     * Filling the week from one easy session produced a 19.9 km "easy run" beside a
     * 19.5 km long run — two long runs, one of them mislabelled. An easy run is
     * capped at two thirds of the long run; whatever will not fit goes onto the long
     * run itself, up to its own cap, and anything still left over is said out loud
     * rather than quietly added to a session that cannot hold it.
     */
    const longKm = long?.km ?? 0;
    const easyCap = Math.max(6, longKm * 0.67);
    let spill = 0;
    for (const s of easies) {
      const want = Math.max(3, left / easies.length);
      const km = Math.min(want, easyCap);
      spill += want - km;
      const built = continuousRun(km, easyPace);
      s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
    }
    /*
     * What will not fit is said, not hidden.
     *
     * The obvious place to put it is the long run, and that is the wrong place: the
     * long run's length is a training decision that progresses across the block, not
     * a bucket for the arithmetic's leftovers. A week whose volume needs a day it
     * does not have should say so.
     */
    if (spill > 1) {
      flags.push({
        code: "volume_spill",
        message: `Week ${w.n} carries about ${Math.round(spill)} km more running than ${
          easies.length + 1} running days can sensibly hold. Another day would take it; otherwise the week runs a little under.`,
      });
    }

    /*
     * The week's number is the sum of what it asks for.
     *
     * It was the volume curve's number, while the sessions written under it added up
     * to twelve kilometres less — the commitment credit was subtracted from what got
     * prescribed and not from what was displayed. Every screen quoted the target, so
     * an athlete doing exactly what they were told was short of it every week. The
     * curve still governs the ramp and the ceiling; it is no longer also a promise
     * nobody kept.
     */
    const prescribed = Math.round(
      sessions.reduce((n, s) => n + (s.km ?? 0), 0) * 10) / 10;

    return {
      ...w, allocation, benchmark: benchmarks.has(w.n), sessions,
      km: prescribed || w.km,
      /**
       * What the volume curve asked for, kept beside what was written.
       *
       * The ramp assertion is about the curve — it is the rule the curve is built
       * to obey — while the number on the screen has to be the sum of the sessions.
       * Checking the ramp against the prescribed sum failed the plan for rounding:
       * a session gaining a rep is not the block breaking its ramp.
       */
      target_km: w.km,
      /*
       * Why this week is what it is, in one phrase.
       *
       * The reason from the absence stage was being dropped and the week carried
       * "Down week" instead — true, and not the answer to "why is my first week
       * 22.8 km". The trip is the reason; the down week is a consequence of it.
       */
      note: w.reason ?? w.note,
    };
  });

  return { version: GENERATOR_VERSION, role, resolved: r, weeks, flags };
}

/**
 * Generate, and never ship something that fails an assertion.
 *
 * One retry at a softer ramp and peak, then give up rather than quietly
 * shipping a plan that breaks its own rules — the failure is returned so it can
 * be looked at, not swallowed.
 */
export function generate(p: Params): Generated {
  let r = resolve(p);
  let out = build(p, r);
  let violations = validate(out.weeks, r);
  if (violations.length === 0) return { ...out, violations };

  r = soften(r);
  out = build(p, r);
  violations = validate(out.weeks, r);
  if (violations.length === 0) {
    return {
      ...out, violations,
      flags: [...out.flags, {
        code: "softened",
        message: "The first attempt broke a safety bound, so the ramp and peak came down.",
      }],
    };
  }
  return { ...out, violations };
}
