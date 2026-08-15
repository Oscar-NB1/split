"use client";
import { useCallback, useEffect, useState } from "react";
import { mondayOf, today } from "@/lib/dates";
import { RACE_DATE, daysToRace, weekOf } from "@/lib/coach";
import Week from "./Week";
import Activity from "./Activity";
import Past from "./Past";
import Versus from "./Versus";
import Awards from "./Awards";
import Plan from "./Plan";
import Strategy from "./Strategy";
import Profile from "./Profile";
import Brief from "./Brief";
import Strength from "./Strength";
import Program from "./Program";
import Picker from "./Picker";
import Form from "./Form";
import RestTimer, { type Rest } from "./RestTimer";

export type User = { id: string; display_name: string };
export type Session = {
  id: string; user_id: string; planned_date: string; title: string; kind: string;
  planned_minutes: number | null; target: string | null; coach_note: string | null;
  status: string; actual_minutes: number | null; skip_reason: string | null;
  effort_points: number | null; source: string; avg_hr: number | null;
  distance_m: number | null; activity_name: string | null; activity_id: string | null;
  slot?: string | null;
  significance?: string | null;
};
export type WeekData = {
  week_start: string; users: User[]; sessions: Session[]; unplanned: Session[];
  streaks: Record<string, number>;
  reps_off?: number;
  challenge: { metric: string; label: string; scores: { user_id: string; score: number }[] };
};

/** The five tabs from the design, in the design's order. */
const TABS = [
  ["week", "Week"], ["plan", "Plan"], ["past", "Past"], ["awards", "Awards"], ["versus", "Versus"],
] as const;
export type View =
  | "week" | "plan" | "past" | "awards" | "versus"
  | "activity" | "strategy" | "profile" | "brief" | "strength" | "program" | "picker" | "form";

/** Which tab lights up for a view that isn't itself a tab. */
const TAB_FOR: Record<View, string> = {
  week: "week", activity: "week",
  plan: "plan", strategy: "plan",
  past: "past", awards: "awards", versus: "versus", profile: "week",
  brief: "week", strength: "week", program: "plan", picker: "plan", form: "plan",
};

/** Where the back arrow goes, and what it is called. */
const BACK: Partial<Record<View, { to: View; label: string }>> = {
  activity: { to: "week", label: "Week" },
  brief: { to: "week", label: "Week" },
  strength: { to: "week", label: "Week" },
  program: { to: "plan", label: "Plan" },
  picker: { to: "program", label: "Cancel" },
  form: { to: "plan", label: "Plan" },
  strategy: { to: "plan", label: "Plan" },
  profile: { to: "week", label: "Week" },
};

export default function Shell({ me, other }: { me: User; other: User | null }) {
  const [view, setView] = useState<View>("week");
  const [monday, setMonday] = useState(() => mondayOf());
  const [openId, setOpenId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ date: string; slot: "AM" | "PM" } | null>(null);
  // The rest timer lives here rather than in Strength: it renders above the tab
  // bar, and it has to keep running while you scroll the session.
  const [rest, setRest] = useState<Rest | null>(null);
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/week?week=${monday}`);
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) { setError("Couldn't load this week."); return; }
    setData(await res.json());
    setError(null);
  }, [monday]);
  useEffect(() => { load(); }, [load]);

  // The scroll position belongs to the screen, not the app: coming back from an
  // activity to a week you had scrolled halfway down should not land you at the
  // top of it, but opening a new screen always should.
  useEffect(() => { document.querySelector(".scroll")?.scrollTo({ top: 0 }); }, [view]);

  const openActivity = (id: string) => { setOpenId(id); setView("activity"); };
  /**
   * A tapped session goes to whichever screen can actually do something with it:
   * a strength session to the set logger, a finished one to its activity, and
   * anything else to the brief.
   */
  const openSession = (s: Session) => {
    if (s.status === "unplanned" && s.activity_id) return openActivity(s.activity_id);
    setSessionId(s.id);
    setView(s.kind === "strength" ? "strength" : "brief");
  };
  const back = BACK[view];
  const week = weekOf(monday);
  const left = daysToRace(today());

  const sub =
    view === "past" ? "Everything logged"
    : view === "awards" ? "Records and medals"
    : view === "versus" ? `You vs ${other?.display_name ?? "—"}`
    : view === "profile" ? "Settings"
    : view === "strategy" ? "Race plan"
    : view === "form" ? "Pace and volume against plan"
    : view === "program" ? "Edit the week"
    : view === "picker" ? "Add a session"
    : week ? `Week ${week.n} · ${week.km} km target`
    : left > 0 ? `${left} days to race` : "Off block";

  const title =
    view === "past" ? "Past" : view === "awards" ? "Awards" : view === "versus" ? "Versus"
    : view === "profile" ? "Profile" : view === "strategy" ? "Strategy"
    : view === "plan" ? "Plan" : view === "program" ? "Program"
    : view === "picker" ? "Add" : view === "form" ? "Form" : "Split";

  return (
    <div className="app">
      <header className="appbar">
        {back ? (
          <button className="backbtn" onClick={() => setView(back.to)}>
            <i>←</i><span>{back.label}</span>
          </button>
        ) : (
          <div>
            <span className="ttl">{title}</span>
            <span className="sub">{sub}</span>
          </div>
        )}
        <button className="whoami" onClick={() => setView("profile")} aria-label="Profile">
          <span className="nm">{me.display_name}</span>
          <span className="avatar">{me.display_name.slice(0, 1).toUpperCase()}</span>
        </button>
      </header>

      <div className="scroll">
        {error && <div className="pad"><div className="errbox" role="alert">{error}</div></div>}

        {view === "week" && (
          <Week
            data={data} me={me} other={other} monday={monday} setMonday={setMonday}
            openActivity={openActivity} openSession={openSession} reload={load}
          />
        )}
        {view === "activity" && openId && <Activity id={openId} meId={me.id} />}
        {view === "brief" && sessionId && (
          <Brief id={sessionId} meId={me.id} openActivity={openActivity} onChanged={load} />
        )}
        {view === "strength" && sessionId && (
          <Strength id={sessionId} meId={me.id} onChanged={load} startRest={setRest} />
        )}
        {view === "past" && <Past openActivity={openActivity} />}
        {view === "versus" && <Versus data={data} me={me} other={other} />}
        {view === "awards" && <Awards meId={me.id} openActivity={openActivity} />}
        {view === "plan" && (
          <Plan monday={monday} goStrategy={() => setView("strategy")}
            goProgram={() => setView("program")} goForm={() => setView("form")} />
        )}
        {view === "program" && (
          <Program
            data={data} me={me} other={other} monday={monday} setMonday={setMonday}
            reload={load} openSession={openSession}
            openPicker={(date, slot) => { setAdding({ date, slot }); setView("picker"); }}
          />
        )}
        {view === "picker" && adding && (
          <Picker date={adding.date} slot={adding.slot} forUser={me.id}
            onDone={() => { setAdding(null); setView("program"); load(); }}
            onCancel={() => { setAdding(null); setView("program"); }} />
        )}
        {view === "strategy" && <Strategy />}
        {view === "form" && <Form />}
        {view === "profile" && <Profile me={me} />}
      </div>

      {rest && (
        <RestTimer rest={rest} onChange={setRest} onDismiss={() => setRest(null)} />
      )}

      <nav className="tabbar">
        {TABS.map(([v, label]) => (
          <button
            key={v} onClick={() => setView(v as View)}
            aria-current={TAB_FOR[view] === v ? "page" : undefined}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export const RACE = RACE_DATE;
