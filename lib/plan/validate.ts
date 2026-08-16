import type { Resolved } from "./resolve";
import type { Week } from "./skeleton";
import type { SlotKind } from "./slots";

/**
 * Stage 7: the assertions.
 *
 * A plan that fails one is never shipped, including via the dials — Aggressive
 * and Hard must still land inside these bounds. Failing loudly beats silently
 * correcting, because a plan quietly repaired is a plan nobody can explain.
 */

export type PlanWeek = Week & {
  sessions: { kind: SlotKind | string; km?: number; hard: boolean }[];
  /** what the volume curve asked for, where it differs from what was written */
  target_km?: number;
  /** below 1 where time away cut the week; 1 or absent otherwise */
  volumeFactor?: number;
};

export type Violation = { assertion: string; week?: number; detail: string };

/** Sessions measured in sets and loads rather than kilometres. */
const NO_TARGET_NEEDED = new Set(["strength", "hyrox", "benchmark", "rest"]);

export function validate(weeks: PlanWeek[], r: Resolved): Violation[] {
  const out: Violation[] = [];
  // The curve's peak, for the same reason every other share reads the curve.
  const peak = Math.max(...weeks.map((w) => w.target_km ?? w.km), 0);

  const loading = weeks.filter((w) => !w.deload && !w.taper);
  for (let i = 1; i < loading.length; i++) {
    /*
     * Against the plan's own trajectory, not against a week that was cut.
     *
     * A week reduced for time away is followed by a return to the planned curve,
     * which is not a ramp — but it read as one, the plan failed its own assertion,
     * and the whole block was softened by 10% because of a two-day trip in week 1.
     * The comparison uses what the previous week would have been.
     */
    /*
     * Against the curve, not against the sessions.
     *
     * The week now displays the sum of what it prescribes, which moves by a rep
     * here and a rounding there; the ramp is a property of the curve those sessions
     * were written to fill.
     */
    const prev = loading[i - 1];
    const prevKm = prev.target_km ?? prev.km;
    const base = prev.volumeFactor && prev.volumeFactor < 1
      ? prevKm / prev.volumeFactor
      : prevKm;
    const rise = (loading[i].target_km ?? loading[i].km) / base - 1;
    if (rise > r.ramp_rate + 0.02) {
      out.push({
        assertion: "week-on-week increase", week: loading[i].n,
        detail: `rose ${(rise * 100).toFixed(1)}% against a ${(r.ramp_rate * 100).toFixed(0)}% ramp`,
      });
    }
  }

  for (const w of weeks) {
    const hard = w.sessions.filter((s) => s.hard).length;
    if (hard > r.max_hard) {
      out.push({ assertion: "hard days per week", week: w.n,
        detail: `${hard} against a limit of ${r.max_hard}` });
    }

    const perDay = new Map<string, number>();
    for (const s of w.sessions) {
      if (!s.hard) continue;
      const key = String((s as { day?: number }).day ?? "");
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    for (const [, n] of perDay) {
      if (n > 1) out.push({ assertion: "hard sessions per day", week: w.n, detail: `${n} on one day` });
    }

    /*
     * The share checks read the curve as well, for the same reason the ramp does:
     * the sessions are written to fill it, and comparing a session to the rounded
     * sum of its siblings is comparing it to itself.
     */
    const weekKm = w.target_km ?? w.km;
    const longest = Math.max(0, ...w.sessions.map((s) => s.km ?? 0));
    if (weekKm > 0 && longest > weekKm * 0.4) {
      out.push({ assertion: "single session share", week: w.n,
        detail: `${longest} km of a ${weekKm} km week` });
    }

    const long = w.sessions.find((s) => s.kind === "long_run")?.km ?? 0;
    const strict = r.training_age === "novice" || r.training_age === "intermediate";
    if (strict && weekKm > 0 && long > weekKm * 0.35) {
      out.push({ assertion: "long run share", week: w.n,
        detail: `${long} km of a ${weekKm} km week, before advanced` });
    }

    /**
     * Every session WE prescribe needs something measurable to aim at.
     *
     * A commitment does not: kickboxing on a Thursday is the athlete's own
     * session, and the plan schedules around it rather than prescribing it.
     * Flagging those put fifteen assertion failures on an otherwise valid
     * plan — the assertion was measuring the wrong set.
     */
    const vague = w.sessions.filter((s) =>
      s.km === undefined && !NO_TARGET_NEEDED.has(String(s.kind)) && !("commitment" in s));
    if (vague.length) {
      out.push({ assertion: "measurable target", week: w.n,
        detail: `${vague.length} session(s) with nothing to aim at` });
    }
  }

  const race = weeks[weeks.length - 1];
  const raceKm = race ? (race.target_km ?? race.km) : 0;
  if (race && peak > 0 && raceKm > peak * 0.4) {
    out.push({ assertion: "race-week volume", week: race.n,
      detail: `${raceKm} km against a peak of ${peak}` });
  }

  // deload spacing
  let run = 0;
  for (const w of weeks) {
    if (w.taper) break;
    run = w.deload ? 0 : run + 1;
    if (run > r.max_block) {
      out.push({ assertion: "deload spacing", week: w.n,
        detail: `${run} loading weeks against a block of ${r.max_block}` });
    }
  }

  return out;
}

/**
 * Retry once, softer, then give up rather than shipping something broken.
 *
 * The brief's rule: regenerate at ramp × 0.8 and peak × 0.9, and on a second
 * failure return the last valid plan and raise an internal flag. Never ship a
 * plan that fails an assertion.
 */
export const SOFTEN = { ramp: 0.8, peak: 0.9 };

export function soften(r: Resolved): Resolved {
  return {
    ...r,
    ramp_rate: r.ramp_rate * SOFTEN.ramp,
    peak_ceiling: Math.round(r.peak_ceiling * SOFTEN.peak * 10) / 10,
  };
}
