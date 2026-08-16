import { currentUser } from "@/lib/session";
import { sql } from "@/lib/db";
import Shell from "@/components/app/Shell";
import Auth from "@/components/app/Auth";

export const dynamic = "force-dynamic";

/**
 * The app, or the gate.
 *
 * Signed out renders the gate inside the phone frame rather than redirecting to
 * a page: the frame is the app, and bouncing out of it to sign in and back again
 * is a worse first impression than never leaving. It also means the OAuth
 * callback can return to `/` and be read where it lands.
 */
export default async function Home() {
  const me = await currentUser();
  if (!me) {
    return <div className="app topsafe"><Auth /></div>;
  }

  /*
   * Who the header means by "the other one".
   *
   * An accepted connection, not simply the next row in `users` — which is what
   * this was while there were no connection endpoints, and which named a stranger
   * on the versus header as soon as a third person registered.
   */
  const [other] = await sql<{ id: string; display_name: string }[]>`
    select u.id, u.display_name
      from connections c
      join users u on u.id = case when c.requester_id = ${me.id}
                                  then c.addressee_id else c.requester_id end
     where c.status = 'accepted'
       and (c.requester_id = ${me.id} or c.addressee_id = ${me.id})
     order by c.responded_at limit 1
  `;

  return <Shell me={me} other={other ?? null} />;
}
