import type { Allocation } from "./allocate";

/**
 * Stage 4: how many sessions of each kind, and which days they land on.
 */

export const SLOT_KIND = ["quality_run", "long_run", "easy_run", "hyrox", "strength"] as const;
export type SlotKind = (typeof SLOT_KIND)[number];

export type Commitment = {
  activity: string;
  /** what the athlete called it, for the title on the day */
  label?: string;
  per_week: number;
  fixed_days: number[];          // 0 = Monday
  intensity: "low" | "medium" | "high";
  /** `replace` consumes a slot; `add` only consumes load budget. */
  mode: "replace" | "add";
  locked: boolean;
};

/**
 * The Hyrox session credits half its time to running.
 *
 * A 60–70 minute continuous session contains 5–6 km of compromised running.
 * Booking it wholly against stations is why a running-heavy athlete wrongly
 * ends up with only one of them.
 */
export const HYROX_RUN_CREDIT = 0.5;

export type SlotInput = {
  target_sessions: number;
  /** which phase this week belongs to; the second Hyrox session is phase-gated */
  phase?: string;
  allocation: Allocation;
  discipline: "doubles" | "singles" | "running";
  commitments: Commitment[];
  max_hard: number;
  /**
   * How many quality runs the athlete asked for, from the difficulty dial.
   *
   * The dial did nothing at all in this generator: difficulty was read only by
   * the older one, so an athlete who chose Hard and an athlete who chose Steady
   * were given the same week. A second quality run is a difficulty setting, which
   * is why the spare-slot scores below refuse to hand one out on their own.
   */
  quality_target?: number;
};

export type SlotPlan = { counts: Record<SlotKind, number>; slots: SlotKind[]; flags: string[] };

/**
 * Largest remainder, then the minimums, then the trades.
 *
 * The minimums are what stop a mathematically tidy split producing a week with
 * no long run in it.
 */
