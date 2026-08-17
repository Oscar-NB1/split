import { type Allocation, type Goal, type Role, allocationFor, roleFrom } from "./allocate";
import { applyAbsences, benchmarkWeeks, creditFor } from "./adjust";
import { type Absence } from "./intake-rules";
import { canDoStations, ladderFor, otherLadder, otherRung, rungFor } from "./ladders";
import { hyroxKindFor } from "./zone-budget";
import {
  continuousRun, easyHyrox, hyroxClass, hyroxSession, longRun, qualityRun,
  type LongShape,
} from "./session";
import { kitFrom, strengthNote, strengthTarget } from "./strength";
import { applyBRaces } from "./braces";
import { whyFor } from "./why";
import { purposeFor } from "./purpose";
import { type Anchor, prescribe, sharpen } from "./paces";
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
  /** what the athlete said they can reach, for the strength lifts */
  equipment?: string[];
  /** whether the station work is written out, attended as classes, or mixed */
  session_style?: "written" | "classes" | "mix";
  /** whether the long run carries a pace target */
  long_run_pace?: boolean;
  /** 0 = Monday, or null for no preference */
  long_run_day: number | null;
  /**
   * The longest run this athlete is known to have done, in km.
   *
   * Measured where the file has one, and otherwise the figure they typed into the
   * intake. It is the floor under the long run: a share of the week is a sensible
   * guide and a terrible floor, and a first week that halves somebody's longest run
   * is the plan ignoring the one number they volunteered.
   */
  longest_run_km?: number | null;
  /**
   * The station loads for the division the athlete entered.
   *
   * A station without a weight is half an instruction, and the half it leaves out is
   * the half that decides whether the session was the session.
   */
  standards?: {
    sled_push_total_kg: number; sled_pull_total_kg: number;
    farmers_kg: number; lunge_kg: number; wall_ball_kg: number;
  } | null;
  /**
   * Days the athlete has taught the plan, by session kind. 0 = Monday.
   *
   * Learned from them moving a session and saying "always", rather than asked for in
   * the intake — the long run is the only one worth a question, and the rest are
   * discovered by an athlete rearranging their own week.
   */
  day_prefs?: Partial<Record<string, number>>;
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
  /**
   * Race day, and any race the athlete has entered before it.
   *
   * The plan was built backwards from the race date and then never wrote the race
   * into it: race day arrived as an ordinary Sunday long run, and a B-race entered
   * in the intake reshaped nothing. Both are sessions, and the weeks around them
   * are different weeks.
   */
  race_date?: string | null;
  b_races?: { date: string; intent: "training" | "sharpen" | "compete"; full_event: boolean }[];
  /** the athlete's first day, which may be mid-week; week 1 is short */
  first_day?: string;
};

