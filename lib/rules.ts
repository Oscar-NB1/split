import { sql } from "./db";
import { addDays, diffDays, fmt, mondayOf, today } from "./dates";
import { notify, partnerOf, queue } from "./notify";
import { occasionOf, weeklyLine } from "./coach-copy";
import { describe, recordValue, recordsFor, type NewRecord } from "./records";
import { weekStart } from "./scoring";

/**
 * What is worth interrupting someone for.
 *
 * Two sources. Event rules fire the moment something happens — an activity
 * lands, a session is skipped, a message is written. Scheduled rules run from
 * the hourly cron and look forward. Both go through notify/queue, so both are
 * de-duplicated and both respect quiet hours.
 *
 * The bar: a training app that notifies too much gets its notifications turned
 * off inside a week, and then the one message that mattered never arrives.
 */

const mins = (n: number) => `${Math.round(n)} min`;

// ------------------------------------------------------------------- events

/**
 * An activity arrived from Strava.
 *
 * `announce` is false when this runs over imported history: every activity in a
 * backfill is a personal best at the moment it lands.
 */
export async function onActivity(userId: string, activityId: string, announce: boolean) {
  const records = await recordsFor(userId, activityId);
  if (!announce) return;

  const [me] = await sql<{ display_name: string }[]>`
    select display_name from users where id = ${userId}
  `;
  const partner = await partnerOf(userId);

  const [a] = await sql<{
    name: string | null; moving_seconds: number | null; distance_m: string | null;
  }[]>`select name, moving_seconds, distance_m from activities where id = ${activityId}`;
  if (!a) return;

  const [session] = await sql<{
    id: string; title: string; planned_minutes: number | null; status: string;
  }[]>`
    select id, title, planned_minutes, status from planned_sessions where activity_id = ${activityId}
  `;

  const minutes = Math.round((a.moving_seconds ?? 0) / 60);
  const km = Number(a.distance_m ?? 0) / 1000;
  const distance = km >= 1 ? `, ${km.toFixed(1)} km` : "";

  if (partner) {
    await notify(partner.id, "partner_trained", `activity:${activityId}`, {
      title: `${me?.display_name ?? "They"} trained`,
      body: session
        ? `${session.title} — ${mins(minutes)}${distance}${session.status === "adjusted" ? ", short of plan" : ""}`
        : `${a.name ?? "Activity"} — ${mins(minutes)}${distance}. Nothing planned for it.`,
      url: "/",
    });
  }

  // The useful half of "you did a workout" is not news that you ran — it is
  // confirmation that it synced and paired with the right session.
  if (session) {
    await notify(userId, "session_paired", `paired:${session.id}`, {
      title: session.status === "adjusted" ? "Logged, short of plan" : "Session logged",
      body: session.planned_minutes
        ? `${session.title}: ${mins(minutes)} against ${mins(session.planned_minutes)} planned.`
        : `${session.title}: ${mins(minutes)}.`,
      url: "/",
    });
  }

  await announceRecords(userId, me?.display_name ?? "They", records);
}

/** Records go to whoever set them, and to the person they are racing. */
async function announceRecords(userId: string, name: string, records: NewRecord[]) {
  if (records.length === 0) return;
  const partner = await partnerOf(userId);
  for (const r of records) {
    // a first-ever record is noise on an empty database; only improvements are news
    if (r.previous === null) continue;
    const line = describe(r);
    const key = `record:${userId}:${r.metric}:${Math.round(r.value)}`;
    await notify(userId, "record", key, { title: "New personal best", body: line, url: "/" });
    if (partner) {
      await notify(partner.id, "record", key, {
        title: `${name} set a personal best`, body: line, url: "/",
      });
    }
  }
}

/**
 * How many sessions in a row, working back from today, were skipped.
 * A completed or adjusted session stops the count; one still `planned` in the
 * past is not yet judged and is stepped over — the same rule the streak uses.
 */
export function countLeadingSkips(rows: { status: string }[]): number {
  let n = 0;
  for (const r of rows) {
    if (r.status === "skipped") n++;
    else if (r.status === "done" || r.status === "adjusted") break;
  }
  return n;
}

