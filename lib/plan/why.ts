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
 * The message.
 *
 * Two sentences. It was three, and three is a paragraph — a block of text that
 * arrives above the session an athlete is about to do, at the moment they are
 * least inclined to read a block of text. It is a note from their coach, and a
 * coach says the thing that changes what you do today and stops.
 *
 * What went: the sentence explaining the phase, which is on the week screen and
 * does not need repeating per session, and the roll-call of the week's other hard
 * days, which the week screen also shows.
 */
export function whyFor(c: WhyContext): string | null {
  const others = c.hardDays.filter((d) => d !== c.day);
  const phase = PHASE_WHY[String(c.phase)] ?? "";
  const toGo = c.weeks - c.week;

  switch (c.kind) {
    case "quality_run":
      return [
        "Hold the prescribed pace from the first rep — if rep one is the fastest of the set, the session failed even if the average looks right.",
        "Every rep is read against the target, so this is the session that decides what you get prescribed next.",
      ].join(" ");

    case "long_run":
      return toGo <= 3
        ? "Durability decides the back half of a Hyrox, and this is the session that trains it. It comes down from here — arriving fresh is worth more than one more long Sunday."
        : "Durability decides the back half of a Hyrox, and this is the session that trains it. Start slower than feels right; the last 5 km is the part that counts.";

    case "easy_run":
      return [
        `Easy days are what make ${list(others.length ? others : c.hardDays)} possible — that is their whole job.`,
        c.easyCeilingHr
          ? `Keep it under ${c.easyCeilingHr} bpm; drifting above it is the most common way a good plan quietly stops working.`
          : "It should feel too slow. Drifting up in pace is how a good plan quietly stops working.",
      ].join(" ");

    case "hyrox":
      return [
        "Running off a station is a different skill from running, and this is where it is trained — hold the pace on your card rather than going all-out.",
        "Time your transitions even if nobody asks you to. A minute and a half hides in the roxzone.",
      ].join(" ");

    case "easy_hyrox":
      return [
        "Aerobic work on the machines that are a quarter of your station time, without another eight kilometres on your legs.",
        "Genuinely easy: if you cannot hold a conversation, it has become a session it was not meant to be.",
      ].join(" ");

    case "strength":
      return [
        "The sled, the lunges and the carries are where a race is lost by people who can run.",
        String(c.phase) === "build"
          ? "Heaviest sets of the week — leave the last one in the tank and come back able to run."
          : "Load matters less than the positions. Move well and get out.",
      ].join(" ");

    case "benchmark":
      return [
        "A measurement, not a workout: every pace target after this is written from what it says, so pace it honestly.",
        "Press the lap button at every boundary and the rest is worked out for you.",
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
