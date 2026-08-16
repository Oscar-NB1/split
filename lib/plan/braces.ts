import type { Intent } from "../race/brace";
import { INTENT_COST } from "../race/brace";

/**
 * Stage 7: what a secondary race does to the weeks around it.
 *
 * Pure, and deliberately narrow. A B-race reshapes the week it falls in and the
 * one after, and nothing else — it does not touch cv_pace, the allocation, the
 * peak ceiling or the ramp. Adaptation from its *result* flows through the
 * normal capability hierarchy, not through here.
 */

export type BRaceInput = {
  /** the week number it falls in, 1-based */
  week: number;
  /** 0 = Monday, so the week can be re-solved around it */
  day: number;
  intent: Intent;
  /** true for a full Hyrox, whatever the intent — see recovery below */
  full_event: boolean;
};

export type Week = {
  n: number; km: number; deload: boolean; taper: boolean; note: string;
  benchmark?: boolean;
  sessions: { day: number; kind: string; hard: boolean; label: string; km?: number;
    commitment?: boolean }[];
};

export type Flag = { code: string; message: string };

/** How many key sessions each intent may take. Never more. */
export const KEY_SESSIONS_DROPPED: Record<Intent, number> = {
  training: 0, sharpen: 1, compete: 2,
};

/** The week after a compete effort is still recovering. */
export const NEXT_WEEK_AFTER_COMPETE = -0.15;

/** A deload this close is absorbed rather than scheduled alongside. */
export const ABSORB_WITHIN_WEEKS = 1;

const KEY_KINDS = ["quality_run", "long_run", "hyrox"];
const isKey = (s: Week["sessions"][number]) => s.hard && KEY_KINDS.includes(String(s.kind));

/**
 * Apply every secondary race to the block.
 *
 * Order matters: the deload is absorbed before volume is cut, so a week that
 * takes both does not take the cut twice.
 */
export function applyBRaces(
  weeks: Week[], races: BRaceInput[],
): { weeks: Week[]; flags: Flag[] } {
  const out: Week[] = weeks.map((w) => ({ ...w, sessions: [...w.sessions] }));
  const flags: Flag[] = [];

  for (const race of [...races].sort((a, b) => a.week - b.week)) {
    const w = out.find((x) => x.n === race.week);
    if (!w) continue;

    /*
     * 5 · A benchmark or a full simulation never shares a week with a race.
     * Both are hard tests, and two in one week measures neither.
     */
    if (w.benchmark) {
      w.benchmark = false;
      flags.push({
        code: "benchmark_moved",
        message: `Week ${w.n} had a benchmark in it and a race. The test moves — two hard efforts in one week measures neither of them.`,
      });
    }
    w.sessions = w.sessions.filter((s) => String(s.kind) !== "benchmark");

    /*
     * 1 · Absorb the deload. A down week due within one week of a race is moved
     * onto the race week rather than scheduled beside it: two low weeks in a row
     * inside the specific phase is a fortnight of lost training.
     */
    const near = out.find((x) => x.deload && x.n !== w.n
      && Math.abs(x.n - w.n) <= ABSORB_WITHIN_WEEKS && !x.taper);
    if (near) {
      near.deload = false;
      w.deload = true;
      flags.push({
        code: "deload_absorbed",
        message: `The down week moves from week ${near.n} onto week ${w.n}, where the race already lowers the load. Two easy weeks together would cost a fortnight of training.`,
      });
    }

    /*
     * 2 · The race replaces, never adds. Whatever was on that day goes — a race
     * is a session, not an extra. The athlete's own commitments go too: nobody
     * does a spin class on race day.
     */
    const displaced = w.sessions.filter((s) => s.day === race.day);
    w.sessions = w.sessions.filter((s) => s.day !== race.day);

    /*
     * 3 · Protect the key session count. Sharpen drops the key session before the
     * race; compete drops two. Never more — those are the sessions the whole
     * adaptation loop runs on, and if the arithmetic wants a third the intent was
     * set too high for the gap and should have been gated.
     */
    const budget = KEY_SESSIONS_DROPPED[race.intent];
    const alreadyGone = displaced.filter(isKey).length;
    let toDrop = Math.max(0, budget - alreadyGone);
    if (toDrop > 0) {
      // Nearest before the race first: that is the one the taper eats.
      const candidates = w.sessions
        .filter(isKey)
        .sort((a, b) => Math.abs(a.day - race.day) - Math.abs(b.day - race.day));
      const dropping = new Set(candidates.slice(0, toDrop));
      w.sessions = w.sessions.map((s) =>
        dropping.has(s) ? { ...s, kind: "easy_run", hard: false, label: "Easy run" } : s);
      toDrop -= dropping.size;
    }

    w.sessions.push({
      day: race.day, kind: "race", hard: true,
      label: race.intent === "compete" ? "RACE" : `Race — ${race.intent}`,
    });

    /*
     * 4 · Recovery scales with the event, not the intent. A full Hyrox is a full
     * Hyrox even at training intent — an athlete taking 70–80% of the station
     * work has done a heavy day whatever they called it. The day after is off
     * either way; the taper in front of it is what the intent buys.
     */
    if (race.full_event) {
      const after = w.sessions.find((s) => s.day === race.day + 1 && s.hard);
      if (after) {
        w.sessions = w.sessions.map((s) =>
          s === after ? { ...s, kind: "rest", hard: false, label: "Off — day after the race" } : s);
      }
    }

    // Volume comes off the week, once.
    const cut = 1 + INTENT_COST[race.intent].week_volume;
    w.km = Math.max(3, Math.round(w.km * cut * 10) / 10);
    w.note = w.note
      ? `${w.note} · race week (${race.intent})`
      : `Race week — ${race.intent}`;

    if (race.intent === "compete") {
      const next = out.find((x) => x.n === w.n + 1 && !x.taper);
      if (next) {
        next.km = Math.max(3, Math.round(next.km * (1 + NEXT_WEEK_AFTER_COMPETE) * 10) / 10);
        next.note = next.note ? `${next.note} · coming back` : "Coming back from the race";
      }
    }

    /*
     * 6 · A mid-week race breaks the template.
     *
     * The hard days cannot sit either side of the race, so they move to the
     * furthest free day rather than being demoted. Demoting them was the first
     * version and it was wrong: it spent key sessions that rule 3 had already
     * budgeted, so a sharpen race could quietly cost two of them. Rule 3 owns
     * that number, and this rule may not add to it.
     */
    if (race.day > 0 && race.day < 5) {
      const taken = new Set(w.sessions.map((s2) => s2.day));
      const free = [0, 1, 2, 3, 4, 5, 6]
        .filter((d) => !taken.has(d) && Math.abs(d - race.day) > 1)
        .sort((x, y) => Math.abs(y - race.day) - Math.abs(x - race.day));

      let moved = 0, demoted = 0, stuck = 0;
      w.sessions = w.sessions.map((s2) => {
        if (!s2.hard || s2.kind === "race" || s2.commitment) return s2;
        if (Math.abs(s2.day - race.day) > 1) return s2;

        const to = free.shift();
        if (to !== undefined) { moved++; return { ...s2, day: to }; }

        /*
         * Nowhere to move it. A week that is already full has to give something
         * up — but not a key session, because rule 3 owns that budget and has
         * already spent it. So a non-key hard day comes down, and a key one
         * stays put and is reported rather than quietly sacrificed.
         */
        if (!isKey(s2)) {
          demoted++;
          return { ...s2, kind: "easy_run", hard: false, label: "Easy run" };
        }
        stuck++;
        return s2;
      });

      if (moved || demoted) {
        const parts = [
          moved ? `${moved} moved` : "",
          demoted ? `${demoted} eased` : "",
        ].filter(Boolean).join(" and ");
        flags.push({
          code: "midweek_race",
          message: `Week ${w.n}'s race is mid-week, so the hard days either side of it were re-solved — ${parts}. The race is the fixed point, not the template.`,
        });
      }
      if (stuck) {
        flags.push({
          code: "midweek_race_crowded",
          message: `Week ${w.n} is full enough that ${stuck === 1 ? "a key session still sits" : `${stuck} key sessions still sit`} beside the race. Moving ${stuck === 1 ? "it" : "them"} would cost more key work than a ${race.intent} race is allowed to.`,
        });
      }
    }
  }

  return { weeks: out, flags };
}

