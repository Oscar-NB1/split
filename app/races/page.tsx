import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import Races from "@/components/Races";

export const dynamic = "force-dynamic";

export default async function RacesPage() {
  const me = await currentUser();
  if (!me) redirect("/login");

  return (
    <div className="wrap">
      <header className="top">
        <div className="brandrow">
          <div className="brand"><h1>Split</h1></div>
          <a href="/" className="toplink">Week</a>
        </div>
      </header>
      <Races meId={me.id} />
    </div>
  );
}
