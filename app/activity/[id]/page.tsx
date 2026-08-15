import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import Activity from "@/components/app/Activity";

export const dynamic = "force-dynamic";

/**
 * Deep link to one activity.
 *
 * The app itself opens activities inside the shell (tab bar, back to Week), so
 * this route exists for links that arrive from outside — a bookmark, or the
 * "Session ›" link on a record. It renders the same component in a bare frame.
 */
export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;

  return (
    <div className="app">
      <header className="appbar">
        <a className="backbtn" href="/"><i>←</i><span>Week</span></a>
        <span className="whoami"><span className="avatar">{me.display_name.slice(0, 1).toUpperCase()}</span></span>
      </header>
      <div className="scroll"><Activity id={id} meId={me.id} /></div>
    </div>
  );
}
