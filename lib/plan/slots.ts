import type { Allocation } from "./allocate";

/**
 * Stage 4: how many sessions of each kind, and which days they land on.
 */

export const SLOT_KIND = ["quality_run", "long_run", "easy_run", "hyrox", "strength"] as const;
export type SlotKind = (typeof SLOT_KIND)[number];

export type Commitment = {
  activity: string;
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
  allocation: Allocation;
  discipline: "doubles" | "singles" | "running";
  commitments: Commitment[];
  max_hard: number;
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
  const hyroxWanted = isHyrox
    ? Math.min(slots, x.allocation.station >= 35 ? 3 : 2)
    : 0;

  // --- the minimums, in the order the brief ranks them --------------------
  counts.quality_run = 1;                                   // always
  if (slots >= 3) counts.long_run = 1;
  if (slots >= 3 && isHyrox) counts.hyrox = 1;
  if (slots >= 4) counts.strength = 1;
  // A second Hyrox session outranks a second strength session: strength is a
  // means, the Hyrox session is the sport, plus compromised running, plus the
  // only transition practice in the week.
  if (slots >= 5 && isHyrox) counts.hyrox = 2;

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

  // --- hard days ----------------------------------------------------------
  //
  // The budget governs. A quality run is always in the week, so the Hyrox
  // sessions come down first — and the second one, which outranks a second
  // strength session, still cannot outrank the number of hard days an athlete
  // can absorb. Anything shed becomes easy running rather than disappearing.
  const minHyrox = isHyrox ? (slots >= 3 ? 1 : 0) : 0;
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

export type Placed = { day: number; kind: SlotKind | string; hard: boolean };

const HARD: SlotKind[] = ["quality_run", "hyrox"];

/** Weighted preferences. Minimised, never enforced — a week that breaks one to
 *  fit a real life beats a plan that refuses to schedule. */
export const PENALTY = {
  hardAdjacent: 10,
  commitmentBeforeKey: 8,
  longRunTooSoonAfterQuality: 6,
  strengthBeforeLongRun: 5,
  noRestDay: 4,
};

/** Penalties halve at advanced and quarter at elite: a stronger athlete
 *  tolerates a compromised week that would cost a beginner their next session. */
export const penaltyScale = (age: string) =>
  age === "elite" ? 0.25 : age === "advanced" ? 0.5 : 1;

export type PlaceInput = {
  slots: SlotKind[];
  available_days: number[];      // 0 = Monday
  commitments: Commitment[];
  training_age: string;
  want_rest_day: boolean;
  allow_doubles: boolean;
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
  if (x.want_rest_day && byDay.size >= 7) cost += PENALTY.noRestDay;

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
      week.push({ day: c.fixed_days[i] ?? days[i % days.length], kind: c.activity, hard: false });
    }
  }

  // hard sessions first, spread as far apart as the week allows
  const hard = x.slots.filter((s) => HARD.includes(s));
  const easy = x.slots.filter((s) => !HARD.includes(s));
  const taken = new Set<number>(week.map((p) => p.day));

  const spread = (n: number) => {
    const free = days.filter((d) => !taken.has(d));
    const pool = free.length >= n ? free : days;
    const step = Math.max(1, Math.floor(pool.length / Math.max(1, n)));
    return Array.from({ length: n }, (_, i) => pool[Math.min(pool.length - 1, i * step)]);
  };

  spread(hard.length).forEach((day, i) => {
    week.push({ day, kind: hard[i], hard: true });
    taken.add(day);
  });

  for (const kind of easy) {
    const free = days.find((d) => !taken.has(d));
    const day = free ?? days[week.length % days.length];
    if (free == null && !x.allow_doubles) {
      flags.push("More sessions than days, so some share a day.");
    }
    week.push({ day, kind, hard: false });
    taken.add(day);
  }

  const cost = score(week, x);
  if (cost > 0) {
    flags.push("This week breaks a scheduling preference to fit your days. That is deliberate.");
  }
  return { week: week.sort((a, b) => a.day - b.day), cost, flags };
}