/** Two in a row is the moment a coach wants to know — before it is three. */
export async function onSkip(userId: string) {
  const rows = await sql<{ status: string }[]>`
    select status from planned_sessions
     where user_id = ${userId} and kind <> 'rest' and status <> 'moved'
       and planned_date <= current_date
     order by planned_date desc, created_at desc limit 10
  `;
  const skips = countLeadingSkips(rows);
  if (skips < 2) return;

  const partner = await partnerOf(userId);
  if (!partner) return;
  const [me] = await sql<{ display_name: string }[]>`
    select display_name from users where id = ${userId}
  `;
  // keyed on the count, so three says so again and a fourth does not
  await notify(partner.id, "missed", `missed:${userId}:${skips}:${today()}`, {
    title: `${me?.display_name ?? "They"} has missed ${skips} in a row`,
    body: skips === 2
      ? "Two consecutive sessions. If both were fatigue, next week's volume comes down automatically."
      : `${skips} consecutive sessions. Worth a conversation rather than a plan change.`,
    url: "/",
  });
}

/** Someone wrote on a session. Tell the other one. */
export async function notifyComment(sessionId: string, authorId: string, body: string) {
  const [s] = await sql<{ user_id: string; title: string }[]>`
    select user_id, title from planned_sessions where id = ${sessionId}
  `;
  if (!s) return;
  const [author] = await sql<{ display_name: string }[]>`
    select display_name from users where id = ${authorId}
  `;
  // to the session's owner if someone else wrote it, else to the partner
  const target = s.user_id !== authorId ? s.user_id : (await partnerOf(authorId))?.id;
  if (!target) return;

  await notify(target, "comment", `comment:${sessionId}:${Date.now()}`, {
    title: `${author?.display_name ?? "They"} on ${s.title}`,
    body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
    url: "/",
  });
}

// ---------------------------------------------------------------- scheduled

/*
 * Days worth a reminder the night before. "hard" is in here alongside "key":
 * a Hyrox session does not drive what the plan prescribes next, but it is still
 * a day you want to arrive fresh for, and that is what this list is for.
 */
const NOTABLE = ["key", "hard", "benchmark", "race"];

/**
 * Everything the cron looks forward at. Idempotent by construction: every
 * dedupe key is built from the thing announced, not the moment of noticing.
 */
export async function scheduled(now = new Date()) {
  await tomorrowsSession();
  await raceCountdown();
  if (now.getDay() === 0) await weeklyRoundUp(); // Sunday: what was run
  if (now.getDay() === 1) await weekAhead();     // Monday: what is coming
}

/**
 * Monday morning: what this week is, and what it is for.
 *
 * The Sunday round-up looks back at what was run. This looks forward, which is the half that was
 * missing — and it is where his own lines belong: "Biggest week yet, {km} km. You are going to
 * finish it, and I will be right there when you do" is a Monday sentence, not a Sunday one.
 *
 * The plain version says the same thing in the app's voice, because a week ahead is worth telling
 * anybody about and only one athlete has somebody writing for her.
 */
async function weekAhead() {
  const ws = weekStart();
  const rows = await sql<{
    id: string; volume: { n: number; km: number; note: string; phase: string;
      class_km?: number }[] | null;
    start_date: string; race_date: string | null;
  }[]>`
    select u.id, t.volume, t.start_date::text as start_date, t.race_date::text as race_date
      from users u
      join plan_templates t on t.athlete_id = u.id and t.active
  `;

  for (const r of rows) {
    const volume = Array.isArray(r.volume) ? r.volume : [];
    if (volume.length === 0) continue;
    /* Which week of the block this Monday is. Derived from the start date, never stored. */
    const n = Math.floor(diffDays(ws, mondayOf(r.start_date)) / 7) + 1;
    const w = volume[n - 1];
    if (!w) continue; // before the block, or past the end of it

    const peak = Math.max(...volume.map((x) => x.km));
    const weeksToRace = r.race_date
      ? Math.max(0, Math.round(diffDays(r.race_date, ws) / 7))
      : null;
    const occasion = occasionOf({
      phase: w.phase,
      deload: /down/i.test(w.note ?? ""),
      taper: /taper|race week/i.test(w.note ?? "") || w.phase === "taper",
      benchmark: /benchmark|test/i.test(w.note ?? ""),
      peak: w.km === peak,
    }, weeksToRace);

    const voice = await voiceFor(r.id);
    const line = voice ? weeklyLine(occasion, { km: w.km, weeks: weeksToRace }) : null;
    const classes = w.class_km ? ` (+${w.class_km} in the classes)` : "";

    await queue(r.id, "weekly", `ahead:${ws}:${r.id}`, {
      title: line ? `Week ${n}` : `Week ${n} · ${w.km} km`,
      /*
       * His line where there is one, and the numbers either way. A sentence without the week's
       * kilometres in it is lovely and tells her nothing she can plan around.
       */
      body: line ? `${line}\n${w.km} km${classes}` : `${w.km} km${classes}. ${w.note || ""}`.trim(),
      url: "/",
    });
  }
}

