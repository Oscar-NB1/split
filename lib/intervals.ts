import { sql } from "./db";
import { isRunnable } from "./session-kinds";

/**
 * intervals.icu bridge - this is how a programmed session reaches the watch.
 *
 * Garmin's own Training API is business-only, so we write the workout to
 * intervals.icu and let its Garmin integration push it into Garmin Connect,
 * where it syncs to the device.
 *
 * One-time setup per athlete (in intervals.icu, not here):
 *   Settings -> Developer -> copy API key
 *   Settings -> Connections -> Garmin -> tick "Upload planned workouts"
 *
 * Every session we have sent keeps its intervals.icu event id, because this
 * runs from an hourly cron. Without that id each pass created a fresh event:
 * one planned run became 24 identical workouts on the watch per day.
 */
const BASE = "https://intervals.icu/api/v1";

const auth = (key: string) =>
  "Basic " + Buffer.from(`API_KEY:${key}`).toString("base64");

type Creds = { athleteId: string; apiKey: string };

async function credsFor(userId: string): Promise<Creds | null> {
  const rows = await sql<{ provider_user_id: string; access_token: string }[]>`
    select provider_user_id, access_token from oauth_accounts
    where user_id = ${userId} and provider = 'intervals'
  `;
  if (!rows[0]) return null;
  return { athleteId: rows[0].provider_user_id, apiKey: rows[0].access_token };
}

/**
 * Is this session's `target` workout structure, or prose?
 *
 * Everything we programme writes `target` as hand-written structure — '10x400m
 * @ 3:55, walk 90s' as much as a dash-prefixed step list — so it goes to the
 * watch verbatim.
 */
export const targetIsStructure = (_source: string) => true;

/**
 * Renders a session into intervals.icu workout syntax.
 * Rest steps are written as time or distance on purpose: rest-to-heart-rate
 * degrades to a plain timer once it reaches a Garmin watch, so writing it
 * that way here keeps what you see equal to what she runs.
 */
export function toWorkoutText(kind: string, minutes: number, target?: string) {
  if (target?.trim()) return target; // hand-written structure wins
  switch (kind) {
    case "run_intervals":
      return ["- 10m Z2 warm up", "- 8x", "- 3m Z4", "- 2m Z2", "- 10m Z1 cool down"].join("\n");
    default:
      return `- ${minutes}m Z2`;
  }
}

/**
 * The same, for a session whose real structure we don't have - an interval
 * day, where the plan lives in prose we can't parse.
 *
 * It deliberately does NOT fall through to the canned rep ladder above. Sending
 * 8x3min Z4 for a session that says "8 x 400m off 90s" is not a rough guess,
 * it's a different session: three times the Z4 volume, at an intensity nobody
 * prescribed. A plain aerobic block plus the prose underneath is honest - she
 * reads the description and runs the reps.
 */
function summaryWorkoutText(minutes: number) {
  return `- ${minutes}m Z2`;
}

/** The body intervals.icu wants for one planned session. Pure, so it's testable. */
export function eventBody(s: {
  id: string; planned_date: string; title: string; kind: string;
  planned_minutes: number | null; target: string | null; coach_note: string | null;
  source: string;
}) {
  const minutes = s.planned_minutes ?? 45;
  const structure = targetIsStructure(s.source) ? s.target?.trim() || undefined : undefined;
  const prosed = !structure && !!s.target?.trim();
  const structured = prosed
    ? summaryWorkoutText(minutes)
    : toWorkoutText(s.kind, minutes, structure);
  // anything not used as structure still belongs on the watch, as text
  const prose = [structure ? null : s.target, s.coach_note].filter(Boolean).join("\n");

  return {
    start_date_local: `${s.planned_date}T06:00:00`,
    category: "WORKOUT",
    type: "Run",
    name: s.title,
    description: prose ? `${structured}\n\n${prose}` : structured,
    external_id: `split-${s.id}`,
  };
}

type Row = {
  id: string; user_id: string; planned_date: string; title: string;
  kind: string; planned_minutes: number | null; target: string | null;
  coach_note: string | null; status: string; source: string;
  intervals_event_id: string | null;
};

