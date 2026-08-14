import { sql } from "./db";
import { today } from "./dates";

/**
 * Minimal iCalendar reader. Runna publishes a subscribable feed URL; we poll
 * it and mirror future events into planned_sessions. No dependency, because
 * we need exactly four fields and ics parsers are heavier than the problem.
 */
type VEvent = { uid: string; date: string; summary: string; description: string };

export function parseIcs(text: string): VEvent[] {
  // unfold: continuation lines start with a space or tab. Matching \r?\n and
  // not just \r\n, because feeds served with bare LF folded long SUMMARY
  // lines into the middle of the title.
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: VEvent[] = [];
  let cur: Partial<VEvent> | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) { cur = {}; continue; }
    if (line.startsWith("END:VEVENT")) {
      if (cur?.uid && cur.date) {
        out.push({
          uid: cur.uid, date: cur.date,
          summary: cur.summary ?? "Session", description: cur.description ?? "",
        });
      }
      cur = null; continue;
    }
    if (!cur) continue;

    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i);
    const val = line.slice(i + 1)
      .replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";");

    if (key === "UID") cur.uid = val;
    else if (key.startsWith("DTSTART")) cur.date = val.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    else if (key === "SUMMARY") cur.summary = val;
    else if (key === "DESCRIPTION") cur.description = val;
  }
  return out;
}

/** Guess our session kind from a Runna workout title. */
export function kindFromTitle(t: string): string {
  const s = t.toLowerCase();
  if (/long/.test(s)) return "run_long";
  if (/interval|speed|tempo|threshold|rep|fartlek|hill/.test(s)) return "run_intervals";
  if (/strength|core|gym/.test(s)) return "strength";
  if (/rest/.test(s)) return "rest";
  return "run_easy";
}

/** Rough duration from the title, e.g. "45 min easy run" or "12km long run". */
export function minutesFromText(t: string): number | null {
  const min = t.match(/(\d+)\s*(?:min|minute)/i);
  if (min) return parseInt(min[1], 10);
  const km = t.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (km) return Math.round(parseFloat(km[1]) * 6); // ~6 min/km placeholder
  return null;
}

/**
 * Mirrors the feed into planned_sessions for today onwards.
 * Past sessions are never touched - history is frozen.
 * Sessions the athlete has already moved or completed are left alone.
 */
export async function syncRunna(userId: string, feedUrl: string) {
  const res = await fetch(feedUrl, { headers: { "user-agent": "split/0.1" } });
  if (!res.ok) throw new Error(`runna feed: ${res.status}`);

  // the athlete's today, not UTC's: before 02:00 in Berlin those differ, and
  // yesterday's session would come back as a future one
  const from = today();
  const events = parseIcs(await res.text()).filter((e) => e.date >= from);
  let written = 0;

  for (const e of events) {
    const kind = kindFromTitle(e.summary);
    if (kind === "rest") continue;

    await sql`
      insert into planned_sessions
        (user_id, author_id, planned_date, title, kind, planned_minutes, target, source, source_ref)
      values
        (${userId}, ${userId}, ${e.date}, ${e.summary}, ${kind},
         ${minutesFromText(e.summary + " " + e.description)},
         ${e.description.slice(0, 500) || null}, 'runna', ${e.uid})
      on conflict (user_id, source_ref) where source = 'runna'
      do update set
        planned_date    = case when planned_sessions.status = 'planned'
                            then excluded.planned_date else planned_sessions.planned_date end,
        title           = excluded.title,
        target          = excluded.target,
        planned_minutes = excluded.planned_minutes,
        updated_at      = now()
      where planned_sessions.status = 'planned'
        -- only when something actually differs. Touching updated_at on every
        -- poll made the watch push think every session had changed, and it
        -- rewrote the whole week's workouts once an hour, forever.
        and (planned_sessions.title, planned_sessions.target,
             planned_sessions.planned_minutes, planned_sessions.planned_date)
            is distinct from
            (excluded.title, excluded.target,
             excluded.planned_minutes, excluded.planned_date)
    `;
    written++;
  }
  return written;
}
