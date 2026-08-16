import { type Allocation, type Goal, type Role, allocationFor, roleFrom } from "./allocate";
import { applyAbsences, benchmarkWeeks, creditFor } from "./adjust";
import { type Absence } from "./intake-rules";
import { canDoStations, ladderFor, rungFor } from "./ladders";
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

    // the benchmark replaces ONE quality run, not every one of them
    let benchTaken = false;
    const sessions: Session[] = placed.week.map((s) => {
      const isQuality = s.kind === "quality_run";
      const isBench = benchmarks.has(w.n) && isQuality && !benchTaken;
      if (isBench) benchTaken = true;
      const share = SHARE[s.kind as SlotKind];
      const isCommitment = p.commitments.some((c) => c.activity === s.kind);
      return {
        day: s.day,
        kind: isBench ? "benchmark" : s.kind,
        ...(isCommitment ? { commitment: true } : {}),
        hard: s.hard,
        label: isBench ? "Benchmark test" : isQuality ? rung.label : String(s.kind),
        km: share ? Math.round(runnable * share * 10) / 10 : undefined,
        prescription: share
          ? prescribe(p.anchor, isQuality ? "cv" : s.kind === "long_run" ? "long" : "easy",
              p.max_hr, isQuality ? 4 : 2, isQuality ? 7 : 4)
          : null,
      };
    });

    return {
      ...w, allocation, benchmark: benchmarks.has(w.n), sessions,
      km: w.km,
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