export function allocateSlots(x: SlotInput): SlotPlan {
  const flags: string[] = [];
  const replaced = x.commitments.filter((c) => c.mode === "replace")
    .reduce((n, c) => n + c.per_week, 0);
  const slots = Math.max(1, x.target_sessions - replaced);
  if (replaced > 0) {
    flags.push(`${replaced} of your ${x.target_sessions} sessions are commitments you already keep.`);
  }

  const isHyrox = x.discipline !== "running";
  const counts: Record<SlotKind, number> = {
    quality_run: 0, long_run: 0, easy_run: 0, hyrox: 0, strength: 0,
  };

  // A Hyrox session pays half into running, so the running share buys fewer
  // dedicated runs than its percentage suggests.
  const want = {
    running: (x.allocation.running / 100) * slots,
    station: (x.allocation.station / 100) * slots,
    strength: (x.allocation.strength / 100) * slots,
  };
  /**
   * How many Hyrox sessions the station share buys.
   *
   * NOT station demand divided by the credit. That reasoning — each session
   * delivers half a session of station work, so 1.8 needs 3.6 of them —
   * produced three Hyrox sessions a week off a 30% station share, which is
   * three-quarters of the week spent on the thing that is 30% of it. The credit
   * describes what a session gives *back* to running; it does not multiply how
   * many are needed.
   *
   * The brief only ever specifies minimums: one, and two once there are five
   * slots. A third belongs to an athlete whose station share is genuinely
   * dominant, and nobody else.
   */
  /*
   * And the ceiling moves with the phase for the same reason the minimum does.
   *
   * Leaving it at two meant the spare-slot loop below handed the second one back
   * the moment the minimum stopped asking for it — the cap has to agree with the
   * rule, or the rule is decoration.
   */
  const specific = x.phase === "specific";
  const hyroxWanted = isHyrox
    ? Math.min(slots, specific ? (x.allocation.station >= 35 ? 3 : 2) : 1)
    : 0;

  // --- the minimums, in the order the brief ranks them --------------------
  counts.quality_run = 1;                                   // always
  if (slots >= 3) counts.long_run = 1;
  if (slots >= 3 && isHyrox) counts.hyrox = 1;
  if (slots >= 4) counts.strength = 1;
  /*
   * Easy running is a minimum, not a leftover.
   *
   * It was neither: the minimums did not include it, and the spare-slot scores
   * below only ever ran once or twice. A six-session week came out as two quality
   * runs, two Hyrox sessions, strength and the long run — five hard days and no
   * aerobic running at all, in a sport decided by the aerobic engine. Whatever else
   * the week holds, one easy run is in it from five slots and two from seven.
   */
  if (slots >= 5) counts.easy_run = 1;
  if (slots >= 7) counts.easy_run = 2;

  /*
   * A second Hyrox session belongs to the specific phase.
   *
   * Two of them every week from week one is the whole block spent rehearsing the
   * race, and it is what put a half simulation and a full simulation on consecutive
   * days in August. One a week builds the skill; the second arrives when the work
   * turns race-shaped.
   */
  if (slots >= 6 && isHyrox && x.phase === "specific") counts.hyrox = 2;

  let used = Object.values(counts).reduce((a, b) => a + b, 0);
  if (used > slots) {
    // too few slots for every minimum: drop from the least specific upward
    for (const k of ["strength", "easy_run", "long_run"] as SlotKind[]) {
      while (used > slots && counts[k] > 0) { counts[k]--; used--; }
    }
    flags.push(`${slots} sessions is too few for a full week; the least specific were dropped first.`);
  }

  // --- what is left goes by the allocation --------------------------------
  const remaining = slots - used;
  if (remaining > 0) {
    /**
     * Spare slots go to unmet demand, and a second quality run is not demand.
     *
     * Giving it a standing score put two interval sessions in every week beside
     * two Hyrox sessions — four hard days, which an advanced athlete is allowed
     * and nobody asked for. Easy running is what a week with room should carry;
     * a second hard run is a difficulty setting, not a leftover.
     */
    const scores: [SlotKind, number][] = [
      ["hyrox", isHyrox ? Math.max(0, hyroxWanted - counts.hyrox) : -1],
      ["easy_run", Math.max(0.01, want.running - counts.quality_run - counts.long_run
        - counts.hyrox * HYROX_RUN_CREDIT)],
      ["strength", Math.max(0, want.strength - counts.strength)],
    ];
    for (let i = 0; i < remaining; i++) {
      scores.sort((a, b) => b[1] - a[1]);
      const [kind] = scores[0];
      counts[kind]++;
      scores[0][1] -= 1;
    }
  }

  /*
   * The quality run the difficulty asked for, if the week can hold it.
   *
   * Taken from easy running rather than added on top: the session count is the
   * athlete's answer, and difficulty changes what is inside the week, not its
   * size.
   */
  const wantQuality = Math.max(1, x.quality_target ?? 1);
  while (counts.quality_run < wantQuality) {
    // Easy running first, then the second Hyrox session, then a second strength
    // day. Never the long run, and never the last of anything.
    const from: SlotKind | null = counts.easy_run > 0 ? "easy_run"
      : counts.hyrox > 1 ? "hyrox"
      : counts.strength > 1 ? "strength"
      : null;
    if (!from) break;
    counts[from]--; counts.quality_run++;
  }

  // --- hard days ----------------------------------------------------------
  //
  // The budget governs. A quality run is always in the week, so the Hyrox
  // sessions come down first — and the second one, which outranks a second
  // strength session, still cannot outrank the number of hard days an athlete
  // can absorb. Anything shed becomes easy running rather than disappearing.
  /*
   * Three hard days, whatever the training age permits.
   *
   * A specific-phase week was coming out as two quality runs and two Hyrox
   * sessions: four hard days, which forces two of them onto consecutive days in any
   * week that also holds a long run and a commitment. The race-specific session is
   * quality work — it does not need a second interval session beside it.
   */
  const hardCeiling = Math.min(x.max_hard, 3);
  const minHyrox = isHyrox ? (slots >= 3 ? 1 : 0) : 0;
  while (counts.quality_run + counts.hyrox > hardCeiling && counts.quality_run > 1) {
    counts.quality_run--; counts.easy_run++;
  }
  while (counts.quality_run + counts.hyrox > x.max_hard && counts.hyrox > minHyrox) {
    counts.hyrox--; counts.easy_run++;
  }
  while (counts.quality_run + counts.hyrox > x.max_hard && counts.quality_run > 1) {
    counts.quality_run--; counts.easy_run++;
  }
  if (counts.quality_run + counts.hyrox > x.max_hard) {
    flags.push(
      "Your week needs one more hard day than your history supports. The quality run and the Hyrox session are both the point of the block, so neither was dropped.",
    );
  } else if (isHyrox && slots >= 5 && counts.hyrox < 2) {
    flags.push("Two Hyrox sessions would not fit inside your hard-day budget, so there is one.");
  }

  const out: SlotKind[] = [];
  (Object.keys(counts) as SlotKind[]).forEach((k) => {
    for (let i = 0; i < counts[k]; i++) out.push(k);
  });
  return { counts, slots: out, flags };
}

