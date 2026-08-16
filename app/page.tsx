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

  const users = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users order by created_at
  `;
  const other = users.find((u) => u.id !== me.id) ?? null;

  return <Shell me={me} other={other} />;
}