export type Session = {
  day: number; kind: SlotKind | string; hard: boolean;
  label: string; km?: number;
  /** which ladder this session came from, which decides how fast its work is */
  ladder?: string;
  /** the prescription, in the syntax the app parses and the watch understands */
  target_text?: string;
  /** one line about the session, where the kind has something worth saying */
  note_text?: string;
  /** why this session, in this week — the first thing the session screen shows */
  why_text?: string;
  /**
   * What the session is for, in the athlete's terms — the headline above the
   * prescription.
   *
   * Separate from `label`, which is parsed: `prescribedPace` reads a pace out of the
   * title and calibration reads that, so this is a second name rather than a rename.
   */
  purpose?: string;
  /** how long it takes, from what is in it rather than from its distance */
  minutes?: number;
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
/**
 * Where a long run stops being worth it.
 *
 * The race is eight one-kilometre repeats with stations between them. Twenty-two
 * kilometres builds every bit of durability that demands; twenty-six buys fatigue.
 */
export const LONG_RUN_CAP = 22;

/**
 * And an easy run stops at eleven.
 *
 * Not a proportion of anything. An easy run is a recovery and aerobic-maintenance
 * session, and past about an hour and ten it stops being either: it needs its own
 * recovery, it eats into the next hard day, and the aerobic return per kilometre has
 * long since flattened. Everything above this is a long run wearing an easy label,
 * and the plan already has one of those.
 *
 * Weeks whose volume will not fit under it say so rather than writing a 15 km "easy"
 * run to balance the arithmetic.
 */
export const EASY_MAX_KM = 11;

const SHARE: Partial<Record<SlotKind, number>> = {
  long_run: 0.32, quality_run: 0.22, easy_run: 0.20, hyrox: 0.18, easy_hyrox: 0.10,
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
      quality_target: p.quality_target, phase: w.phase,
      /*
       * Alternating weeks, from the block's own count rather than a setting: every
       * other loading week absorbs. The deload weeks are already light, so they are
       * left out of the alternation rather than being made lighter again.
       */
      absorb: !w.deload && !w.taper && w.n % 2 === 0,
    });
    for (const f of slotPlan.flags) flags.push({ code: "slots", message: f });

    const placed = placeWeek({
      slots: slotPlan.slots, available_days: p.days,
      commitments: p.commitments, training_age: r.training_age,
      rest_day: p.rest_day, allow_doubles: p.allow_doubles ?? false,
      long_run_day: p.long_run_day,
      day_prefs: p.day_prefs,
    });
    for (const f of placed.flags) flags.push({ code: "placement", message: f });

    // commitments give some of the week's volume back, less and less as the
    // block goes on
    /*
     * The week's running is the week's running.
     *
     * Commitments used to buy it down — two kickboxing sessions credited nine
     * kilometres of "equivalent volume", so a 60 km week prescribed 48 km of actual
     * running and the athlete was short of their own target every week. A class the
     * athlete already attends is load on top of the plan, not running the plan no
     * longer has to write. The credit still exists for the load budget; it no longer
     * reduces what gets prescribed.
     */
    const runnable = Math.max(3, Math.round(w.km * 10) / 10);

    /*
     * The athlete's running comes into the choice, not just the phase.
     *
     * Without it every athlete drew from the same ladders and somebody who does not
     * run yet was handed threshold intervals in week one.
     */
    const ladder = ladderFor(w.phase, inPhase, stations, p.running_base);
    const rung = rungFor(ladder, p.running_base, inPhase, w.phase, w.n - 1);
    /*
     * The Hyrox session is named as well.
     *
     * It was labelled "hyrox" and titled "Hyrox session", which says only that it
     * exists. The race-specific ladder already describes what the session is —
     * compromised running, transitions, a half or full simulation — and it
     * progresses with the phase, so the name says what week of the block it is.
     */
    /*
     * Which race-specific session, from what the phase is for — not from a counter.
     *
     * The rung came off a ladder that climbed by week, so the *kind* of session was
     * decided by arithmetic: transitions appeared in the base phase because the counter
     * had reached them, and a simulation could arrive before there was anything to
     * simulate. Each of the four trains something different and each belongs somewhere,
     * which is a statement about phases rather than about week numbers.
     */
    const hyroxRung = stations ? hyroxKindFor(w.phase, inPhase, true) : null;
    /*
     * A second one in the same week is the other half of the phase's mix.
     *
     * Never the same session twice — and never a full simulation as the second, because
     * a week holding two race-specific sessions cannot afford one of them to be a race.
     */
    const hyroxRung2 = stations
      ? hyroxKindFor(w.phase, inPhase + 1, false)
      : null;

    // the benchmark replaces ONE quality run, not every one of them
    let benchTaken = false;
    /*
     * The second quality run is a different session, not the same one twice.
     *
     * A Hard week asks for two, and both were written from the same ladder rung —
     * "4 × 8 min" on Monday and "4 × 8 min" on Tuesday. The second draws from the
     * next rung in the cycle, so the week holds two different stimuli.
     */
    let qualitySeen = 0;
    /** Which ladder each quality run came from, so it can be paced as itself. */
    /*
     * The second hard session trains what is actually costing them time.
     *
     * Their role comes from the intake's own five-point deltas, so this is the
     * athlete's own account of which half of the race they lose it in.
     */
    const secondLadder = otherLadder(ladder, stations, role);
    /*
     * Two Hyrox sessions in a week were the same session twice — the same rung, the
     * same name, on consecutive days. The second takes the next rung of the
     * race-specific ladder, so a week that carries two carries two different ones.
     */
    let hyroxSeen = 0;
    const sessions: Session[] = placed.week.map((s) => {
      const isQuality = s.kind === "quality_run";
      const second = isQuality && qualitySeen++ > 0;
      const thisLadder = second ? secondLadder : ladder;
      const thisRung = second
        ? rungFor(secondLadder, p.running_base, inPhase, w.phase, w.n - 1)
        : rung;
      const isBench = benchmarks.has(w.n) && isQuality && !benchTaken;
      if (isBench) benchTaken = true;
      const share = SHARE[s.kind as SlotKind];
      const isCommitment = p.commitments.some((c) => c.activity === s.kind);
      return {
        day: s.day,
        kind: isBench ? "benchmark" : s.kind,
        ...(isCommitment ? { commitment: true } : {}),
        hard: s.hard,
        label: s.label ?? (isBench ? "Benchmark test"
          : isQuality ? thisRung.label
          : s.kind === "easy_hyrox" ? "Easy Hyrox · ski, row and broad jumps"
          : s.kind === "hyrox" && hyroxRung
            ? `Hyrox · ${(hyroxSeen++ === 0 ? hyroxRung : hyroxRung2 ?? hyroxRung).toLowerCase()}`
          : String(s.kind)),
        km: share ? Math.round(runnable * share * 10) / 10 : undefined,
        ladder: isQuality ? thisLadder : undefined,
        prescription: share
          ? prescribe(p.anchor, isQuality ? "cv" : s.kind === "long_run" ? "long" : "easy",
              p.max_hr, isQuality ? 4 : 2, isQuality ? 7 : 4)
          : null,
      };
    });

    /*
     * What is actually in each session, and what that costs.
     *
     * Until here a session was a name and a share of the week's kilometres, which
     * is why "2 × 15 min" and "5 × 1000 m" both came out as 13.4 km and 80 minutes,
     * and why the screen underneath either of them was empty. The prescription is
     * written now — warm-up, the reps, the rest between them, the cool-down — and
     * the distance and the time are read back off it.
     *
     * The easy runs absorb the difference, so the week still totals what the volume
     * curve says: a quality session that costs less than its share gives the
     * remainder back to the easy running rather than to nobody.
     */
    /*
     * The anchor, sharpened by how far into the block this week is.
     *
     * It was one number for four months: week 14's threshold target was week 1's, so a
     * plan built to make somebody faster never once asked them to run faster. Three per
     * cent across the block — about 8 s/km on a 4:26 threshold — which is what a
     * rebuilt aerobic base actually returns over three months.
     *
     * Easy running is sharpened with it rather than held: an athlete whose threshold has
     * moved has an easy pace that has moved too, and holding easy at the old number
     * would slowly turn it into a steady run.
     */
    const progress = p.length > 1 ? (w.n - 1) / (p.length - 1) : 0;
    const cvPace = sharpen(p.anchor?.cv_pace_s_per_km ?? 300, progress);
    // Easy is a fixed distance from the critical-velocity pace: there is no
    // separate easy anchor, and inventing one here would be a second opinion.
    const easyPace = Math.round(cvPace * 1.25);
    /*
     * The long run is paid first.
     *
     * It was paid last, out of whatever the quality sessions had not spent — which
     * in a 54 km week left a "long run" of 4.4 km. It is the session the block is
     * built from, so it takes its share of the week before anything else is sized,
     * and the quality work fits around it.
     */
    const long = sessions.find((s) => String(s.kind) === "long_run");
    if (long) {
      /*
       * What the long run asks for follows the difficulty dial, which the screen has
       * been promising and the plan has been ignoring: distance alone on Steady, a
       * quarter at effort on Challenging, and blocks — or a whole run at an average —
       * on Hard, because switching pace under fatigue is the demand of the race.
       */
      /*
       * The long run carries the quality in the absorb week, and nothing in the
       * load week.
       *
       * A week with two hard sessions in it does not need a third; a week with one
       * can afford to put pace inside the long run, which is where running under
       * fatigue is actually trained. So the same block alternates: intervals and a
       * plain long run one week, one interval session and a structured long run the
       * next — at the same volume, differently spent.
       */
      const absorbWeek = !w.deload && !w.taper && w.n % 2 === 0;
      const shape: LongShape = !p.long_run_pace || !absorbWeek ? "steady"
        : (p.quality_target ?? 1) < 2 ? "finish"
        : w.n % 4 === 0 ? "timed"
        : "blocks";
      const steady = Math.round(cvPace * 1.12);
      /*
       * It grows with the block and then stops.
       *
       * Past about 22 km a long run costs a Hyrox athlete more in recovery than it
       * returns: the race is eight kilometre repeats, not a marathon, and the
       * durability it needs is trained by the blocks inside the run rather than by
       * another four kilometres on the end.
       */
      /*
       * And it never starts below what the athlete can already run.
       *
       * A flat 32% of the week is a sensible guide and a terrible floor: a 34 km first
       * week gave a 10.9 km "long run" to somebody whose longest run on file is 19 km.
       * Nothing about starting a block makes a person forget how to run for two hours,
       * and a long run that halves is not a conservative start — it is the plan
       * ignoring the one number the athlete volunteered.
       *
       * So the share sets the shape of the ramp and their own longest run sets the
       * floor, at 90% of it: enough to be comfortably inside what they have done,
       * close enough that week one is recognisable as their own training.
       *
       * A deload or taper week is exempt. Those weeks are meant to be shorter, and a
       * floor that held the long run up through a taper would defeat the taper.
       */
      const easing = w.taper || w.deload;
      const known = p.longest_run_km ?? 0;
      const floor = easing || known < 6 ? 0 : Math.min(LONG_RUN_CAP, known * 0.9);
      const guide = Math.min(LONG_RUN_CAP, w.km * 0.32, runnable * 0.36);
      /*
       * And the floor stops at 40% of the week, because the ramp outranks it.
       *
       * The week's volume comes from a curve built on what the athlete has actually
       * been running, and that curve is a safety rule — letting a long-run floor push
       * a week past it would trade one conservative number for a genuinely risky one.
       * Forty per cent is already a long-run-dominant week.
       *
       * Where their longest run is more than that, the limiter is the weekly volume
       * rather than the long run, and the week says so. That is the true and useful
       * thing to tell somebody who has run 19 km inside a 37 km week: the Sunday is
       * not the problem.
       */
      const ceiling = Math.max(guide, w.km * 0.40);
      const km = Math.max(5, Math.min(Math.max(guide, floor), ceiling));
      if (floor > ceiling + 0.5) {
        flags.push({
          code: "long_run_share",
          message: `Week ${w.n}: you have run ${known} km before, but a ${Math.round(w.km)} km week cannot carry that in one session — the long run is held at ${km.toFixed(1)} km. Your weekly volume is the limiter, not your long run.`,
        });
      }
      const built = longRun(
        km, easyPace, steady, easing ? "steady" : shape, String(w.phase));
      long.km = built.km;
      long.target_text = built.target;
      long.minutes = built.minutes;
    }

    let spent = long?.km ?? 0;
    for (const s of sessions) {
      const kind = String(s.kind);
      if (kind === "long_run") continue;
      if (kind === "quality_run" || kind === "benchmark") {
        // No single session may exceed 40% of the week — the bound the plan asserts
        // against itself, applied where the session is built rather than checked
        // after the fact.
        const built = qualityRun(s.label, cvPace, easyPace, w.km * 0.38, inPhase,
          s.ladder ?? "L4");
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
        if (built.title && kind === "quality_run") s.label = built.title;
      } else if (kind === "hyrox") {
        /*
         * A class where the athlete said they train in classes. "Mix" is classes for
         * the stations too — the intervals are the part it keeps written.
         */
        /*
         * The written session, always — even for an athlete who trains in classes.
         *
         * A class used to replace the prescription with a note to itself: "Hyrox class
         * / 2 km running inside it / Stations at race weight", which the session screen
         * then printed as a numbered list of instructions. It is not a session and
         * nobody can do it.
         *
         * The session is now always written out, station by station, at their division's
         * weights — and the screen offers it beside guidance on which class to book.
         * An athlete who goes to a class ignores the prescription; one whose class is
         * cancelled has the session in their hand.
         */
        const asClass = p.session_style === "classes" || p.session_style === "mix";
        // The loads come from the division they entered, so every station carries the
        // weight they will actually race.
        const built = hyroxSession(
          s.label, easyPace, 4, kitFrom(p.equipment), w.n, p.standards, p.running_base,
          // The session grows with the block, the same way the interval ladders do.
          String(w.phase), inPhase,
          // How far through the block this week is, so the compromised run extends a
          // hundred metres at a time rather than jumping at a phase boundary.
          adjusted.length > 1 ? (w.n - 1) / (adjusted.length - 1) : 0);
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
        if (built.title) s.label = built.title;
        if (built.note) s.note_text = built.note;
        /*
         * The class note survives, as a note.
         *
         * It was never a prescription — it is what to look for on a timetable, which is
         * the right thing to say to somebody who trains in classes and the wrong thing
         * to put in a numbered list of steps.
         */
        if (asClass) {
          const cls = hyroxClass(s.label);
          if (cls.note) s.note_text = cls.note;
        }
      } else if (kind === "easy_hyrox") {
        const built = easyHyrox();
        s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
        if (built.note) s.note_text = built.note;
      } else if (kind === "strength") {
        /*
         * The lifts, which were never written at all — the screen said "no lifts
         * prescribed for this one" above a session the plan had told the athlete to
         * protect. Chosen from the equipment they said they can reach.
         */
        s.target_text = strengthTarget(w.phase, w.n, kitFrom(p.equipment));
        s.note_text = strengthNote(w.phase);
      }
      /*
       * Easy runs are not counted here: they are sized from what is left, and
       * counting their placeholder share first meant they were subtracted from
       * their own budget. That is why an absorb week came out smaller — the second
       * interval session became an easy run and then the easy runs were funded from
       * a total that already pretended they existed.
       */
      /*
       * Compromised running is not running volume.
       *
       * The kilometres inside a Hyrox session are broken into four-hundred-metre
       * pieces, run off a sled, and — where the athlete attends a class — not even
       * knowable. Counting them in the week's running made the ledger fiction and
       * made the easy runs short: the plan believed it had already written volume it
       * had not. They are load, and they are stated on the session; they are not
       * kilometres the aerobic ledger gets to spend.
       *
       * Easy runs are excluded here for a different reason: they are sized from what
       * is left, so counting their placeholder share would fund them from a budget
       * that already pretended they existed.
       */
      if (kind !== "easy_run" && kind !== "hyrox" && kind !== "easy_hyrox") {
        spent += s.km ?? 0;
      }
    }
    const easies = sessions.filter((s) => String(s.kind) === "easy_run");
    /*
     * Easy running fills the week to its target.
     *
     * Not "whatever is left over" — the difference between the prescribed sessions
     * and the week's volume is real running that has to be written somewhere, and
     * easy running is where it belongs. This is also what stops an absorb week from
     * being a smaller week: the second interval session becomes an easy run of the
     * same volume, not a shorter one.
     */
    const left = Math.max(easies.length * 4, runnable - spent);
    /*
     * An easy run has a ceiling, and it is 11 km.
     *
     * Two ceilings, and the lower one wins. Relative to the long run, because filling
     * the week from one easy session produced a 19.9 km "easy run" beside a 19.5 km
     * long run — two long runs, one of them mislabelled. And absolute, because two
     * thirds of a 22 km long run is still 14.7 km, and a 15 km easy run is not an easy
     * run: it is a second long run with a mild pace target, it takes a day and a half
     * to recover from, and it exists only because the arithmetic needed somewhere to
     * put the kilometres.
     *
     * Whatever will not fit is said out loud rather than quietly added to a session
     * that cannot hold it.
     */
    const longKm = long?.km ?? 0;
    const easyCap = Math.min(EASY_MAX_KM, Math.max(6, longKm * 0.67));
    let spill = 0;
    for (const s of easies) {
      const want = Math.max(3, left / easies.length);
      const km = Math.min(want, easyCap);
      spill += want - km;
      const built = continuousRun(km, easyPace);
      s.km = built.km; s.target_text = built.target; s.minutes = built.minutes;
    }
    /*
     * What will not fit is said, not hidden.
     *
     * The obvious place to put it is the long run, and that is the wrong place: the
     * long run's length is a training decision that progresses across the block, not
     * a bucket for the arithmetic's leftovers. A week whose volume needs a day it
     * does not have should say so.
     */
    if (spill > 1) {
      flags.push({
        code: "volume_spill",
        message: `Week ${w.n} carries about ${Math.round(spill)} km more running than ${
          easies.length + 1} running days can sensibly hold. Another day would take it; otherwise the week runs a little under.`,
      });
    }

    /*
     * The week's number is the sum of what it asks for.
     *
     * It was the volume curve's number, while the sessions written under it added up
     * to twelve kilometres less — the commitment credit was subtracted from what got
     * prescribed and not from what was displayed. Every screen quoted the target, so
     * an athlete doing exactly what they were told was short of it every week. The
     * curve still governs the ramp and the ceiling; it is no longer also a promise
     * nobody kept.
     */
    /*
     * The week's number is its running, and only its running.
     *
     * A Hyrox session states the running inside it and does not count toward the
     * week: "60 km" has to mean sixty kilometres of running the athlete can plan
     * around, not fifty-two plus whatever a class turned out to contain.
     */
    const RUNNING = ["quality_run", "easy_run", "long_run", "benchmark"];
    const prescribed = Math.round(
      sessions
        .filter((x) => RUNNING.includes(String(x.kind)))
        .reduce((n, x) => n + (x.km ?? 0), 0) * 10) / 10;

    /*
     * Why each session matters, written for the session rather than inherited from
     * whatever flag the pace prescription carried. Only the plan's own sessions: a
     * class the athlete already attends is theirs, and the plan has nothing to teach
     * them about it.
     */
    const DAY_NAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const hardDays = sessions
      .filter((x) => !x.commitment && (x.hard || String(x.kind) === "quality_run"))
      .map((x) => DAY_NAME[x.day] ?? "");
    for (const s of sessions) {
      if (s.commitment) continue;
      const why = whyFor({
        kind: String(s.kind), phase: w.phase, week: w.n, weeks: p.length,
        hardDays, day: DAY_NAME[s.day] ?? "",
        easyCeilingHr: p.max_hr ? Math.round(p.max_hr * 0.76) : null,
      });
      if (why) s.why_text = why;
      /*
       * And the headline: what the session is for, rather than what it contains.
       *
       * "3 × 8 min" is accurate and useless — it tells an athlete what they are about to
       * do and nothing about why, so the only sessions with meaning are the ones they
       * already understood. The prescription becomes the subline.
       *
       * The label is untouched: it is parsed for the pace target, and the calibration
       * engine reads that.
       */
      /*
       * The session's own ladder, not the week's first one.
       *
       * A Hard week holds two quality runs from two different ladders, and reading the
       * week's primary gave the second one the first one's name: "5 × 1000 m" at race
       * pace was labelled "Raising your ceiling", which is the threshold session's
       * purpose.
       */
      const from = String(s.kind) === "quality_run" ? (s.ladder ?? ladder) : undefined;
      const purpose = purposeFor(String(s.kind), w.phase, {
        ladder: from, label: s.label ?? "",
      });
      if (purpose) s.purpose = purpose;
    }

    return {
      ...w, allocation, benchmark: benchmarks.has(w.n), sessions,
      km: prescribed || w.km,
      /**
       * What the volume curve asked for, kept beside what was written.
       *
       * The ramp assertion is about the curve — it is the rule the curve is built
       * to obey — while the number on the screen has to be the sum of the sessions.
       * Checking the ramp against the prescribed sum failed the plan for rounding:
       * a session gaining a rep is not the block breaking its ramp.
       */
      target_km: w.km,
      /*
       * Why this week is what it is, in one phrase.
       *
       * The reason from the absence stage was being dropped and the week carried
       * "Down week" instead — true, and not the answer to "why is my first week
       * 22.8 km". The trip is the reason; the down week is a consequence of it.
       */
      note: w.reason ?? w.note,
    };
  });

  /*
   * The races themselves.
   *
   * The block is built backwards from race day and then never wrote it down: race
   * day arrived as an ordinary Sunday long run. A race is a session — it replaces
   * whatever was on that day rather than being added beside it — and the weeks
   * around a secondary race are different weeks, which is what applyBRaces has been
   * built and tested to do and has never once been called.
   */
  const dayOf = (date: string) => {
    const first = p.week_start(1);
    const days = Math.round(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
    if (days < 0) return null;
    return { week: Math.floor(days / 7) + 1, day: days % 7 };
  };

  let withRaces = weeks;
  const secondaries = (p.b_races ?? [])
    .map((b) => ({ at: dayOf(b.date), b }))
    .filter((x): x is { at: { week: number; day: number }; b: typeof x.b } => !!x.at)
    .filter((x) => x.at.week <= weeks.length);

  if (secondaries.length > 0) {
    const applied = applyBRaces(
      withRaces as never,
      secondaries.map((x) => ({
        week: x.at.week, day: x.at.day, intent: x.b.intent, full_event: x.b.full_event,
      })),
    );
    withRaces = applied.weeks as never;
    for (const f of applied.flags) flags.push(f);

    // The race itself, on the day, replacing what was there.
    for (const x of secondaries) {
      const w = withRaces.find((y) => y.n === x.at.week);
      if (!w) continue;
      (w.sessions as Session[]) = [
        ...(w.sessions as Session[]).filter((sn) => sn.day !== x.at.day),
        {
          day: x.at.day, kind: "race", hard: true,
          label: x.b.full_event ? "Race · Hyrox" : "Race",
          minutes: x.b.full_event ? 75 : 60,
          why_text: `A race you entered. ${
            x.b.intent === "compete" ? "You said this one matters, so the week either side of it is built around it."
            : x.b.intent === "sharpen" ? "Freshened up for two days, easy for two after."
            : "Run as training — slot it in and carry on."}`,
        } as Session,
      ].sort((a, b) => a.day - b.day);
    }
  }

  const target = p.race_date ? dayOf(p.race_date) : null;
  if (target && target.week <= withRaces.length) {
    const w = withRaces.find((y) => y.n === target.week);
    if (w) {
      /*
       * Race week is a taper, not a lighter version of a normal week.
       *
       * It was the same six sessions with the volume scaled — two quality runs, two
       * Hyrox sessions and a long run, four days before a race. What race week has
       * to do is keep the athlete sharp and get out of the way: one short session at
       * race pace to remind the legs what it feels like, one easy session on the
       * stations, two days entirely clear before the gun.
       *
       * Sessions are placed relative to race day rather than to Monday, because a
       * Saturday race and a Sunday race are different weeks.
       */
      const raceDay = target.day;
      const before = (n: number) => raceDay - n;
      const keep: Session[] = [];
      const sharpener = (w.sessions as Session[]).find((sn) =>
        String(sn.kind) === "quality_run");
      if (sharpener && before(5) >= 0) {
        keep.push({
          ...sharpener,
          day: before(5),
          label: "3 × 1 km at race pace",
          km: 7,
          minutes: 45,
          target_text: [
            "- 2km Z2 warm up",
            "- 3x",
            `- 1000m Z4 ${p.anchor ? `@ ${Math.floor((p.anchor.race_pace_s_per_km) / 60)}:${String(p.anchor.race_pace_s_per_km % 60).padStart(2, "0")}/km` : ""}`.trim(),
            "- 90s Z1 walk",
            "- 1km Z1 cool down",
          ].join("\n"),
          why_text: "The last quality session of the block, and it is a reminder rather than a workout. Three kilometres at race pace to make Sunday's pace feel familiar — if it feels hard this week, that is the taper, not your fitness.",
        });
      }
      const stations = (w.sessions as Session[]).find((sn) =>
        String(sn.kind) === "hyrox" || String(sn.kind) === "easy_hyrox");
      if (stations && before(4) >= 0) {
        keep.push({
          ...stations, day: before(4), kind: "easy_hyrox",
          label: "Easy Hyrox · stations at race weight", km: 0, minutes: 35,
          why_text: "Every station at race weight, none of them to failure. This is about your hands and your positions remembering the loads, not about training.",
        });
      }
      if (before(3) >= 0) {
        keep.push({
          day: before(3), kind: "easy_run", hard: false, label: "Easy run",
          km: 6, minutes: 35,
          why_text: "Easy, and genuinely easy. The work is banked.",
        } as Session);
      }
      // before(2) — nothing. The day off is the session.
      if (before(1) >= 0) {
        keep.push({
          day: before(1), kind: "easy_run", hard: false, label: "Shakeout · 20 min",
          km: 4, minutes: 20,
          target_text: "- 4km Z2\n- 4x\n- 100m Z4 strides\n- 60s Z1 walk",
          why_text: "Twenty minutes and four strides, the day before. It keeps the legs turning over — two flat days before a race leaves you heavy on the line.",
        } as Session);
      }
      w.sessions = keep as never;
      w.note = "Race week";
    }
    if (w) {
      (w.sessions as Session[]) = [
        ...(w.sessions as Session[]).filter((sn) => sn.day !== target.day),
        {
          day: target.day, kind: "race", hard: true, label: "Race day",
          minutes: 75,
          why_text: "Race day. Nothing you do now makes you fitter — the fitness was made in the weeks behind this one. Run the first kilometre at the pace on your card, not at the pace of the person beside you.",
        } as Session,
      ].sort((a, b) => a.day - b.day);
    }
  }

  return { version: GENERATOR_VERSION, role, resolved: r, weeks: withRaces, flags };
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
