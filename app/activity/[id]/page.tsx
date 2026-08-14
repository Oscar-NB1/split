import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import ActivityDetail from "@/components/ActivityDetail";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;

  return (
    <div className="wrap">
      <header className="top">
        <div className="brandrow">
          <div className="brand"><h1>Split</h1></div>
          <a href="/" className="toplink">Week</a>
        </div>
      </header>
      {/* the id is validated server-side by the API route, not here — a bad one
          comes back as a 404 the component renders as a message */}
      <ActivityDetail id={id} meId={me.id} />
    </div>
  );
}