// ------------------------------------------------------------------ placement

export type Placed = {
  day: number; kind: SlotKind | string; hard: boolean;
  /** the athlete's own name for a commitment */
  label?: string;
};

const HARD: SlotKind[] = ["quality_run", "hyrox"];

/**
 * The sessions that may never share a day with each other.
 *
 * A double day is one real session plus, at most, an easy run. Two key sessions on
 * the same day is not a double — it is one of them done badly, and the plan reads
 * both afterwards as though they were done properly. Strength is in this list
 * precisely because it is the one that kept landing next to an interval session:
 * it is not "hard" by the placer's definition, and it is unambiguously key.
 */
const KEY: string[] = ["quality_run", "hyrox", "long_run", "strength", "benchmark", "race"];
const isKey = (kind: string) => KEY.includes(kind);

/** Weighted preferences. Minimised, never enforced — a week that breaks one to
 *  fit a real life beats a plan that refuses to schedule. */
export const PENALTY = {
  hardAdjacent: 10,
  commitmentBeforeKey: 8,
  longRunTooSoonAfterQuality: 6,
  strengthBeforeLongRun: 5,
  noRestDay: 4,
  /*
   * Below the physiological penalties on purpose.
   *
   * A long run on the wrong day is an inconvenience; a long run the day after a key
   * session is a session done badly. When the two conflict the athlete's Sunday
   * loses, and the week says it broke a preference.
   */
  longRunOffPreferredDay: 3,
  /** The heaviest of them: this one makes a session worthless, not just awkward. */
  twoKeyOneDay: 14,
};

/** Penalties halve at advanced and quarter at elite: a stronger athlete
 *  tolerates a compromised week that would cost a beginner their next session. */
export const penaltyScale = (age: string) =>
  age === "elite" ? 0.25 : age === "advanced" ? 0.5 : 1;

/**
 * Every way of spacing the hard sessions that is worth considering.
 *
 * The even spread, then the same spread rotated through the pool: enough to find an
 * alternating week where one exists, cheap enough to score them all.
 */
function hardArrangements(
  hard: SlotKind[], days: number[], taken: Set<number>,
): Placed[][] {
  if (hard.length === 0) return [[]];
  const free = days.filter((d) => !taken.has(d));
  const pool = free.length >= hard.length ? free : days;
  const n = hard.length;
  const out: Placed[][] = [];

  for (let offset = 0; offset < pool.length; offset++) {
    const picked: number[] = [];
    for (let i = 0; i < n; i++) {
      const at = n === 1 ? offset
        : (offset + Math.round((i * (pool.length - 1)) / (n - 1))) % pool.length;
      const day = pool[at];
      if (!picked.includes(day)) picked.push(day);
    }
    // A rotation that collides with itself is not an arrangement of n sessions.
    if (picked.length !== n) continue;
    out.push(picked.sort((a, b) => a - b)
      .map((day, i) => ({ day, kind: hard[i], hard: true })));
  }
  return out.length ? out : [[]];
}