const load = (sessionId: string) => sql<Row[]>`
  select id, user_id, planned_date::text as planned_date, title, kind,
         planned_minutes, target, coach_note, status, source, intervals_event_id
  from planned_sessions where id = ${sessionId}
`;

/**
 * Push one planned session: creates the event the first time, updates it on
 * every later call. Returns the intervals.icu event id, or null.
 */
export async function pushSession(sessionId: string): Promise<string | null> {
  const [s] = await load(sessionId);
  if (!s) return null;
  if (!isRunnable(s.kind)) return null; // only structured runs reach the watch

  // a session that is no longer on the plan should come off the watch instead
  if (s.status === "skipped" || s.status === "moved") return removeSession(sessionId);
  if (s.status !== "planned") return s.intervals_event_id; // already done: leave it alone

  const creds = await credsFor(s.user_id);
  if (!creds) return null;

  const body = JSON.stringify(eventBody(s));
  const headers = { authorization: auth(creds.apiKey), "content-type": "application/json" };

  if (s.intervals_event_id) {
    const res = await fetch(
      `${BASE}/athlete/${creds.athleteId}/events/${s.intervals_event_id}`,
      { method: "PUT", headers, body },
    );
    if (res.ok) {
      await markPushed(sessionId, s.intervals_event_id);
      return s.intervals_event_id;
    }
    if (res.status !== 404) {
      console.error("intervals update failed", res.status, await res.text());
      return null;
    }
    // 404: it was deleted inside intervals.icu. Fall through and create a new one.
  }

  const res = await fetch(`${BASE}/athlete/${creds.athleteId}/events`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    console.error("intervals push failed", res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as { id?: number };
  const eventId = json.id ? String(json.id) : null;
  if (eventId) await markPushed(sessionId, eventId);
  return eventId;
}

/** Take a session off the watch - a skip should not leave a workout behind. */
export async function removeSession(sessionId: string): Promise<null> {
  const [s] = await load(sessionId);
  if (!s?.intervals_event_id) return null;

  const creds = await credsFor(s.user_id);
  if (!creds) return null;

  const res = await fetch(
    `${BASE}/athlete/${creds.athleteId}/events/${s.intervals_event_id}`,
    { method: "DELETE", headers: { authorization: auth(creds.apiKey) } },
  ).catch((e) => {
    console.error("intervals delete failed", e);
    return null;
  });

  // keep the id unless it is really gone: clearing it after a failed delete
  // orphans the workout on the watch with nothing left to retry with
  if (!res || !(res.ok || res.status === 404)) {
    console.error("intervals delete failed", res?.status);
    return null;
  }

  await sql`
    update planned_sessions
    set intervals_event_id = null, intervals_pushed_at = null
    where id = ${sessionId}
  `;
  return null;
}

/**
 * Records what we sent. Deliberately does not touch updated_at: the gap
 * between updated_at and intervals_pushed_at is what tells us a session has
 * changed since its last push.
 */
async function markPushed(sessionId: string, eventId: string) {
  await sql`
    update planned_sessions
    set intervals_event_id = ${eventId}, intervals_pushed_at = now()
    where id = ${sessionId}
  `;
}

/**
 * Push everything planned in the next 10 days that has changed since it last
 * went. Safe to run hourly: an unchanged week costs zero requests.
 */
export async function pushUpcoming(userId: string) {
  const rows = await sql<{ id: string }[]>`
    select id from planned_sessions
    where user_id = ${userId}
      and status = 'planned'
      and planned_date between current_date and current_date + 10
      and kind like 'run%'
      and (intervals_pushed_at is null or intervals_pushed_at < updated_at)
  `;
  let n = 0;
  for (const r of rows) if (await pushSession(r.id)) n++;
  return n;
}

/** Is this athlete connected to intervals.icu at all? */
export const intervalsConnected = async (userId: string) => (await credsFor(userId)) !== null;

/**
 * Push the race plan as a single dated workout.
 *
 * Kept separate from pushSession because a race plan is not a planned_session —
 * it is one event per race, stored in race_plans, and re-exporting must update
 * the same event rather than leave a second copy of the race on the watch.
 *
 * Throws rather than returning null on a missing connection: the caller is a
 * button the athlete just pressed, and "Sent to Garmin" when nothing was sent is
 * the failure this whole path exists to remove.
 */
export async function pushRacePlan(
  userId: string,
  race: { date: string; name: string; body: string; eventId: string | null },
): Promise<string> {
  const creds = await credsFor(userId);
  if (!creds) throw new Error("intervals.icu is not connected");

  const headers = { authorization: auth(creds.apiKey), "content-type": "application/json" };
  const body = JSON.stringify({
    start_date_local: `${race.date}T09:00:00`,
    category: "WORKOUT",
    type: "Other",
    name: race.name,
    description: race.body,
    external_id: `split-race-${race.date}`,
  });

  if (race.eventId) {
    const res = await fetch(`${BASE}/athlete/${creds.athleteId}/events/${race.eventId}`,
      { method: "PUT", headers, body });
    if (res.ok) return race.eventId;
    // 404 means it was deleted inside intervals.icu; anything else is a real failure
    if (res.status !== 404) throw new Error(`intervals.icu refused the update (${res.status})`);
  }

  const res = await fetch(`${BASE}/athlete/${creds.athleteId}/events`,
    { method: "POST", headers, body });
  if (!res.ok) throw new Error(`intervals.icu refused the workout (${res.status})`);
  const json = (await res.json()) as { id?: number };
  if (!json.id) throw new Error("intervals.icu accepted the workout but returned no id");
  return String(json.id);
}

/**
 * Does this athlete id and key actually work?
 *
 * Checked before storing them, because the alternative is what this replaces:
 * the key was saved unverified, the push that followed was wrapped in
 * `.catch(() => 0)`, and the screen reported "connected" for a mistyped key. The
 * athlete then has a connection that shows green and will never deliver a
 * workout, which is harder to diagnose than a refused paste.
 */
/**
 * The athlete id, from the key alone.
 *
 * Every path in this API is `/athlete/{id}/…`, so the id is genuinely needed — but nobody should
 * have to go hunting for it in a URL. `0` is the API's own shorthand for "whoever this key
 * belongs to", so one call resolves it, and the id it reports back is the one every later request
 * uses.
 *
 * Returns null rather than throwing when the shorthand is not accepted. Then the form asks for
 * the id, which is where this started — a lookup that fails should cost a question, not a
 * connection.
 */
export async function resolveAthleteId(apiKey: string): Promise<string | null> {
  for (const who of ["0", "me"]) {
    try {
      const res = await fetch(`${BASE}/athlete/${who}`, {
        headers: { authorization: auth(apiKey) },
      });
      if (!res.ok) continue;
      const body = await res.json() as { id?: unknown; athlete?: { id?: unknown } };
      const id = body?.id ?? body?.athlete?.id;
      /* Only an id that looks like one: the shorthand echoed back is not an answer. */
      if (typeof id === "string" && /^i?\d+$/.test(id) && id !== who) {
        return id.startsWith("i") ? id : `i${id}`;
      }
      if (typeof id === "number" && Number.isFinite(id)) return `i${id}`;
    } catch {
      /* Network trouble is the caller's problem to report, not this function's to guess at. */
      return null;
    }
  }
  return null;
}

export async function verifyIntervals(
  athleteId: string, apiKey: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/athlete/${athleteId}`, { headers: { authorization: auth(apiKey) } });
  } catch {
    return { ok: false, why: "Could not reach intervals.icu. Worth trying again in a moment." };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, why: "intervals.icu rejected that API key. Copy it again from Settings → Developer." };
  }
  if (res.status === 404) {
    return { ok: false, why: `intervals.icu has no athlete "${athleteId}". The id looks like i12345.` };
  }
  return { ok: false, why: `intervals.icu answered ${res.status}. Nothing was saved.` };
}
