/**
 * Calendar dates, not instants.
 *
 * A training day is a date in the athlete's own timezone: Tuesday's intervals
 * are Tuesday's whether you look at them from Berlin or Boulder. Every date in
 * this app is therefore a plain 'YYYY-MM-DD' string, and all arithmetic happens
 * on it directly.
 *
 * Two rules make that safe, and both were broken before:
 *
 *   1. Never `toISOString().slice(0,10)` on a local-midnight Date. In any
 *      timezone east of UTC that yields the PREVIOUS day, which silently moved
 *      every materialised session and every week boundary back by one.
 *   2. Never divide a millisecond difference by 864e5 to count days or weeks.
 *      DST weekends are 23 or 25 hours long, so a week is 0.994 weeks and
 *      Math.floor turns week 4 into week 3 twice a year.
 *
 * Internally a date is anchored at 12:00 UTC. Noon is far enough from both
 * midnights that no real timezone offset can push it onto a neighbouring day.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Which timezone "today" means.
 *
 * The browser knows the athlete's zone, but the server does not: Vercel runs
 * Node with TZ=UTC, so a server that trusted its own clock still thought it was
 * yesterday between midnight and 02:00 in Berlin - the same off-by-a-day, one
 * layer down. Set NEXT_PUBLIC_APP_TIMEZONE to the household's zone (it has to
 * be NEXT_PUBLIC_ so both sides read the same value). Unset falls back to
 * whatever the runtime thinks, which is right in a browser and UTC on Vercel.
 */
const ZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() || undefined;

/**
 * Built once, and never allowed to throw.
 *
 * Intl throws RangeError on an unknown zone ("Berlin", "GMT+2", a typo), and
 * this is the one variable SETUP.md asks someone to hand-type. Throwing from
 * iso() would take down /api/week, the cron and the calendar's first render
 * together, so a bad value degrades to the runtime's own zone and says so.
 */
const formatter = (() => {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "2-digit", day: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: ZONE });
  } catch {
    console.error(
      `NEXT_PUBLIC_APP_TIMEZONE="${ZONE}" is not a timezone. Falling back to the ` +
        `system zone; dates will be wrong for the two hours after local midnight. ` +
        `Use an IANA name like Europe/Berlin.`,
    );
    return new Intl.DateTimeFormat("en-CA", opts);
  }
})();

/** The calendar date an instant falls on, in the athlete's timezone. */
export function iso(d: Date = new Date()): string {
  return formatter.format(d); // en-CA formats as YYYY-MM-DD
}

/** Today, locally. */
export const today = () => iso();

/** A date's noon-UTC anchor. Use for formatting (pass timeZone:'UTC') only. */
export function at(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function isoUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** n days after `date` (negative goes back). DST-proof. */
export function addDays(date: string, n: number): string {
  const x = at(date);
  x.setUTCDate(x.getUTCDate() + n);
  return isoUTC(x);
}

/** Whole days from b to a. diffDays('2026-08-15','2026-08-14') === 1. */
export function diffDays(a: string, b: string): number {
  return Math.round((at(a).getTime() - at(b).getTime()) / 864e5);
}

/** Day of week with 0 = Monday, matching TemplateDay.day. */
export function dow(date: string): number {
  return (at(date).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: string = today()): string {
  return addDays(date, -dow(date));
}

/** Whole weeks from Monday b to Monday a. Counts days, so DST can't shift it. */
export function diffWeeks(a: string, b: string): number {
  return Math.floor(diffDays(a, b) / 7);
}

/** Formats a date for display without ever leaving the intended day. */
export function fmt(date: string, opts: Intl.DateTimeFormatOptions, locale = "en-GB") {
  return at(date).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });
}
