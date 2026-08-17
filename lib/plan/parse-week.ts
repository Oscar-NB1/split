import type { Availability, Constraints, DayAvailability, SessionAction } from "./rebuild";

/**
 * Turning a sentence about a week into constraints.
 *
 * The brief calls for an LLM here and it is right that one would read messy speech better.
 * This is deterministic instead, for two reasons: there is no model key configured in this
 * app, and a rule-based parser can be tested — every sentence below is a test, which is not
 * something you get from a prompt.
 *
 * The division that matters is unchanged either way: this produces constraints and nothing
 * else. It never writes a session, sets a volume or picks a pace, so a rebuilt week still
 * passes the same assertions as a generated one. Swapping this for a model call later
 * changes the parser and not the safety.
 *
 * What it handles, because these are what people actually type:
 *
 *   "out Wednesday to Friday"           a range of days
 *   "Friday night I can run"            a later statement overriding an earlier one
 *   "skipping the Hyrox class"          a named session, dropped
 *   "no long run this week"             an intent
 *   "back Thursday morning"             a half-day
 *   "away Tue, Wed"                     a list
 */

const DAYS: Record<string, number> = {
  monday: 0, mon: 0, tuesday: 1, tue: 1, tues: 1, wednesday: 2, wed: 2,
  thursday: 3, thu: 3, thurs: 3, friday: 4, fri: 4, saturday: 5, sat: 5,
  sunday: 6, sun: 6,
};

const KINDS: Record<string, string> = {
  "long run": "long_run", longrun: "long_run",
  "easy run": "easy_run", easy: "easy_run", recovery: "easy_run",
  intervals: "quality_run", "interval session": "quality_run",
  threshold: "quality_run", "key session": "quality_run", speed: "quality_run",
  hyrox: "hyrox", "hyrox class": "hyrox", class: "hyrox", station: "hyrox",
  strength: "strength", gym: "strength", lifting: "strength", weights: "strength",
};

const dayIn = (s: string): number | null => {
  const m = /\b(mon|tues?|tue|wed|thur?s?|thu|fri|sat|sun)[a-z]*\b/i.exec(s);
  return m ? DAYS[m[1].toLowerCase()] ?? DAYS[m[0].toLowerCase()] ?? null : null;
};

/** Every day named in a clause, in the order they appear. */
function daysIn(s: string): number[] {
  const out: number[] = [];
  const re = /\b(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat|sunday|sun)\b/gi;
  for (const m of s.matchAll(re)) {
    const d = DAYS[m[1].toLowerCase()];
    if (d !== undefined) out.push(d);
  }
  return out;
}

const kindIn = (s: string): string | null => {
  const lower = s.toLowerCase();
  // Longest key first, so "long run" is not matched as "run" and "hyrox class" beats "class".
  for (const key of Object.keys(KINDS).sort((a, b) => b.length - a.length)) {
    if (lower.includes(key)) return KINDS[key];
  }
  return null;
};

/** am / pm from the words people use, rather than from a clock. */
function halfOf(s: string): Availability | null {
  const l = s.toLowerCase();
  if (/\b(morning|am|early|before work|breakfast)\b/.test(l)) return "am";
  if (/\b(evening|night|pm|after work|afternoon|late)\b/.test(l)) return "pm";
  return null;
}

export type Parsed = Constraints & {
  ambiguities: { quote: string; question: string; options: string[] }[];
  confidence: "high" | "low";
};

/**
 * Later statements override earlier ones.
 *
 * "Out Wednesday to Friday" followed by "Friday night I can run" resolves to Friday PM
 * available — people self-correct mid-sentence, and the naive read produces a contradiction
 * rather than an answer. Clauses are applied in order into a map, so the last word wins.
 */
export function parseWeek(raw: string): Parsed {
  const text = (raw ?? "").trim();
  const availability = new Map<number, Availability>();
  const actions: SessionAction[] = [];
  const intent: NonNullable<Constraints["week_intent"]> = {};
  const ambiguities: Parsed["ambiguities"] = [];
  let understood = 0;

  const clauses = text.split(/[.;\n]+|,\s*(?=(?:and\s+)?\b(?:out|away|back|no|skip|can|but)\b)/i)
    .map((c) => c.trim()).filter(Boolean);

  for (const clause of clauses) {
    const l = clause.toLowerCase();
    const half = halfOf(clause);
    const days = daysIn(clause);

    /*
     * "Can run", "back", "free" — an availability statement, which may narrow an earlier
     * absence to one half of a day.
     */
    const positive = /\b(can|able|free|back|available|around|home)\b/.test(l)
      && !/\bcan(?:no|')t\b/.test(l);
    const negative = /\b(out|away|travel|can(?:no|')?t|no gym|busy|nothing|off)\b/.test(l);

    if (days.length > 0 && (positive || negative)) {
      understood += 1;
      /*
       * A range where the clause reads like one, a list otherwise. "Wednesday to Friday" is
       * three days; "Tuesday and Thursday" is two.
       */
      const range = days.length === 2 && /\b(to|until|till|through|-|–)\b/.test(l);
      const set = range
        ? Array.from({ length: days[1] - days[0] + 1 }, (_, i) => days[0] + i)
          .filter((d) => d >= 0 && d <= 6)
        : days;
      for (const d of set) {
        availability.set(d, positive ? (half ?? "full") : (half ? oppositeOf(half) : "none"));
      }
      continue;
    }

    if (/\bno\b.*\blong run\b|\bskip(ping)?\b.*\blong run\b|\bwithout\b.*\blong run\b".*/.test(l)
      || /\bno long run\b/.test(l)) {
      intent.no_long_run = true;
      understood += 1;
      continue;
    }

    const kind = kindIn(clause);
    if (kind && /\bskip|drop|miss|not doing|cancel|no\b/.test(l)) {
      understood += 1;
      const day = days[0] ?? dayIn(clause);
      if (day == null) {
        /*
         * A named session with no day. Rather than guess which of two Hyrox sessions they
         * meant, the client asks — one question, never two.
         */
        ambiguities.push({
          quote: clause,
          question: `Which ${kind.replace("_", " ")} did you mean?`,
          options: ["The first one this week", "The second one", "Both"],
        });
        continue;
      }
      actions.push({ day, session_type: kind, action: "skip" });
      continue;
    }

    if (/\bshorter|less|lighter|easier|reduce|cut\b/.test(l)) {
      intent.reduce_volume = true;
      understood += 1;
      continue;
    }
    if (/\bkeep|protect|need|must (do|keep)|do not (drop|move)\b/.test(l) && kind) {
      intent.protect = [...(intent.protect ?? []), kind];
      understood += 1;
    }
  }

  const day_availability: DayAvailability[] = [...availability.entries()]
    .map(([day, available]) => ({ day, available }))
    .sort((a, b) => a.day - b.day);

  return {
    day_availability,
    session_actions: actions,
    week_intent: intent,
    ambiguities: ambiguities.slice(0, 1),
    /*
     * Low confidence is not a veto — everything needs approval anyway. It tells the client
     * to show the diff with more prominence, because a parse that understood one clause out
     * of four is likelier to have missed something than to be wrong about what it caught.
     */
    confidence: understood >= Math.max(1, Math.ceil(clauses.length / 2)) ? "high" : "low",
  };
}

/** "Out Friday morning" leaves the afternoon: an absence names what is gone. */
const oppositeOf = (h: Availability): Availability => (h === "am" ? "pm" : "am");
