import type { Generated, GeneratedWeek, Session } from "./generate";

/**
 * What each phase of the block is for, and how to hold it together.
 *
 * The week screen has four questions to answer beyond the sessions themselves:
 * what these weeks are for, which sessions must survive a bad week, what goes
 * first when something has to, and what quietly ruins it. All four are derivable
 * from the plan, and derived here rather than written by hand — a purpose typed
 * into a design and a plan built by a generator drift apart in a fortnight.
 *
 * Pure: weeks in, sentences out.
 */

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type Intent = {
  phase: string;
  purpose: string;
  /** the sessions that must survive a bad week, as "Tue · 6 × 800 m" */
  protect: string[];
  sacrifice: string;
  watch: string;
};
export type IntentRange = Intent & { from: number; to: number };

/**
 * What each phase is called, in words rather than in jargon.
 *
 * "Base", "Build", "Specific", "Taper" are what a coach calls them to another
 * coach. An athlete reading their own week wants to know what these weeks are
 * doing to them, and the label is the first half of that answer — the purpose
 * underneath is the second.
 */
export const PHASE_LABEL: Record<string, string> = {
  base: "Rebuilding the base",
  build: "Building the engine",
  specific: "Race-specific work",
  taper: "Taper — arriving fresh",
};

/** What the weeks of each phase are actually for, in the plan's own terms. */
const PURPOSE: Record<string, string> = {
  base:
    "Get the running volume back to a level your body already knows. Nothing here is meant to hurt — the block is bought with consistency now, not with intensity.",
  build:
    "The same volume, with harder work inside it. This is where the fitness is made, and where a week of poor sleep costs the most.",
  specific:
    "Race-shaped work: running off the stations, transitions, the order you will meet them in. Volume stops climbing and the sessions start to look like race day.",
  taper:
    "Volume comes down, intensity stays. The training is done — the job now is to arrive fresh rather than fit and tired.",
};

/**
 * Which session to drop first, and which never to.
 *
 * Ordered by what the plan can afford to lose: the athlete's own commitments cost
 * load without buying anything race-specific, then strength, then easy running.
 * The long run is never on the list — it is the session the whole block is built
 * from, and an athlete told to drop it will drop it every busy week.
 */
function sacrificeOf(week: GeneratedWeek): string {
  const sessions = week.sessions as Session[];
  const dayOf = (s: Session) => DAY[s.day] ?? "";
  const commitments = sessions.filter((s) => s.commitment);
  const strength = sessions.find((s) => String(s.kind) === "strength");
  const easy = sessions.filter((s) => String(s.kind) === "easy_run");

  const order: string[] = [];
  if (easy.length > 1) order.push(`${dayOf(easy[easy.length - 1])} easy run`);
  if (strength) order.push(`${dayOf(strength)} strength`);
  for (const c of commitments) order.push(`${dayOf(c)} ${c.label}`);

  if (order.length === 0) {
    return "There is nothing spare in this week. If one has to go, make it the shorter easy run — never the long run.";
  }
  const first = order[0];
  const then = order.slice(1, 3);
  return `${first.charAt(0).toUpperCase()}${first.slice(1)} goes first${
    then.length ? `, then ${then.join(", then ")}` : ""
  }. Never the long run.`;
}

/**
 * The failure mode of this phase, said as something to notice.
 *
 * Easy running drifting upwards is the one that costs the hard sessions, and it is
 * invisible while it happens. Where there is a heart-rate ceiling to quote it is
 * quoted, because "keep it easy" is advice nobody can act on.
 */
function watchOf(week: GeneratedWeek, maxHr: number | null, phase: string): string {
  const hard = (week.sessions as Session[]).filter((s) => s.hard);
  const days = hard.map((s) => DAY[s.day]).filter(Boolean);
  const named = days.length >= 2
    ? `${days[0]} and ${days[days.length - 1]}`
    : days[0] ?? "the hard day";

  if (phase === "taper") {
    return `Doing more than the plan says. The temptation this fortnight is to prove the fitness is there; ${named} is where you prove it.`;
  }
  const ceiling = maxHr ? Math.round(maxHr * 0.76) : null;
  return ceiling
    ? `Easy runs drifting above ${ceiling} bpm. That is the failure mode of this phase, and it costs ${named}.`
    : `Easy runs drifting up in pace. That is the failure mode of this phase, and it costs ${named}.`;
}

/** The sessions worth protecting, from the first full week of the phase. */
function protectOf(week: GeneratedWeek): string[] {
  const KEY = ["quality_run", "long_run", "strength"];
  return (week.sessions as Session[])
    .filter((s) => !s.commitment && (KEY.includes(String(s.kind)) || s.hard))
    .filter((s) => String(s.kind) !== "easy_run")
    .sort((a, b) => a.day - b.day)
    .slice(0, 4)
    .map((s) => `${DAY[s.day]} · ${s.label && s.label !== String(s.kind) ? s.label : PRETTY[String(s.kind)] ?? String(s.kind)}`);
}

const PRETTY: Record<string, string> = {
  long_run: "Long run", strength: "Strength", hyrox: "Hyrox session",
  quality_run: "Intervals", benchmark: "Benchmark test", race: "Race",
};

/**
 * One intent per phase, over the weeks it covers.
 *
 * Consecutive weeks of the same phase are one range — the same grouping the plan
 * screen shows — and the sessions quoted come from the phase's first week, which is
 * the one an athlete reading it is about to do.
 */
export function intentRanges(g: Generated, maxHr: number | null = null): IntentRange[] {
  const out: IntentRange[] = [];
  for (const w of g.weeks) {
    const phase = String(w.phase);
    const last = out[out.length - 1];
    if (last && last.phase === (PHASE_LABEL[phase] ?? phase)) {
      last.to = w.n;
      continue;
    }
    out.push({
      from: w.n, to: w.n,
      phase: PHASE_LABEL[phase] ?? phase,
      purpose: PURPOSE[phase] ?? "",
      protect: protectOf(w),
      sacrifice: sacrificeOf(w),
      watch: watchOf(w, maxHr, phase),
    });
  }
  return out;
}
