import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { sql } from "@/lib/db";
import Connections from "@/components/Connections";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const me = await currentUser();
  if (!me) redirect("/login");

  const rows = await sql<{ provider: string; updated_at: Date }[]>`
    select provider, updated_at from oauth_accounts where user_id = ${me.id}
  `;
  const connected = Object.fromEntries(rows.map((r) => [r.provider, true]));

  return (
    <div className="wrap">
      <header className="top">
        <div className="brandrow">
          <div className="brand"><h1>Split</h1></div>
          <a href="/" style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--dim)" }}>
            Back
          </a>
        </div>
      </header>
      <Connections me={me} connected={connected} />
    </div>
  );
}