export type PlaceInput = {
  slots: SlotKind[];
  available_days: number[];      // 0 = Monday
  commitments: Commitment[];
  training_age: string;
  /**
   * What the athlete asked for on the seventh day.
   *
   * Not a boolean, because the answer is not one: "no rest day" and "no rest day
   * but keep one of them easy" are different weeks, and the second is what most
   * people mean. `none` is the athlete who did not have to be asked.
   */
  rest_day: "full" | "easy" | "none";
  allow_doubles: boolean;
  /** the day the athlete wants their long run on, 0 = Monday */
  long_run_day: number | null;
};

/** Score a candidate week. Lower is better. */
export function score(week: Placed[], x: PlaceInput): number {
  const scale = penaltyScale(x.training_age);
  const byDay = new Map<number, Placed[]>();
  for (const p of week) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
  let cost = 0;

  const hardDays = [...byDay.entries()].filter(([, v]) => v.some((p) => p.hard)).map(([d]) => d);
  for (const d of hardDays) if (hardDays.includes(d + 1)) cost += PENALTY.hardAdjacent;

  const commitDays = new Set(x.commitments.filter((c) => c.intensity === "high")
    .flatMap((c) => c.fixed_days));
  for (const d of hardDays) if (commitDays.has(d - 1)) cost += PENALTY.commitmentBeforeKey;

  const quality = week.find((p) => p.kind === "quality_run")?.day;
  const long = week.find((p) => p.kind === "long_run")?.day;
  if (quality != null && long != null && long - quality < 2) {
    cost += PENALTY.longRunTooSoonAfterQuality;
  }
  if (long != null && (byDay.get(long - 1) ?? []).some((p) => p.kind === "strength")) {
    cost += PENALTY.strengthBeforeLongRun;
  }
  /*
   * Two key sessions on one day. placeWeek refuses to do this; the penalty exists
   * so that any other route into a week — an edit, a race, a future stage — is
   * charged for it rather than passing silently.
   */
  for (const v of byDay.values()) {
    const keys = v.filter((p) => isKey(String(p.kind))).length;
    if (keys > 1) cost += PENALTY.twoKeyOneDay * (keys - 1);
  }
  if (x.rest_day === "full" && byDay.size >= 7) cost += PENALTY.noRestDay;
  /*
   * "Train every day, but keep one of them easy."
   *
   * Satisfied by any day carrying nothing but an easy run — not by a light day
   * that still holds a strength session, which is what an athlete asking for this
   * is trying to avoid.
   */
  if (x.rest_day === "easy" && byDay.size >= 7) {
    const hasEasyDay = [...byDay.values()]
      .some((v) => v.length === 1 && v[0].kind === "easy_run" && !v[0].hard);
    if (!hasEasyDay) cost += PENALTY.noRestDay;
  }
  /*
   * The long run on the day that was asked for.
   *
   * A preference rather than a hard rule: a fixed commitment on that day, or a
   * key session that has to sit two days clear of it, can still win — and when
   * they do, placeWeek says so rather than moving it silently.
   */
  if (x.long_run_day != null && long != null && long !== x.long_run_day) {
    cost += PENALTY.longRunOffPreferredDay;
  }

  return cost * scale;
}

/**
 * Place the week.
 *
 * Hard rules are never broken: a fixed day is fixed, one hard session a day,
 * and a Hyrox session is never paired with the hard run. Everything else is a
 * penalty to minimise, and the violations that survive are returned so they
 * read as deliberate rather than as a bug.
 */
