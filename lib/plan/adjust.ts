import { ABSENCE_EFFECT, needsReEntry, type Absence } from "./intake-rules";
import { addDays } from "../dates";
import type { Role } from "./allocate";
import type { PhaseName, Week } from "./skeleton";

/**
 * Stage 6: what the athlete's real life does to the plan.
 *
 * Commitments they already keep, weeks they are away, and things their body
 * will not do. All of it only ever subtracts or reshapes — none of it invents
 * work.
 */

export type Transfer = "high" | "partial" | "low";
export type LegCost = "low" | "medium" | "high";

export type Classification = {
  transfer: Transfer;
  leg_cost: LegCost;
  /** what one session counts as, against the week's volume */
  credit: number;
  /** whether it can stand in for the Hyrox session rather than sit beside it */
  replaces_hyrox?: boolean;
  why: string;
};

/**
 * Sport × format, not sport alone.
 *
 * A steady row and a hard row class are the same machine and different
 * training, and the difference decides both what it counts for and where in
 * the week it can go.
 */
export const COMMITMENT: Record<string, Classification> = {
  row_steady: {
    transfer: "high", leg_cost: "low", credit: 1.0,
    why: "Aerobic work on a race machine, at a cost your legs barely notice.",
  },
  ski_steady: {
    transfer: "high", leg_cost: "low", credit: 1.0,
    why: "Aerobic work on a race machine, at a cost your legs barely notice.",
  },
  swim: {
    transfer: "high", leg_cost: "low", credit: 1.0,
    why: "Aerobic with almost no leg cost — the cheapest volume there is.",
  },
  row_class: {
    transfer: "high", leg_cost: "medium", credit: 0.8,
    why: "The right machine, harder than steady, so it costs a little more than it gives.",
  },
  cycling_steady: {
    transfer: "partial", leg_cost: "low", credit: 0.6,
    why: "Aerobic, but it does not load the running tissue.",
  },
  spin: {
    transfer: "partial", leg_cost: "high", credit: 0.3,
    why: "High cadence, interval structure, uncontrolled intensity. The quads pay for it.",
  },
  hyrox_class: {
    transfer: "partial", leg_cost: "medium", credit: 0.5, replaces_hyrox: true,
    why: "Close enough to the sport to stand in for the Hyrox session.",
  },
  kickboxing: {
    transfer: "low", leg_cost: "high", credit: 0,
    why: "A hard day whether or not it is planned as one, and it builds none of this.",
  },
  football: {
    transfer: "low", leg_cost: "high", credit: 0,
    why: "Sprints and changes of direction with no control over the intensity.",
  },
  climbing: {
    transfer: "low", leg_cost: "high", credit: 0,
    why: "Grip helps the carries; the legs still pay and nothing aerobic comes back.",
  },
};

export const classify = (kind: string): Classification =>
  COMMITMENT[kind] ?? {
    transfer: "partial", leg_cost: "medium", credit: 0.2,
    why: "Unclassified, so counted conservatively.",
  };

/**
 * How much a commitment can substitute for real training, by phase.
 *
 * It decays because the limiter moves. Early the constraint is aerobic
 * capacity, which a rower builds perfectly well; late it is running economy,
 * and only running builds that.
 */
export const SUBSTITUTION_DECAY: Record<PhaseName, number> = {
  base: 0.40, build: 0.25, specific: 0.10, taper: 0,
};

/** Kilometre-equivalents a commitment contributes to a week. */
export function creditFor(
  kind: string, sessionsThisWeek: number, weeklyKm: number, phase: PhaseName,
): number {
  const c = classify(kind);
  if (c.credit === 0) return 0;
  const perSession = weeklyKm / 4; // a session's worth of the week
  return c.credit * SUBSTITUTION_DECAY[phase] * sessionsThisWeek * perSession;
}

/**
 * A locked commitment protects its frequency, and nothing else.
 *
 * Someone who says "spin is non-negotiable, twice a week" has committed to
 * going twice, not to going on the two days that happen to sit either side of
 * their key session — so placement and intensity guidance stay with the plan.
 */
export const lockedProtects = (locked: boolean) =>
  locked ? { frequency: true, placement: false, intensity: false }
         : { frequency: false, placement: false, intensity: false };

// ------------------------------------------------------------------ absences

export type AdjustedWeek = Week & { volumeFactor: number; reason?: string };

const overlaps = (a: Absence, from: string, to: string) =>
  a.from_date <= to && a.to_date >= from;

/** How many days of this week the athlete is away for, 1 to 7. */
function daysInWeek(a: Absence, weekFrom: string): number {
  const day = 86_400_000;
  const ws = Date.parse(`${weekFrom}T00:00:00Z`);
  const we = ws + 6 * day;
  const from = Math.max(ws, Date.parse(`${a.from_date}T00:00:00Z`));
  const to = Math.min(we, Date.parse(`${a.to_date}T00:00:00Z`));
  return Math.max(1, Math.min(7, Math.round((to - from) / day) + 1));
}

/**
 * Apply time away.
 *
 * Three things happen, and the third is the one usually missed. The week is
 * cut; a down week snaps onto the trip rather than sitting next to it; and any
 * real absence of ten days or more earns a return week at 60%, because
 * resuming at full volume after two weeks off is where the injuries are and
 * that is independent of whatever the trip week was cut to.
 */
