import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import { readInjuries } from "@/lib/plan/read-injuries";
import type { ConstraintReading, TrainingConstraint } from "@/lib/plan/constraints";
import { rememberDay } from "@/lib/replan";

/**
 * What the athlete is training around: read it, show it back, and only then act on it.
 *
 * Three calls, and the split between them is the whole design:
 *
 *   GET   what is currently confirmed, and whether it is still about the note they have
 *   POST  read the note into a proposal — writes nothing to the plan
 *   PUT   confirm a subset of that proposal, which is the only thing that reaches a session
 *
 * The reason confirmation is a separate call rather than a flag on the read: this is health
 * information, and a plan that quietly reshaped itself from a sentence in a text box would be
 * making a judgement about somebody's body that it is not entitled to make. The athlete sees
 * their own words, sees what follows from them, and agrees or does not.
 *
 * The note itself is never logged. It is the most sensitive text in this app — it is about one
 * person's injuries — and it lives in its own row, on their own screens, and nowhere else.
 */

type Row = {
  source_text: string; reading: ConstraintReading; confirmed: TrainingConstraint[];
  confirmed_at: string | null;
};

/**
 * The note, from the one place the athlete last edited it.
 *
 * Two columns hold this text: `athlete_intake.injuries` is what they typed when they signed
 * up, and `users.injury_notes` is the field on their profile they come back to. The profile
 * wins where it has anything in it, because an athlete editing the visible box and getting a
 * reading of the answer they gave in March would be the app arguing with them.
 */
async function noteFor(userId: string): Promise<string> {
  const [row] = await sql<{ note: string | null }[]>`
    select coalesce(nullif(btrim(u.injury_notes), ''), nullif(btrim(i.injuries), '')) as note
      from users u
      left join athlete_intake i on i.user_id = u.id
     where u.id = ${userId}
  `;
  return (row?.note ?? "").trim();
}

export const GET = route(async () => {
  const me = await requireUser();
  const [row] = await sql<Row[]>`
    select source_text, reading, confirmed, confirmed_at::text as confirmed_at
      from training_constraints where user_id = ${me.id}
  `;
  const note = await noteFor(me.id);

  return NextResponse.json({
    note,
    confirmed: row?.confirmed ?? [],
    reading: row?.reading ?? null,
    confirmed_at: row?.confirmed_at ?? null,
    /*
     * Whether the confirmation is still about the note they have now.
     *
     * A niggle that healed gets edited out of the note, and constraints from the old text
     * would go on quietly removing training nobody needs removed. So an edited note marks
     * the reading stale rather than keeping it.
     */
     stale: Boolean(row && row.source_text.trim() !== note),
  });
});

export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));

  /*
   * The text comes from the intake by default, because that is where it was already asked.
   * A body may override it so the profile screen can read what is being typed without
   * saving it first.
   */
  const text = String(body?.text ?? await noteFor(me.id)).trim();
  if (text.length > 1200) throw badRequest("That is longer than this can usefully read.");
  if (!text) {
    return NextResponse.json({
      reading: { constraints: [], unactionable: [], by: "words" },
      note: "",
    });
  }

  const reading = await readInjuries(text);

  await sql`
    insert into training_constraints (user_id, source_text, reading, updated_at)
    values (${me.id}, ${text}, ${sql.json(reading as never)}, now())
    on conflict (user_id) do update
      set source_text = excluded.source_text, reading = excluded.reading, updated_at = now()
  `;
  /*
   * Deliberately not returned: nothing about what the plan will now do. It will do nothing
   * until PUT, and implying otherwise is the failure this whole split exists to avoid.
   */
  return NextResponse.json({ reading, note: text });
});

export const PUT = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json();
  const picked = Array.isArray(body?.constraints) ? body.constraints : null;
  if (!picked) throw badRequest("Send the constraints you are confirming.");

  const [row] = await sql<Row[]>`
    select source_text, reading, confirmed, confirmed_at::text as confirmed_at
      from training_constraints where user_id = ${me.id}
  `;
  if (!row) throw badRequest("Nothing has been read yet.");

  /*
   * Only constraints from the stored reading can be confirmed, matched on their own quote
   * and target. A client that could post an arbitrary constraint would be a client that
   * could remove any exercise from anybody's plan by asking — and confirmation is meant to
   * be the athlete agreeing to something the app proposed, not a write endpoint.
   */
  const offered = row.reading?.constraints ?? [];
  const same = (a: TrainingConstraint, b: TrainingConstraint) =>
    a.quote === b.quote && a.avoid_pattern === b.avoid_pattern
    && a.avoid_movement === b.avoid_movement;
  const confirmed = offered.filter((o) => picked.some((p: TrainingConstraint) => same(o, p)));

  await sql`
    update training_constraints
       set confirmed = ${sql.json(confirmed as never)},
           confirmed_at = ${confirmed.length ? sql`now()` : null},
           updated_at = now()
     where user_id = ${me.id}
  `;

  /*
   * The plan is rebuilt from stored answers, which is where the constraint gets applied —
   * the same path an intake edit takes. Future weeks only, and never a session already
   * logged against.
   */
  const weeks = await rememberDay(me.id);

  return NextResponse.json({
    ok: true, confirmed, weeks,
    note: confirmed.length
      ? "Your gym sessions from here on work around it. Change it any time."
      : "Nothing is being worked around. Your plan is unchanged.",
  });
});