/**
 * Whether this athlete has somebody's own words to be spoken in.
 *
 * A single flag rather than a copy of the lines: the words live in lib/coach-copy, and this only
 * answers whether to use them. Set per athlete, so the default everywhere else is the plain
 * wording.
 */
async function voiceFor(userId: string): Promise<boolean> {
  const rows = await sql<{ on: boolean }[]>`
    select coalesce(coach_voice, false) as on from users where id = ${userId}
  `;
  return rows[0]?.on ?? false;
}

/** A benchmark, race session or long run tomorrow: say so tonight. */
async function tomorrowsSession() {
  const date = addDays(today(), 1);
  const rows = await sql<{
    id: string; user_id: string; title: string; planned_minutes: number | null;
    coach_note: string | null; significance: string | null;
  }[]>`
    select id, user_id, title, planned_minutes, coach_note, significance
      from planned_sessions
     where planned_date = ${date} and status = 'planned'
       and (significance = any(${NOTABLE}) or (kind = 'run_long' and planned_minutes >= 90))
  `;
  for (const s of rows) {
    // the first line of the coach note is the guardrail, and carrying it is the
    // whole reason for telling someone the night before
    const note = s.coach_note?.split("\n").filter(Boolean)[0];

    /*
     * In his own words where there are any for her.
     *
     * He wrote fifteen lines for her and they sat in a design file while the app sent "Tomorrow's
     * session · Long run · 65 min". The plain version is still the fallback and still the default
     * for everybody else — somebody else's partner calling them bebezinho is not a warm surprise —
     * but where a voice exists, it is the one that goes out.
     *
     * The prescription is not replaced by it. "3 × 8 min at 4:35" is the thing she needs to read;
     * the line is what makes her want to.
     */
    const voice = await voiceFor(s.user_id);
    await queue(s.user_id, "upcoming", `upcoming:${s.id}`, {
      title: voice
        ? (s.significance === "benchmark" ? "Test day tomorrow bebezinho"
          : s.significance === "race" ? "Race day tomorrow amorzinho"
          : "Tomorrow, my love")
        : (s.significance === "benchmark" ? "Benchmark tomorrow"
          : s.significance === "race" ? "Race tomorrow" : "Tomorrow's session"),
      body: [s.title, s.planned_minutes ? mins(s.planned_minutes) : null, note]
        .filter(Boolean).join(" · "),
      url: "/",
    });
  }
}

/** The countdown, at the points where behaviour should actually change. */
const MARKS: Record<number, { title: string; body: string }> = {
  28: { title: "Four weeks out", body: "Peak block. Everything from here sharpens rather than builds." },
  14: { title: "Two weeks out", body: "Taper starts. The volume drop is the training now — protecting it is the work." },
  7: { title: "Race week", body: "Nothing you do this week makes you fitter. It can still make you slower." },
  1: { title: "Tomorrow", body: "Run 1 under 172. You may not lead runs 1–4 — agreed in advance, in writing." },
};

async function raceCountdown() {
  const rows = await sql<{ user_id: string; planned_date: string }[]>`
    select user_id, planned_date::text as planned_date from planned_sessions
     where significance = 'race' and planned_date >= current_date
  `;
  for (const r of rows) {
    // days REMAINING: diffDays is a - b, so the race date comes first
    const days = diffDays(r.planned_date, today());
    const mark = MARKS[days];
    if (!mark) continue;
    await queue(r.user_id, "race", `race:${r.planned_date}:${days}`, {
      title: `${mark.title} — ${fmt(r.planned_date, { day: "numeric", month: "long" })}`,
      body: mark.body,
      url: "/",
    });
  }
}

/** Sunday night: the week's running, and whether it was anyone's biggest. */
async function weeklyRoundUp() {
  const ws = weekStart();
  const users = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users order by created_at
  `;
  for (const u of users) {
    const [row] = await sql<{ km: string | null }[]>`
      select round((sum(distance_m) / 1000.0)::numeric, 1) as km from activities
       where user_id = ${u.id} and local_date >= ${ws} and local_date < ${addDays(ws, 7)}
         and sport_type ilike '%run%'
    `;
    const km = Number(row?.km ?? 0);
    if (km <= 0) continue;
    const record = await recordValue(u.id, "biggest_week_km", km, today());
    await queue(u.id, "weekly", `weekly:${ws}:${u.id}`, {
      title: record ? "Biggest week yet" : "Week done",
      body: record ? describe(record) : `${km.toFixed(0)} km of running this week.`,
      url: "/",
    });
  }
}