export function applyAbsences(
  weeks: Week[], absences: Absence[], weekStart: (n: number) => string,
): { weeks: AdjustedWeek[]; flags: { code: string; message: string }[] } {
  const flags: { code: string; message: string }[] = [];
  const out: AdjustedWeek[] = weeks.map((w) => ({ ...w, volumeFactor: 1 }));

  for (const a of absences) {
    const effect = ABSENCE_EFFECT[a.type];
    let last = -1;

    for (const w of out) {
      const from = weekStart(w.n);
      /*
       * The week's last day, not the next week's first.
       *
       * `weekStart(n + 1)` made every week eight days long for the purposes of
       * this test, so a trip starting on a Monday also cut the week before it —
       * invisible while the cut was a flat factor and obvious the moment it was
       * counted in days ("1 day away" against a week the athlete was home for).
       */
      const to = addDays(from, 6);
      if (!overlaps(a, from, to)) continue;
      last = w.n;

      if (effect.volume < 1) {
        /*
         * The cut is proportional to the days actually away.
         *
         * A flat factor per overlapping week meant two days away cut the whole
         * week to 60% — fifteen kilometres for a long weekend, with five normal
         * days either side of it. The days away are worth what the access allows
         * and the rest of the week is worth what it was: a full week away still
         * lands on the old factor, which is the case it was written for.
         */
        const away = daysInWeek(a, from);
        const factor = Math.round(((7 - away) + away * effect.volume) / 7 * 100) / 100;
        w.km = Math.max(3, Math.round(w.km * factor * 10) / 10);
        w.volumeFactor = factor;
        const days = `${away} day${away === 1 ? "" : "s"} away`;
        w.reason = a.type === "no_training"
          ? `${days} — nothing scheduled on them`
          : `${days} — limited access`;
        /*
         * The down week moves onto the trip rather than being spent beside it —
         * unless the trip is in week 1, where there is nothing to recover from
         * yet and it would only compound the cut. A deload also has to be worth
         * moving: half a week away is not a down week.
         */
        if (effect.consumesDeload && w.n > 1 && factor <= 0.8) w.deload = true;
      } else {
        // training as normal does not consume a down week: they have not had one
        w.reason = "Away, training as normal";
      }
    }

    if (last > 0 && needsReEntry(a)) {
      const re = out.find((w) => w.n === last + 1 && !w.taper);
      if (re) {
        re.km = Math.max(3, Math.round(re.km * 0.6 * 10) / 10);
        re.volumeFactor = 0.6;
        re.reason = "Back from time away — 40% down, ramping over two weeks";
        const second = out.find((w) => w.n === last + 2 && !w.taper);
        if (second) {
          second.km = Math.max(3, Math.round(second.km * 0.8 * 10) / 10);
          second.volumeFactor = 0.8;
          second.reason = "Second week back";
        }
        flags.push({
          code: "re_entry",
          message:
            "You are away for ten days or more, so the week you come back is 40% down and ramps over two. Picking up where you left off is where the injuries are.",
        });
      }
    }
  }
  return { weeks: out, flags };
}

// ---------------------------------------------------------------- benchmarks

/**
 * Where the benchmark goes, if the athlete wants one.
 *
 * One, at the start, and only when asked for. It is an offer rather than a
 * prescription: a test is a hard session that costs a week of training, and
 * repeating it on a schedule spends that cost again for a number nobody asked
 * to know. An athlete who wants to retest can log one whenever they like — the
 * plan reads it the same way — but nothing here puts one in the calendar.
 *
 * Week 1 unless week 1 is an absence, in which case the first week they are
 * actually training: a test run on a trip measures the trip.
 */
export function benchmarkWeeks(
  length: number, isAway: (n: number) => boolean, wanted = true,
): number[] {
  if (!wanted || length < 1) return [];
  let n = 1;
  while (isAway(n) && n < length) n++;
  return isAway(n) ? [] : [n];
}

// ---------------------------------------------------------------- exclusions

/**
 * Injuries only ever remove.
 *
 * A substitution table that adds work is a table that invents training the
 * athlete did not ask for and their physio has not seen.
 */
export const EXCLUSIONS: Record<string, { removes: string[]; substitute: string | null }> = {
  lunges: { removes: ["sandbag_lunge", "walking_lunge"], substitute: "split_squat_bodyweight" },
  running_impact: { removes: ["long_run", "quality_run", "easy_run"], substitute: "row_steady" },
  overhead: { removes: ["wall_balls", "overhead_press"], substitute: "front_raise_light" },
  loaded_carry: { removes: ["farmers_carry", "sandbag_carry"], substitute: null },
  jumping: { removes: ["burpee_broad_jump"], substitute: "burpee_step_out" },
};

export function applyExclusions(
  sessions: { kind: string }[], exclusions: string[],
): { sessions: { kind: string }[]; flags: { code: string; message: string }[] } {
  const flags: { code: string; message: string }[] = [];
  let out = sessions;
  for (const e of exclusions) {
    const rule = EXCLUSIONS[e];
    if (!rule) continue;
    const hit = out.filter((s) => rule.removes.includes(s.kind));
    if (hit.length === 0) continue;
    out = out.map((s) => (rule.removes.includes(s.kind) && rule.substitute
      ? { ...s, kind: rule.substitute } : s))
      .filter((s) => !(rule.removes.includes(s.kind) && !rule.substitute));
    flags.push({
      code: `excluded_${e}`,
      message: rule.substitute
        ? `${e.replace(/_/g, " ")} is excluded, so those sessions use a substitute throughout.`
        : `${e.replace(/_/g, " ")} is excluded, so those sessions are removed rather than replaced.`,
    });
  }
  return { sessions: out, flags };
}

// ----------------------------------------------------------------- role bias

/**
 * What the role emphasises inside the station work.
 *
 * It biases which stations get the attention, never how much station work
 * there is — that is the allocation's job, and doing it twice would compound.
 */
export const ROLE_BIAS: Record<Role, string[]> = {
  protected: ["ski", "row"],
  run_limiter: ["ski", "row"],
  balanced: ["ski", "row", "sled", "lunges"],
  station_carrier: ["sled", "lunges", "farmers_carry"],
};
