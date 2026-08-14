import { NextResponse, after, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { pushSession } from "@/lib/intervals";
import { badRequest, route } from "@/lib/http";
import { isDateString, isKind, isUuid, KINDS } from "@/lib/plan";

/** Create a session. Either athlete may write to either calendar. */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const b = await req.json();

  // Validated because an unknown kind silently breaks the matcher, the effort
  // weights and the labels, and a missing date used to surface as a 500 out of
  // the not-null constraint.
  if (!isDateString(b.planned_date)) throw badRequest("planned_date must be YYYY-MM-DD.");
  if (typeof b.title !== "string" || !b.title.trim()) throw badRequest("A title is required.");
  if (!isKind(b.kind)) throw badRequest(`kind must be one of: ${KINDS.join(", ")}`);
  // Whole minutes, coerced once and inserted as the coerced value. Validating
  // Number(x) while inserting x raw still let true, "45.0" and 1e21 reach the
  // integer column, which is a 500 rather than something anyone can act on.
  const minutes = plannedMinutes(b.planned_minutes);
  if (b.user_id != null && !isUuid(b.user_id)) throw badRequest("user_id must be a uuid.");

  const [row] = await sql<{ id: string }[]>`
    insert into planned_sessions
      (user_id, author_id, planned_date, title, kind, planned_minutes, target, coach_note, source)
    values (${b.user_id ?? me.id}, ${me.id}, ${b.planned_date}, ${b.title.trim()}, ${b.kind},
            ${minutes}, ${b.target ?? null}, ${b.coach_note ?? null}, 'manual')
    returning id
  `;
  await sql`
    insert into session_changes (session_id, actor_id, action, to_date)
    values (${row.id}, ${me.id}, 'created', ${b.planned_date})
  `;
  after(() => pushSession(row.id).catch((e) => console.error("watch push", e)));
  return NextResponse.json({ id: row.id });
});

/** null, or a positive whole number of minutes. Throws on anything else. */
function plannedMinutes(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw badRequest("planned_minutes must be a whole number of minutes.");
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw badRequest("planned_minutes must be a whole number of minutes.");
  }
  return n;
}
