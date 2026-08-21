import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { isDateString } from "@/lib/plan";
import { prescribedKm } from "@/lib/prescription";
import { today } from "@/lib/dates";
import { parseWeekWith } from "@/lib/plan/parse-week-llm";
import { rebuildWeek, type WeekSession } from "@/lib/plan/rebuild";

/**
 * Rebuilding one week around a sentence.
 *
 * The division that keeps this safe: the parser reads the sentence, the generator rebuilds
 * the week, and this route only carries things between them. Nothing here edits a session —
 * if the generator cannot produce a legal week it returns the failure and so does this,
 * rather than patching one together.
 *
 * Two calls: POST proposes, POST /apply commits. Nothing is written until the athlete has
 * seen what it costs.
 */

type Ctx = { params: Promise<{ monday: string }> };

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function weekOf(userId: string, monday: string) {
  const rows = await sql<{
    id: string; planned_date: string; kind: string; title: string;
    purpose: string | null; target: string | null; slot: string | null;
    significance: string | null; status: string; activity_id: string | null;
  }[]>`
    select id, planned_date::text as planned_date, kind, title, purpose, target, slot,
           significance, status, activity_id
      from planned_sessions
     where user_id = ${userId}
       and planned_date >= ${monday}::date and planned_date < ${monday}::date + 7
     order by planned_date, slot nulls first
  `;
  const dayOf = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  /*
   * Distance from the prescription, through the app's own reader.
   *
   * A local regex for "Xkm" summed only the steps written in kilometres, so his 8 km threshold
   * session — a warm-up and a cool-down in km with 3 × 8 min of work between them — came back
   * as 2.8 km. Every number in a rebuild preview is computed from this, so the summary told him
   * a week was thirty kilometres when it was thirty-eight, and the sentence about what a
   * rebuild costs was the least trustworthy thing on the screen.
   */
  const km = (t: string | null) => prescribedKm(t);
  return rows.map((r): WeekSession & { date: string; title: string } => ({
    id: r.id,
    date: r.planned_date,
    day: dayOf(r.planned_date),
    kind: r.kind,
    label: r.purpose || r.title,
    title: r.title,
    km: km(r.target),
    slot: r.slot === "PM" ? "PM" : r.slot === "AM" ? "AM" : null,
    hard: r.significance === "key" || r.significance === "hard" || r.kind === "hyrox",
    /*
     * A logged day is untouchable, and this is where "logged" is decided: anything with an
     * activity against it, or marked done or skipped, has already happened.
     */
    logged: Boolean(r.activity_id) || ["done", "adjusted", "skipped"].includes(r.status),
  }));
}

export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireUser();
  const { monday } = await ctx.params;
  if (!isDateString(monday)) throw badRequest("Which week? Send the Monday as YYYY-MM-DD.");

  /*
   * Not the past, and not further out than the week in front of you.
   *
   * History is immutable, and a rebuild is for the week you are in — planning around a
   * holiday belongs in absences, where it reshapes the block rather than one week of it.
   */
  if (monday < today().slice(0, 10)) {
    const end = new Date(`${monday}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    if (end.toISOString().slice(0, 10) <= today()) {
      throw badRequest("That week is behind you. History does not get rewritten.");
    }
  }

  const body = await req.json();
  const raw = String(body?.raw_text ?? "").trim();
  if (raw.length < 3) throw badRequest("Tell me what changed, in a sentence.");
  if (raw.length > 1000) throw badRequest("A sentence or three is plenty.");

  /*
   * Rebuilt as often as the week needs it.
   *
   * This used to stop at two, on the reasoning that a third rebuild is a conversation about
   * the block rather than the week. In practice a week goes wrong more than twice — illness
   * then a moved class then a late finish — and the cap landed on exactly the weeks that
   * needed the most help, leaving the athlete to move sessions by hand. Every rebuild is
   * still recorded in `week_rebuilds` with the sentence that caused it, so the pattern is
   * visible without being blocked.
   */

  const week = await weekOf(me.id, monday);
  if (week.length === 0) throw badRequest("There is nothing in that week to rebuild.");

  /*
   * The model reads the sentence when there is a key for it, and the rules read it when there
   * is not — same shape either way, and the week is rebuilt by the same deterministic code
   * from whichever set of constraints comes back.
   */
  /*
   * Today's index goes in, because "today" is the commonest word in these sentences and a pure
   * parser cannot know what day it is.
   */
  const todayDay = (new Date(`${today().slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7;
  const { by, ...parsed } = await parseWeekWith(raw, week, todayDay);
  const out = rebuildWeek(week.map((s) => ({ ...s })), parsed);

  /*
   * The sentence is stored with the diff it produced.
   *
   * When a rebuild goes wrong you need the words that caused it; a proposal on its own tells
   * you what happened and never why.
   */
  const byId = new Map(week.map((s) => [s.id, s]));
  const proposal = {
    monday,
    parsed,
    /*
     * Which parser read it, stored alongside. When a rebuild goes wrong the first question is
     * whether the sentence was misread or the week was misbuilt, and this answers it without
     * having to re-run anything.
     */
    parsed_by: by,
    sessions: out.sessions.map((s) => ({
      ...s, date: dateFor(monday, s.day), title: byId.get(s.id)?.title ?? s.label,
      moved_from: byId.get(s.id)?.day !== s.day ? DAY[byId.get(s.id)?.day ?? 0] : null,
      was_km: byId.get(s.id)?.km !== s.km ? byId.get(s.id)?.km : null,
    })),
    dropped: out.dropped.map((d) => ({ ...d, day: DAY[byId.get(d.id)?.day ?? 0] })),
    moved: out.moved,
    volume_delta: out.volume_delta,
    refusals: out.refusals,
    /** what the confirm bar says: one line of consequence. */
    summary: summarise(week, out.sessions, out.volume_delta, out.dropped.length),
  };

  const [row] = await sql<{ id: string }[]>`
    insert into week_rebuilds (user_id, week_start, raw_text, proposal)
    values (${me.id}, ${monday}, ${raw}, ${sql.json(proposal as never)})
    returning id
  `;
  return NextResponse.json({ proposal_id: row.id, ...proposal });
});

const dateFor = (monday: string, day: number) => {
  const d = new Date(`${monday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
};

/**
 * One line of consequence, and it never claims the week is unaffected.
 *
 * It is affected — that is the point of asking. A rebuild that pretends nothing was lost
 * teaches people to distrust the next one, so the volume drop is stated plainly and what
 * was protected is named.
 */
function summarise(
  before: WeekSession[], after: WeekSession[], delta: number, droppedCount: number,
): string {
  const km = (ss: WeekSession[]) => Math.round(ss.reduce((n, s) => n + (s.km ?? 0), 0));
  const key = after.some((s) => s.kind === "quality_run" || s.kind === "benchmark");
  const bits = [`${km(before)} → ${km(after)} km`];
  if (droppedCount > 0) bits.push(`${droppedCount} session${droppedCount > 1 ? "s" : ""} dropped`);
  bits.push(key ? "key session kept" : "key session gone — that is the one that matters");
  void delta;
  return bits.join(" · ");
}
