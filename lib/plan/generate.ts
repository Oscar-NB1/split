import { type Allocation, type Goal, type Role, allocationFor, roleFrom } from "./allocate";
import { applyAbsences, benchmarkWeeks, creditFor } from "./adjust";
import { type Absence } from "./intake-rules";
import { canDoStations, ladderFor, otherLadder, rungFor } from "./ladders";
import { continuousRun, hyroxSession, qualityRun } from "./session";
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
  /** the prescription, in the syntax the app parses and the watch understands */
  target_text?: string;
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
const SHARE: Partial<Record<SlotKind, number>> = {
  long_run: 0.32, quality_run: 0.22, easy_run: 0.20, hyrox: 0.18,
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
      quality_target: p.quality_target,
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
    const credited = p.commitments.reduce(
      (n, c) => n + creditFor(c.activity, c.per_week, w.km, w.phase), 0);
    const runnable = Math.max(3, Math.round((w.km - credited) * 10) / 10);

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
    const hyroxRung = stations
      ? rungFor("L6", p.running_base, inPhase, w.phase).label
      : null;

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
    const sessions: Session[] = placed.week.map((s) => {
      const isQuality = s.kind === "quality_run";
      const second = isQuality && qualitySeen++ > 0;
      const thisRung = second
        ? rungFor(otherLadder(ladder, stations), p.running_base, inPhase, w.phase)
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
          : s.kind === "hyrox" && hyroxRung ? `Hyrox · ${hyroxRung.toLowerCase()}`
          : String(s.kind)),
        km: share ? Math.round(runnable * share * 10) / 10 : undefined,
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
    const longRun = sessions.find((s) => String(s.kind) === "long_run");
    if (longRun) {
      const built = continuousRun(Math.max(5, Math.min(w.km * 0.30, runnable * 0.34)),
        easyPace);
      longRun.km = built.km;
      longRun.target_text = built.target;
      longRun.minutes = built.minutes;
    }

    let spent = longRun?.km ?? 0;
    for (const s of sessions) {
      const kind = String(s.kind);
      if (kind === "long_run") continue;
      if (kind === "quality_run" || kind === "benchmark") {
        // No single session may exceed 40% of the week — the bound the plan asserts
        // against itself, applied where the session is built rather than checked
        // after the fact.
        const built = qualityRun(s.label, cvPace, easyPace, w.km * 0.38);
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
        if (built.title && kind === "quality_run") s.label = built.title;
      } else if (kind === "hyrox") {
        const built = hyroxSession(s.label, easyPace);
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
      }
      spent += s.km ?? 0;
    }
    const easies = sessions.filter((s) => String(s.kind) === "easy_run");
    // Whatever the week has left over goes to the easy running, which is what easy
    // running is for: the volume that makes the hard days possible.
    const left = Math.max(easies.length * 3, runnable - spent);
    for (const s of easies) {
      const built = continuousRun(Math.max(3, left / easies.length), easyPace);
      s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
    }

    return {
      ...w, allocation, benchmark: benchmarks.has(w.n), sessions,
      km: w.km,
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
