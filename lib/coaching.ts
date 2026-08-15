import { sql } from "./db";

/**
 * Who coaches whom.
 *
 * Read from the database rather than hardcoded, so a second athlete appears on
 * the profile without a code change — and, more importantly, so that "may I see
 * this person's plan" has one answer in one place. An `athlete` parameter on a
 * request is an access-control question, not a convenience.
 */

export type Relation = { id: string; display_name: string; email: string };

/** The athletes this person coaches. */
export const coachees = (coachId: string) => sql<Relation[]>`
  select u.id, u.display_name, u.email
    from coaching c join users u on u.id = c.athlete_id
   where c.coach_id = ${coachId}
   order by u.created_at
`;

/** The people coaching this athlete. */
export const coachedBy = (athleteId: string) => sql<Relation[]>`
  select u.id, u.display_name, u.email
    from coaching c join users u on u.id = c.coach_id
   where c.athlete_id = ${athleteId}
   order by u.created_at
`;

/** May this person act on that athlete's plan? */
export async function canCoach(coachId: string, athleteId: string): Promise<boolean> {
  if (coachId === athleteId) return true;
  const [row] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from coaching where coach_id = ${coachId} and athlete_id = ${athleteId}
    ) as ok
  `;
  return row?.ok ?? false;
}

export async function link(coachId: string, athleteId: string) {
  if (coachId === athleteId) return;
  await sql`
    insert into coaching (coach_id, athlete_id) values (${coachId}, ${athleteId})
    on conflict do nothing
  `;
}