// ------------------------------------------------------------------ assertions

/**
 * What must be true afterwards.
 *
 * Same shape as the generator's other assertions: a violation is reported rather
 * than corrected, because a silent correction hides the thing worth knowing.
 */
export function violations(
  weeks: Week[], races: BRaceInput[], original: Week[],
): Flag[] {
  const out: Flag[] = [];

  for (const race of races) {
    const w = weeks.find((x) => x.n === race.week);
    if (!w) continue;

    if (w.taper) {
      out.push({
        code: "race_in_taper",
        message: `Week ${w.n} is taper and holds a secondary race. That should have been refused at intake, not planned around.`,
      });
    }
    if (w.benchmark || w.sessions.some((s) => String(s.kind) === "benchmark")) {
      out.push({
        code: "benchmark_in_race_week",
        message: `Week ${w.n} still has a benchmark alongside a race.`,
      });
    }

    // Volume must not collapse below 60% of the weeks around it — unless the
    // athlete is racing it, which is what compete means.
    if (race.intent !== "compete") {
      const around = weeks.filter((x) => Math.abs(x.n - w.n) === 1 && !x.taper);
      const ref = around.length
        ? around.reduce((n, x) => n + x.km, 0) / around.length : w.km;
      if (ref > 0 && w.km < ref * 0.6) {
        out.push({
          code: "race_week_too_light",
          message: `Week ${w.n} is ${w.km} km against ${Math.round(ref)} km around it. A ${race.intent} race should not cost that much.`,
        });
      }
    }

    const before = original.find((x) => x.n === race.week);
    if (before) {
      const lost = before.sessions.filter(isKey).length
        - w.sessions.filter(isKey).length;
      if (lost > KEY_SESSIONS_DROPPED[race.intent]) {
        out.push({
          code: "too_many_key_sessions_dropped",
          message: `Week ${w.n} lost ${lost} key sessions to a ${race.intent} race, which allows ${KEY_SESSIONS_DROPPED[race.intent]}.`,
        });
      }
    }
  }

  return out;
}
