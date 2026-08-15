"use client";
import { useCallback, useEffect, useState } from "react";
import { mondayOf, today } from "@/lib/dates";
import { type Block, daysToRace, weekOf } from "@/lib/block";
import Week from "./Week";
import Activity from "./Activity";
import Past from "./Past";
import Versus from "./Versus";
import Awards from "./Awards";
import Plan from "./Plan";
import Strategy from "./Strategy";
import Connect from "./Connect";
import Empty from "./Empty";
import PlanBuilder from "./PlanBuilder";
import Profile from "./Profile";
import Brief from "./Brief";
import Strength from "./Strength";
import Program from "./Program";
import Picker from "./Picker";
import Form from "./Form";
import RestTimer, { type Rest } from "./RestTimer";
import Record from "./Record";
import EditProfile from "./EditProfile";

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
  week_start: string;
  /** The signed-in athlete's own block, or null if they have none. */
  block: Block | null;
  users: User[]; sessions: Session[]; unplanned: Session[];
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
  | "activity" | "strategy" | "profile" | "brief" | "strength" | "program" | "picker" | "form" | "record" | "editProfile" | "connect" | "build";

/** Which tab lights up for a view that isn't itself a tab. */
const TAB_FOR: Record<View, string> = {
  week: "week", activity: "week",
  plan: "plan", strategy: "plan",
  past: "past", awards: "awards", versus: "versus", profile: "week",
  brief: "week", strength: "week", program: "plan", picker: "plan", form: "plan", record: "awards", editProfile: "week", connect: "week", build: "week",
};

/** Where the back arrow goes, and what it is called. */
const BACK: Partial<Record<View, { to: View; label: string }>> = {
  activity: { to: "week", label: "Week" },
  brief: { to: "week", label: "Week" },
  strength: { to: "week", label: "Week" },
  program: { to: "plan", label: "Plan" },
  picker: { to: "program", label: "Cancel" },
  form: { to: "plan", label: "Plan" },
  record: { to: "awards", label: "Awards" },
  editProfile: { to: "profile", label: "Profile" },
  connect: { to: "profile", label: "Profile" },
  strategy: { to: "plan", label: "Plan" },
  profile: { to: "week", label: "Week" },
};

export default function Shell({ me, other }: { me: User; other: User | null }) {
  const [view, setView] = useState<View>("week");
  /**
   * Whose week is open.
   *
   * null is your own. Set from the profile's coaching row, which is where the
   * relationship moved — the week screen lost its athlete toggle, because a
   * toggle implies two equal halves and coaching is a relationship you enter.
   */
  const [coaching, setCoaching] = useState<string | null>(null);
  const [monday, setMonday] = useState(() => mondayOf());
  const [openId, setOpenId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ date: string; slot: "AM" | "PM" } | null>(null);
  // The rest timer lives here rather than in Strength: it renders above the tab
  // bar, and it has to keep running while you scroll the session.
  const [rest, setRest] = useState<Rest | null>(null);
  const [recordDist, setRecordDist] = useState<string | null>(null);
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
  // The block belongs to whoever's plan it is. Without one, the header must not
  // count down to someone else's race.
  const block = data?.block ?? null;
  const week = weekOf(block, monday);
  const left = daysToRace(block, today());

  const coachingName = coaching
    ? data?.users.find((u) => u.id === coaching)?.display_name ?? null
    : null;

  const sub =
    view === "past" ? "Everything logged"
    : view === "awards" ? "Records and medals"
    : view === "versus" ? `You vs ${other?.display_name ?? "—"}`
    : view === "profile" ? "Settings"
    : view === "strategy" ? "Race plan"
    : view === "editProfile" ? "Your details"
    : view === "connect" ? "Strava, intervals.icu, Runna"
    : view === "build" ? "From your answers"
    : coachingName ? `Coaching ${coachingName}`
    : view === "record" ? "Every ranked effort"
    : view === "form" ? "Pace and volume against plan"
    : view === "program" ? "Edit the week"
    : view === "picker" ? "Add a session"
    : week ? `Week ${week.n} · ${week.km} km target`
    : !block ? "Nothing scheduled"
    : left == null ? block.name
    : left > 0 ? `${left} days to race` : "Off block";

  const title =
    view === "past" ? "Past" : view === "awards" ? "Awards" : view === "versus" ? "Versus"
    : view === "profile" ? "Profile" : view === "strategy" ? "Strategy"
    : view === "plan" ? "Plan" : view === "program" ? "Program"
    : view === "picker" ? "Add" : view === "form" ? "Form"
    : view === "record" ? "Record" : view === "connect" ? "Connections"
    : view === "build" ? "Build my plan" : "Split";

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
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {view === "week" && (
            // Rearrange used to be a tile on the plan tab. It belongs beside the
            // week it rearranges.
            <button onClick={() => setView("program")} aria-label="Rearrange the week"
              style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--off)",
                display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="var(--ink-55)" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </button>
          )}
          {coachingName ? (
            // Coaching is a mode you are in, so there has to be a way out of it.
            // Without this the only exit was a reload.
            <button onClick={() => { setCoaching(null); setView("week"); }}
              className="whoami" aria-label={`Stop coaching ${coachingName}`}>
              <span className="nm">{coachingName}</span>
              <span className="avatar" style={{ background: "var(--navy)",
                color: "var(--lime)" }}>✕</span>
            </button>
          ) : (
            <button className="whoami" onClick={() => setView("profile")} aria-label="Profile">
              <span className="nm">{me.display_name}</span>
              <span className="avatar">{me.display_name.slice(0, 1).toUpperCase()}</span>
            </button>
          )}
        </span>
      </header>

      <div className="scroll">
        {error && <div className="pad"><div className="errbox" role="alert">{error}</div></div>}

        {view === "week" && !block && data && (
          <Empty name={me.display_name} onBuild={() => setView("build")} />
        )}
        {view === "week" && (block || !data) && (
          <Week
            data={data} me={me} monday={monday} coaching={coaching}
            openActivity={openActivity} openSession={openSession} reload={load}
            openWeek={() => setView("program")}
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
        {view === "versus" && <Versus />}
        {view === "awards" && (
          <Awards meId={me.id} openActivity={openActivity}
            openRecord={(dist) => { setRecordDist(dist); setView("record"); }} />
        )}
        {view === "record" && recordDist && (
          <Record dist={recordDist} openActivity={openActivity} />
        )}
        {view === "plan" && !block && data && (
          <Empty name={me.display_name} onBuild={() => setView("build")} />
        )}
        {view === "plan" && (block || !data) && (
          <Plan data={data} monday={monday} goStrategy={() => setView("strategy")}
            openSession={openSession} />
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
        {view === "profile" && (
          <Profile me={me} openEdit={() => setView("editProfile")}
            openConnect={() => setView("connect")}
            openBuild={() => setView("build")}
            openCoachee={(id) => { setCoaching(id); setView("week"); }} />
        )}
        {view === "editProfile" && <EditProfile onSaved={() => setView("profile")} />}
        {view === "connect" && <Connect />}
        {view === "build" && (
          <PlanBuilder onDone={() => { setView("week"); load(); }} />
        )}
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

