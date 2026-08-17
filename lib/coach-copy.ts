/**
 * What he actually says to her, as the words a notification uses.
 *
 * These were written for the design mockup and never reached the app: fifteen lines in his own
 * voice, sitting in an HTML file, while every notification she would have received said things like
 * "Long run tomorrow · 12 km". Recovered from that file rather than rewritten, because the whole
 * value of them is that they are his and not mine — "I am making dinner after Saturday" is not a
 * line anybody can generate.
 *
 * Two rules that make this safe to point at a push notification:
 *
 *   These are one athlete's, from one person. They are keyed to a coach-athlete pair, and the
 *   default for everybody else is the plain wording. Somebody else's partner calling them
 *   bebezinho is not a warm surprise.
 *
 *   Nothing here decides anything. It is the wording of a notification whose existence and timing
 *   are decided elsewhere, so a missing line means the plain sentence rather than a missing
 *   notification.
 */

/** When a line belongs — matched against the week the notification is about. */
export type Occasion =
  | "base" | "build" | "peak" | "deload" | "taper" | "benchmark" | "race_close";

/**
 * One per occasion, on the week's own terms.
 *
 * `{km}` and `{weeks}` are filled from the week itself. A placeholder with nothing to fill it is
 * dropped along with its line rather than sent with a brace in it.
 */
export const WEEKLY: Record<Occasion, string> = {
  base:
    "Nothing scary this week bebezinho, just us building. I love watching you do this.",
  build:
    "Little bit more this week meu amor. You have got this, and I am making dinner after Saturday.",
  peak:
    "Biggest week yet, {km} km. You are going to finish it, and I will be right there when you do.",
  deload:
    "Easy week amorzinho 🩵 sleep in, take the long way home, no rush anywhere.",
  taper:
    "Almost there my love. Nothing left to do but rest and let me be nervous for both of us.",
  benchmark:
    "Test week bebezinho! Just go have fun with it, I only want to see what you can do so I can "
    + "build you something good.",
  race_close:
    "Only {weeks} weeks till our Hyrox amorzinho — tell me how you feel? I am so excited to do "
    + "this with you.",
};

/**
 * After a session, and not tied to any particular one.
 *
 * Deliberately a pool rather than a rota by session type: the point of these is that they sound
 * like somebody noticing, and a line that always follows the same session stops sounding noticed.
 */
export const AFTER_A_SESSION = [
  "That was a hard session bebezinho, I am so proud of you.",
  "Two down already amorzinho. Come here, you have earned a cuddle.",
  "Weeee another rocycle done! 🎉",
  "Saw your run pop up. Same pace, lower heart rate than last month — you are getting so strong.",
  "Tired is allowed my love. Doubting yourself is not, because you are doing amazing.",
  "Three weeks, not one session skipped. Who even are you?! 🩵",
  "You looked so happy after Saturday. That is why we are doing this ❤️",
  "Watching you train this year has been my favourite thing. Just so you know.",
] as const;

/** Which occasion a week is, from the week itself rather than from a guess. */
export function occasionOf(w: {
  phase?: string; deload?: boolean; taper?: boolean; benchmark?: boolean;
  km?: number; peak?: boolean;
}, weeksToRace?: number | null): Occasion {
  if (weeksToRace != null && weeksToRace <= 3) return "race_close";
  if (w.benchmark) return "benchmark";
  if (w.taper) return "taper";
  if (w.deload) return "deload";
  if (w.peak) return "peak";
  return w.phase === "base" ? "base" : "build";
}

/**
 * The line, with its placeholders filled — or null.
 *
 * Null rather than a line with an empty brace in it: "Biggest week yet, {km} km" sent as written is
 * worse than the plain notification it would have replaced.
 */
export function weeklyLine(
  occasion: Occasion, fill: { km?: number | null; weeks?: number | null } = {},
): string | null {
  const raw = WEEKLY[occasion];
  if (!raw) return null;
  const out = raw
    .replace("{km}", fill.km != null ? String(Math.round(fill.km)) : "{km}")
    .replace("{weeks}", fill.weeks != null ? String(fill.weeks) : "{weeks}");
  return /[{}]/.test(out) ? null : out;
}

/**
 * One of the after-a-session lines, picked so it does not repeat until the pool is used up.
 *
 * `seen` is how many she has already had — a count the caller holds, so the choice is reproducible
 * and testable rather than random. Random would have sent the same line twice in a week often
 * enough to be noticed, and being noticed is the one thing this cannot survive.
 */
export const afterLine = (seen: number): string =>
  AFTER_A_SESSION[Math.abs(seen) % AFTER_A_SESSION.length];
