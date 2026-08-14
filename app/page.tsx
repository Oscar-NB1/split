import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { sql } from "@/lib/db";
import Calendar from "@/components/Calendar";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentUser();
  if (!me) redirect("/login");

  const users = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from users order by created_at
  `;
  const other = users.find((u) => u.id !== me.id) ?? null;

  return <Calendar me={me} other={other} />;
}