export function placeWeek(x: PlaceInput): { week: Placed[]; cost: number; flags: string[] } {
  const days = [...new Set(x.available_days)].sort((a, b) => a - b);
  const flags: string[] = [];
  const week: Placed[] = [];

  for (const c of x.commitments) {
    for (let i = 0; i < c.per_week; i++) {
      week.push({
        day: c.fixed_days[i] ?? days[i % days.length], kind: c.activity,
        label: c.label, hard: false,
      });
    }
  }

  /*
   * The long run goes on the day it was asked for, before anything else is spread.
   *
   * Placed first because everything else is arranged around it — which is what the
   * question means. If that day is already taken by a fixed commitment the slot
   * falls back into the spread and score() charges for it.
   */
  const wanted = x.long_run_day;
  const placeLong = wanted != null && days.includes(wanted)
    && !week.some((p) => p.day === wanted) && x.slots.includes("long_run");
  // Taken out of the pool, not filtered out of one half of it: the long run is not
  // in HARD, so filtering the hard list left a second copy to be placed again.
  const rest = [...x.slots];
  if (placeLong) {
    week.push({ day: wanted!, kind: "long_run", hard: HARD.includes("long_run") });
    rest.splice(rest.indexOf("long_run"), 1);
  }

  // hard sessions first, spread as far apart as the week allows
  const hard = rest.filter((s) => HARD.includes(s));
  const easy = rest.filter((s) => !HARD.includes(s));
  const taken = new Set<number>(week.map((p) => p.day));

  /*
   * Hard sessions as far apart as the week allows.
   *
   * `floor(pool / n)` gave a step of 1 for four hard sessions in six free days, so
   * they were placed on the first four consecutive days — the exact thing
   * PENALTY.hardAdjacent exists to prevent, done by the placer itself before the
   * score ever saw it. Spanning the pool end to end is what "spread" means.
   */
  const spread = (n: number) => {
    const free = days.filter((d) => !taken.has(d));
    const pool = free.length >= n ? free : days;
    if (n <= 0) return [];
    if (n === 1) return [pool[0]];
    return Array.from({ length: n }, (_, i) =>
      pool[Math.round((i * (pool.length - 1)) / (n - 1))]);
  };

  /*
   * The best arrangement of the hard days, not the first.
   *
   * One spread and whatever it produced was accepted: four hard sessions across five
   * free days came out as two adjacent pairs, which is what score() charges for and
   * nothing was checking. Rotating the pool gives a handful of candidates and the
   * cheapest one wins — still deterministic, and it costs a few array shuffles.
   */
  const candidates = hardArrangements(hard, days, taken);
  let best = candidates[0] ?? [];
  let bestCost = Infinity;
  for (const arrangement of candidates) {
    const cost = score([...week, ...arrangement], x);
    if (cost < bestCost) { best = arrangement; bestCost = cost; }
  }
  for (const p of best) { week.push(p); taken.add(p.day); }

  /*
   * Everything else, with one rule that is never bent: one key session a day.
   *
   * Strength was being dropped onto the first day with room, which was routinely
   * the day already holding the interval session — a key session done on tired
   * legs, and two of them read afterwards as though both had been done properly.
   * Only an easy run may share a day with a key session.
   */
  const keyDays = new Set(week.filter((p) => isKey(String(p.kind))).map((p) => p.day));
  const count = (d: number) => week.filter((p) => p.day === d).length;

  for (const kind of easy) {
    const key = isKey(kind);
    const free = days.filter((d) => !taken.has(d));
    let day: number;

    if (free.length > 0) {
      day = free[0];
    } else if (key) {
      // No empty day left: the best remaining is the quietest day with no key
      // session on it. Doubling two key sessions is refused even here.
      const spare = days.filter((d) => !keyDays.has(d)).sort((a, b) => count(a) - count(b));
      if (spare.length > 0) {
        day = spare[0];
        flags.push("More sessions than days, so one shares a day with an easy run.");
      } else {
        day = days.sort((a, b) => count(a) - count(b))[0];
        flags.push(
          "Every day already holds a key session, so two of them share one. Drop one if the week is heavy.");
      }
    } else {
      // An easy run doubles up on the quietest day, and never onto the long run.
      const longDay = week.find((p) => p.kind === "long_run")?.day;
      const pool = days.filter((d) => d !== longDay);
      day = (pool.length ? pool : days).sort((a, b) => count(a) - count(b))[0];
      if (!x.allow_doubles) {
        flags.push("More sessions than days, so some share a day.");
      }
    }

    week.push({ day, kind, hard: false });
    taken.add(day);
    if (key) keyDays.add(day);
  }

  const cost = score(week, x);
  if (cost > 0) {
    flags.push("This week breaks a scheduling preference to fit your days. That is deliberate.");
  }
  return { week: week.sort((a, b) => a.day - b.day), cost, flags };
}
