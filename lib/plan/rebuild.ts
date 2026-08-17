/**
 * Rebuilding one week around what has actually changed.
 *
 * The division that keeps this safe: an LLM parses the sentence, this rebuilds the week.
 * Nothing here reads free text and nothing upstream writes sessions — natural language
 * enters at the edges and never into the arithmetic, so a rebuilt week passes exactly the
 * same assertions as a generated one.
 *
 * Pure: a week and a set of constraints in, a new week and an account of what it cost out.
 */

export type Availability = "full" | "am" | "pm" | "none";

export type DayAvailability = { day: number; available: Availability };

export type SessionAction = {
  day: number;
  session_type?: string;
  action: "skip" | "move" | "shorten";
  to_day?: number;
  to_slot?: "AM" | "PM";
};

export type WeekIntent = {
  no_long_run?: boolean;
  reduce_volume?: boolean;
  protect?: string[];
};

export type Constraints = {
  day_availability?: DayAvailability[];
  session_actions?: SessionAction[];
  week_intent?: WeekIntent;
};

export type WeekSession = {
  id: string;
  day: number;
  kind: string;
  label: string;
  km?: number;
  slot?: "AM" | "PM" | null;
  hard?: boolean;
  /** true once the athlete has recorded anything against it */
  logged?: boolean;
};

export type Rebuilt = {
  sessions: WeekSession[];
  dropped: { id: string; kind: string; label: string; why: string }[];
  moved: { id: string; from: number; to: number; from_km?: number; to_km?: number }[];
  volume_delta: number;
  refusals: { what: string; why: string }[];
};

/**
 * What survives when capacity shrinks. Sacrifice from the bottom.
 *
 * Strength goes first because one missed session is maintenance lost, not fitness lost.
 * The key session goes last because dropping it blinds the adaptation engine for a
 * fortnight — it is the only source of pace evidence the plan has.
 */
const PRIORITY: Record<string, number> = {
  quality_run: 1, benchmark: 1, race: 0,
  long_run: 2,
  easy_run: 3,
  hyrox: 4, easy_hyrox: 4,
  strength: 5,
};

const priorityOf = (kind: string) => PRIORITY[kind] ?? 4;

/** A long run below 60% of its prescription is not a long run. */
export const LONG_RUN_FLOOR = 0.6;

const kmOf = (s: WeekSession) => s.km ?? 0;
const totalKm = (ss: WeekSession[]) => ss.reduce((n, s) => n + kmOf(s), 0);

/** Whether a session may sit on a day, given what the athlete said about it. */
function fits(av: Availability, slot: WeekSession["slot"]): boolean {
  if (av === "none") return false;
  if (av === "full") return true;
  // A session with no stated slot can take either half of a part-available day.
  if (!slot) return true;
  return av === (slot === "AM" ? "am" : "pm");
}

export function rebuildWeek(week: WeekSession[], c: Constraints = {}): Rebuilt {
  const availability = new Map<number, Availability>(
    (c.day_availability ?? []).map((d) => [d.day, d.available]),
  );
  const av = (day: number) => availability.get(day) ?? "full";
  const intent = c.week_intent ?? {};
  const protectedKinds = new Set(intent.protect ?? []);

  const originalKm = totalKm(week);
  const dropped: Rebuilt["dropped"] = [];
  const moved: Rebuilt["moved"] = [];
  const refusals: Rebuilt["refusals"] = [];

  /*
   * A logged day is untouchable.
   *
   * Forward only: a rebuild renegotiates what has not happened yet. Rewriting a session
   * somebody has already done would change the record of their week, and the adherence
   * figures read from it.
   */
  const locked = week.filter((s) => s.logged);
  let open = week.filter((s) => !s.logged);

  // Explicit instructions first: the athlete asking for something outranks inference.
  for (const a of c.session_actions ?? []) {
    const target = open.find((s) => s.day === a.day
      && (!a.session_type || s.kind === a.session_type));
    if (!target) continue;
    if (a.action === "skip") {
      dropped.push({ ...target, why: "you asked to skip it" });
      open = open.filter((s) => s !== target);
    } else if (a.action === "move" && a.to_day != null) {
      target.day = a.to_day;
      if (a.to_slot) target.slot = a.to_slot;
    }
  }

  if (intent.no_long_run) {
    const long = open.find((s) => s.kind === "long_run");
    if (long) {
      /*
       * Moved before dropped.
       *
       * A long run relocated to a Friday evening and cut to 12 km beats a long run
       * deleted — and that is what the athlete would choose if asked, so it is what the
       * rebuild tries first.
       */
      const slot = [...Array(7).keys()].find((d) =>
        d !== long.day && av(d) !== "none"
        && !open.some((s) => s !== long && s.day === d && (s.hard || priorityOf(s.kind) <= 2)));
      if (slot != null) {
        const before = kmOf(long);
        long.day = slot;
        long.km = Math.round(before * LONG_RUN_FLOOR * 10) / 10;
        moved.push({ id: long.id, from: slot, to: slot, from_km: before, to_km: long.km });
      } else {
        dropped.push({ ...long, why: "there was no legal day left for it" });
        open = open.filter((s) => s !== long);
      }
    }
  }

  /*
   * Now the days that are gone. Lowest priority first, so strength absorbs the loss
   * before the long run does and the key session is the last thing anybody loses.
   */
  const byPriority = [...open].sort((a, b) => priorityOf(b.kind) - priorityOf(a.kind));
  for (const s of byPriority) {
    if (fits(av(s.day), s.slot)) continue;
    if (protectedKinds.has(s.kind)) {
      refusals.push({
        what: s.label,
        why: "you asked to protect it, so it stays where it is even though that day is not free",
      });
      continue;
    }
    // A protected session tries to move before it is given up.
    if (priorityOf(s.kind) <= 2) {
      const slot = [...Array(7).keys()].find((d) => av(d) !== "none"
        && !open.some((o) => o !== s && o.day === d && o.hard));
      if (slot != null) {
        moved.push({ id: s.id, from: s.day, to: slot });
        s.day = slot;
        continue;
      }
    }
    dropped.push({ ...s, why: `you are not available on that day` });
    open = open.filter((o) => o !== s);
  }

  /*
   * And the week never gains volume.
   *
   * Cramming a lost week into the days that are left is how people get hurt, and it is
   * the instinct this feature exists to resist on the athlete's behalf. Reported honestly
   * so the screen can say it out loud rather than implying nothing was lost.
   */
  const sessions = [...locked, ...open].sort((a, b) => a.day - b.day);
  let delta = Math.round((totalKm(sessions) - originalKm) * 10) / 10;
  if (delta > 0) {
    refusals.push({
      what: "making the week up",
      why: "a rebuilt week never carries more than the one it replaces",
    });
    delta = 0;
  }

  return { sessions, dropped, moved, volume_delta: delta, refusals };
}
