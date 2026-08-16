import type { PhaseName } from "./skeleton";

/**
 * Why this session, in this week, in this plan.
 *
 * The card that asks the question was answering it with whatever flag the pace
 * prescription happened to carry — "paces come from your own race splits" — which
 * is a fact about the arithmetic, not a reason to go and run. An athlete standing
 * in their kitchen at six in the morning wants to know what this session is for,
 * why it is today, and what a good one looks like.
 *
 * Written per kind and per phase, and only for sessions the plan wrote. A
 * kickboxing class the athlete already attends is theirs; the plan schedules around
 * it and has nothing to teach them about it.
 */

export type WhyContext = {
  kind: string;
  phase: PhaseName | string;
  /** 1-based week of the block */
  week: number;
  weeks: number;
  /** the days this week that carry a hard session, as short names */
  hardDays: string[];
  /** the day this session is on */
  day: string;
  /** where the paces came from, in three words */
  paceSource?: string | null;
  /** seconds per km the easy work is capped at, where a ceiling is known */
  easyCeilingHr?: number | null;
};

const list = (days: string[]) =>
  days.length === 0 ? "the hard days"
    : days.length === 1 ? days[0]
    : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;

const PHASE_WHY: Record<string, string> = {
  base: "These weeks are about the size of the engine, not its top end.",
  build: "This is the phase the fitness is actually made in.",
  specific: "Everything now is shaped like the race.",
  taper: "The training is done. This phase only has to keep you sharp.",
};

/**
 * The paragraph.
 *
 * Three sentences at most: what it builds, why it is today, and what a good one
 * looks like. Longer than that and nobody reads it before a session.
 */
export function whyFor(c: WhyContext): string | null {
  const others = c.hardDays.filter((d) => d !== c.day);
  const phase = PHASE_WHY[String(c.phase)] ?? "";
  const toGo = c.weeks - c.week;

  switch (c.kind) {
    case "quality_run":
      return [
        `${phase} This is the session the plan reads to decide what to prescribe next, so the pace on the card matters more than the effort you feel like giving.`,
        `Hold the prescribed pace from the first rep — if rep one is the fastest of the set, the session failed even if the average looks right.`,
        others.length
          ? `${list(others)} ${others.length === 1 ? "is" : "are"} the other hard ${others.length === 1 ? "day" : "days"}; everything between them is meant to be easy enough to make this possible.`
          : "It is the only hard day this week, which is why it is worth doing properly.",
      ].join(" ");

    case "long_run":
      return [
        `Durability is what decides the back half of a Hyrox, and this is the only session that trains it.`,
        `The distance is the point in the base weeks; later the blocks inside it are, because switching pace on tired legs is exactly what the race asks for.`,
        toGo <= 3
          ? "It comes down from here — the work is banked, and arriving fresh is worth more than one more long Sunday."
          : "It grows across the block and then stops at 22 km: past that it costs more in recovery than it returns.",
      ].join(" ");

    case "easy_run":
      return [
        `Easy days are what make ${list(others.length ? others : c.hardDays)} possible. That is their whole job.`,
        c.easyCeilingHr
          ? `Keep it under ${c.easyCeilingHr} bpm. Drifting above it is the most common way a good plan quietly stops working — the hard days arrive tired and neither kind of session does what it was written to do.`
          : `It should feel too slow. Drifting up in pace is the most common way a good plan quietly stops working.`,
        `The aerobic return is better at this pace, and it is the volume here — not the intervals — that raises what you can hold on race day.`,
      ].join(" ");

    case "hyrox":
      return [
        `Running off a station is not the same skill as running, and this is where it is trained. ${phase}`,
        `Keep the run efforts at the pace on your card rather than all-out: the point is what you can hold after the station, not what you can produce once.`,
        `Time your transitions even if nobody is asking you to. Roxzone is where a minute and a half hides in a race.`,
      ].join(" ");

    case "easy_hyrox":
      return [
        `Aerobic work on the two machines that make up a quarter of your station time, with none of the impact of another eight kilometres of running.`,
        `It is meant to be genuinely easy — if you cannot hold a conversation, it has turned into a session it was not supposed to be.`,
        `A class will not do this for you. A class is never easy.`,
      ].join(" ");

    case "strength":
      return [
        `The sled, the lunges and the carries are where a race is lost by people who can run. This is what stops that happening to you.`,
        String(c.phase) === "build"
          ? "Heaviest set of the week. Leave the last one in the tank and come back on Thursday able to run."
          : "Load matters less than the positions. Move well and get out.",
        `It is scheduled away from your hard running days on purpose — do not move it next to one.`,
      ].join(" ");

    case "benchmark":
      return [
        `This is a measurement, not a workout. Every pace target in the plan afterwards is written from what it says.`,
        `Run it honestly: hard enough to be true, complete enough to be comparable. A test you paced conservatively produces a plan that is conservative for the next fifteen weeks.`,
        `Press the lap button at every boundary and the rest is worked out for you.`,
      ].join(" ");

    case "race":
      return [
        `Race day. Nothing you do now makes you fitter — the fitness was made in the weeks behind this one.`,
        `Run the first kilometre at the pace on your card, not at the pace of the person beside you.`,
      ].join(" ");

    default:
      return null;
  }
}
