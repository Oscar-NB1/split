import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { isUuid, isDateString } from "@/lib/plan";
import { canCoach } from "@/lib/coaching";
import { transcribe, transcriptionConfigured, TranscriptionError } from "@/lib/transcribe";
import { kindFromSport, readLog, suggestionsFor } from "@/lib/session-log";

/**
 * "What did I do today?", answered out loud.
 *
 * Two steps behind one request, because the athlete is standing outside a gym and every extra
 * round trip is a chance to give up: the recording becomes words, the words become a shape. The
 * words are saved either way. A log whose structure failed is still a log — the transcript is
 * the thing that was hard to capture, and a model reading of it can be redone later.
 *
 * Attaches to a planned session, a workout nobody planned, or just a date. All three happen: a
 * Hyrox class that landed on Strava as WeightTraining has an activity and no session, and a
 * class done without a watch has neither.
 */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json();

  const sessionId = typeof body.session_id === "string" ? body.session_id : null;
  const activityId = typeof body.activity_id === "string" ? body.activity_id : null;
  if (sessionId && !isUuid(sessionId)) throw badRequest("Which session?");
  if (activityId && !isUuid(activityId)) throw badRequest("Which workout?");

  /*
   * Whose day this is. A coach writing up an athlete's session is legitimate — the same
   * `canCoach` as everywhere else — and anything else is not.
   */
  let owner = me.id;
  let onDate = isDateString(body.on_date) ? String(body.on_date) : null;
  let sportKind: string | null = null;

  if (sessionId) {
    const [s] = await sql<{ user_id: string; planned_date: string; kind: string }[]>`
      select user_id, planned_date::text as planned_date, kind
        from planned_sessions where id = ${sessionId}
    `;
    if (!s) throw notFound("No such session.");
    owner = s.user_id;
    onDate = onDate ?? s.planned_date;
  }
  if (activityId) {
    const [a] = await sql<{ user_id: string; local_date: string; sport_type: string | null }[]>`
      select user_id, local_date::text as local_date, sport_type
        from activities where id = ${activityId}
    `;
    if (!a) throw notFound("No such workout.");
    owner = a.user_id;
    onDate = onDate ?? a.local_date;
    sportKind = kindFromSport(a.sport_type);
  }
  if (!onDate) throw badRequest("Which day was this?");
  if (owner !== me.id && !(await canCoach(me.id, owner))) {
    throw notFound("That is not yours to write up.");
  }

  /*
   * Spoken or typed. Audio arrives base64 in JSON rather than as multipart: it is one short
   * recording, the body is already JSON, and a second content type here would buy nothing.
   */
  let transcript = typeof body.text === "string" ? body.text.trim() : "";
  let source: "spoken" | "typed" = "typed";

  if (!transcript && typeof body.audio === "string" && body.audio) {
    if (!transcriptionConfigured()) {
      throw badRequest("Recording is not set up yet — type it instead.");
    }
    try {
      const audio = Buffer.from(body.audio, "base64");
      transcript = await transcribe(audio, String(body.mime ?? "audio/webm"));
      source = "spoken";
    } catch (e) {
      /*
       * Named rather than generic. "That did not work" for a recording the athlete cannot
       * replay is the most annoying error in any app; knowing whether it was too long, silent,
       * or the service being down decides what they do next.
       */
      throw badRequest(e instanceof TranscriptionError
        ? `${e.message}. You can type it instead.`
        : "That recording could not be transcribed. You can type it instead.");
    }
  }
  if (!transcript) throw badRequest("Tell me what you did, in a sentence or two.");
  if (transcript.length > 4000) throw badRequest("That is more than a session's worth.");

  /*
   * The session's own prescription as context, where there is one: "we did the intervals but
   * only got through four" resolves against a plan and floats free without one.
   */
  const context = sessionId
    ? await sql<{ title: string; target: string | null }[]>`
        select title, target from planned_sessions where id = ${sessionId}
      `.then(([s]) => (s ? `The session as planned: ${s.title}\n${s.target ?? ""}` : undefined))
    : undefined;

  const structured = await readLog(transcript, context);

  const [row] = await sql<{ id: string }[]>`
    insert into session_log (user_id, session_id, activity_id, on_date, transcript, structured, source)
    values (${owner}, ${sessionId}, ${activityId}, ${onDate}, ${transcript},
            ${sql.json((structured ?? {}) as never)}, ${source})
    returning id
  `;

  return NextResponse.json({
    id: row.id,
    transcript,
    source,
    structured,
    /** things somebody might want to act on — offered, never applied */
    suggestions: suggestionsFor(structured, sportKind),
    /** said plainly, because a log with no structure still has its words */
    read: structured != null,
  });
});

/** Every log for a day, or for one session. */
export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const p = new URL(req.url).searchParams;
  const sessionId = p.get("session");
  const date = p.get("date");
  const athlete = p.get("athlete");

  const owner = athlete && isUuid(athlete) ? athlete : me.id;
  if (owner !== me.id && !(await canCoach(me.id, owner))) throw notFound("Not yours to read.");

  const logs = await sql`
    select id, session_id, activity_id, on_date::text as on_date, transcript, structured,
           source, created_at
      from session_log
     where user_id = ${owner}
       and (${sessionId ?? null}::uuid is null or session_id = ${sessionId ?? null}::uuid)
       and (${date ?? null}::date is null or on_date = ${date ?? null}::date)
     order by created_at desc
     limit 50
  `;
  return NextResponse.json({ logs });
});
