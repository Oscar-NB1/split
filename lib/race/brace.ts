/**
 * Secondary races: what intent a gap allows, and which of a result's fields can
 * be trusted afterwards.
 *
 * Pure. The two questions here are the ones that must not be answered
 * differently in two places — the client renders the same rules the server
 * enforces, and the capability hierarchy admits only what this says is usable.
 */

export const INTENTS = ["training", "sharpen", "compete"] as const;
export type Intent = (typeof INTENTS)[number];

/**
 * What each intent costs, as the intake states it.
 *
 * Kept beside the gating rather than in the copy, because an intent that quietly
 * costs more than advertised is worse than one that costs more openly.
 */
export const INTENT_COST: Record<Intent, {
  before: string; after: string; week_volume: number; cost: string;
}> = {
  training: { before: "nothing", after: "nothing", week_volume: -0.10, cost: "about nothing" },
  sharpen: {
    before: "48 h easy, and the key session before it goes",
    after: "24–48 h easy", week_volume: -0.20, cost: "about half a week",
  },
  compete: {
    before: "a 4–5 day taper", after: "3–5 days recovery",
    week_volume: -0.40, cost: "about two weeks",
  },
};

/** Whole weeks between a secondary race and the target. */
export const gapWeeks = (secondary: string, target: string): number =>
  (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${secondary}T00:00:00Z`)) / 604_800_000;

export type Options = {
  allowed: Intent[];
  blocked: { intent: Intent; reason: string }[];
  gap_weeks: number;
  warning?: string;
};

/**
 * Which intents a gap can afford.
 *
 * The rule underneath every row: the closer a secondary race sits to the target,
 * the less training time there is to spend on it. Competing costs roughly two
 * weeks — one tapering, one recovering — which at a four-week gap is half the
 * remaining specific phase.
 */
export function intentOptions(secondary: string, target: string): Options {
  const gap = Math.round(gapWeeks(secondary, target) * 10) / 10;

  const why = (i: Intent) =>
    i === "compete"
      ? `Competing costs about two weeks — one tapering into it, one recovering out. With ${gap} weeks to your target that is the specific phase spent on a different race.`
      : `Sharpening costs about half a week and the key session before it. With ${gap} weeks left that session is one you cannot give back.`;

  const build = (allowed: Intent[], warning?: string): Options => ({
    allowed,
    blocked: INTENTS.filter((i) => !allowed.includes(i)).map((i) => ({ intent: i, reason: why(i) })),
    gap_weeks: gap,
    ...(warning ? { warning } : {}),
  });

  if (gap < 2) {
    return build(["training"],
      `Only ${gap} weeks out. Anything but a training effort here comes directly out of your target race.`);
  }
  if (gap < 4) return build(["training"]);
  if (gap <= 6) return build(["training", "sharpen"]);
  return build(["training", "sharpen", "compete"]);
}

/**
 * Whether an intent is allowed, with the alternatives if not.
 *
 * Never silently downgraded: an athlete who asked to compete and was quietly
 * given a training week would find out on race day.
 */
export function checkIntent(
  intent: Intent, secondary: string, target: string,
): { ok: true } | { ok: false; reason: string; allowed: Intent[] } {
  const o = intentOptions(secondary, target);
  if (o.allowed.includes(intent)) return { ok: true };
  return {
    ok: false,
    reason: o.blocked.find((b) => b.intent === intent)!.reason,
    allowed: o.allowed,
  };
}

// ------------------------------------------------------- what the result proves

export type Usability = "usable" | "distorted";

export type ResultContext = {
  doubles: boolean;
  /** true when the partner set the running pace */
  partner_slower?: boolean;
  /** this athlete's share of the station work, 0–1 */
  my_share?: number;
  intent: Intent;
};

export type FieldUsability = {
  run_paces: Usability;
  station_times: Usability;
  reason?: string;
};

/** A share this far from even is not comparable with a solo target race. */
export const SHARE_BAND = [0.40, 0.60] as const;

/**
 * Which fields of a B-race result may enter the capability hierarchy.
 *
 * A secondary race is potentially the best data in the block — a real event, and
 * the only in-plan source of a roxzone now that benchmark retests are gone. But
 * its fields are not equally trustworthy, and a distorted run pace entering at
 * rank 1 would poison every prescription downstream. This is the guard.
 */
export function fieldUsability(c: ResultContext): FieldUsability {
  const reasons: string[] = [];
  let run: Usability = "usable";
  let stations: Usability = "usable";

  if (c.doubles && c.partner_slower) {
    run = "distorted";
    reasons.push("the pair ran at your partner's pace");
  }
  if (c.intent === "training") {
    run = "distorted";
    reasons.push("it was run as training rather than raced");
  }
  if (c.doubles && c.my_share !== undefined
      && (c.my_share < SHARE_BAND[0] || c.my_share > SHARE_BAND[1])) {
    stations = "distorted";
    reasons.push(`you took ${Math.round(c.my_share * 100)}% of the station work, which is not comparable with a solo race`);
  }

  return {
    run_paces: run,
    station_times: stations,
    ...(reasons.length ? { reason: reasons.join("; ") } : {}),
  };
}

/** Only what is usable writes a capability row, and it enters at rank 1. */
export const usableFields = (f: FieldUsability): string[] =>
  (["run_paces", "station_times"] as const).filter((k) => f[k] === "usable");

// ------------------------------------------------------------------ hard limits

/** Two races closer than this are not two races. */
export const MIN_RACE_GAP_DAYS = 5;

export const tooClose = (a: string, b: string): boolean =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`))
    / 86_400_000 < MIN_RACE_GAP_DAYS;

/**
 * Intent stops being editable a week out.
 *
 * Reshaping the weeks around a race you are about to run is not a decision
 * anyone makes well, and the taper it would rewrite has already happened.
 */
export const INTENT_LOCK_DAYS = 7;

export const intentLocked = (raceDate: string, today: string): boolean =>
  (Date.parse(`${raceDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
    <= INTENT_LOCK_DAYS;
