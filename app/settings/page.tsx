import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import Strava from "@/components/app/Strava";

export const dynamic = "force-dynamic";

/**
 * The connections screen, reachable by URL.
 *
 * It exists as a page as well as an in-app view because Strava's OAuth callback
 * redirects to a URL and cannot render a view. Both render the same component, so
 * there is one connections screen rather than two that drift — the page this
 * replaces was still on the pre-design stylesheet, and the Profile screen linked
 * straight into it.
 */
export default async function Settings() {
  const me = await currentUser();
  if (!me) redirect("/");

  return (
    <div className="app">
      <header className="appbar">
        <a href="/" className="backbtn"><i>←</i><span>App</span></a>
        <span className="whoami">
          <span className="nm">{me.display_name}</span>
          <span className="avatar">{me.display_name.slice(0, 1).toUpperCase()}</span>
        </span>
      </header>
      <div className="scroll">
        <Strava />
      </div>
    </div>
  );
}
