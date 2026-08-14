"use client";
import { useCallback, useEffect, useState } from "react";
import { addDays, diffDays, dow, fmt, mondayOf, today } from "@/lib/dates";
import type { KINDS as PLAN_KINDS } from "@/lib/plan";

type User = { id: string; display_name: string };
type Session = {
  id: string; user_id: string; planned_date: string; title: string; kind: string;
  planned_minutes: number | null; target: string | null; coach_note: string | null;
  status: string; actual_minutes: number | null; skip_reason: string | null;
  effort_points: number | null; source: string; avg_hr: number | null;
  distance_m: number | null; activity_name: string | null;
};
type WeekData = {
  week_start: string; users: User[]; sessions: Session[]; unplanned: Session[];
  streaks: Record<string, number>;
  challenge: { metric: string; label: string; scores: { user_id: string; score: number }[] };
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KINDS: { kind: (typeof PLAN_KINDS)[number]; title: string; minutes: number }[] = [
  { kind: "run_easy", title: "Easy run", minutes: 40 },
  { kind: "run_intervals", title: "Intervals", minutes: 55 },
  { kind: "run_long", title: "Long run", minutes: 80 },
  { kind: "hyrox", title: "Hyrox stations", minutes: 45 },
  { kind: "strength", title: "Strength", minutes: 50 },
];
const REASONS = [
  ["tired", "Too tired"], ["sore", "Sore or niggling"],
  ["no_time", "No time"], ["sick", "Ill"], ["other", "Something else"],
];

/** Target race. Set NEXT_PUBLIC_RACE_DATE to move it without a code change. */
const RACE_DATE = process.env.NEXT_PUBLIC_RACE_DATE ?? "2026-11-28";

const label = (k: string) =>
  ({ run_easy: "Run · easy", run_intervals: "Run · intervals", run_long: "Run · long",
     hyrox: "Hyrox", strength: "Strength", rest: "Rest" } as Record<string, string>)[k] ??
  // Strava sport types arrive as WeightTraining and the like
  k.replace(/([a-z])([A-Z])/g, "$1 $2");

export default function Calendar({ me, other }: { me: User; other: User | null }) {
  // Dates are 'YYYY-MM-DD' strings throughout, never Dates: toISOString() on a
  // local midnight reports the previous day everywhere east of UTC, which used
  // to highlight the wrong "today" between midnight and 02:00 in Berlin.
  const [monday, setMonday] = useState(() => mondayOf());
  const [data, setData] = useState<WeekData | null>(null);
  const [view, setView] = useState<"me" | "them" | "vs">("me");
  const [day, setDay] = useState(() => dow(today()));
  const [open, setOpen] = useState<Session | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width:900px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/week?week=${monday}`);
    if (res.ok) {
      setData(await res.json());
      setError(null);
    } else if (res.status === 401) {
      location.href = "/login";
    } else {
      setError("Couldn't load this week.");
    }
  }, [monday]);
  useEffect(() => { load(); }, [load]);

  const who = (s: Session) => (s.user_id === me.id ? "a" : "b");
  const visible = (s: Session) =>
    view === "vs" ? true : view === "me" ? s.user_id === me.id : s.user_id === other?.id;

  const days = mobile ? [day] : [0, 1, 2, 3, 4, 5, 6];
  const all = data ? [...data.sessions, ...data.unplanned] : [];

  /** Every write goes through here, so a failure is always visible. */
  async function send(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    const res = await fetch(url, {
      method, headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = "/login"; return null; }
    if (!res.ok) {
      // a rejected write used to close the sheet in silence and change nothing
      setError(json.error ?? "That didn't save.");
      return null;
    }
    setError(null);
    return json as Record<string, unknown>;
  }

  async function act(id: string, body: Record<string, unknown>) {
    const json = await send(`/api/sessions/${id}`, "PATCH", body);
    if (!json) return;
    setWarning((json.warning as string) ?? null);
    setOpen(null);
    load();
  }

  async function create(kind: (typeof KINDS)[number], date: string, forUser: string) {
    const json = await send("/api/sessions", "POST", {
      user_id: forUser, planned_date: date, title: kind.title,
      kind: kind.kind, planned_minutes: kind.minutes,
    });
    if (!json) return;
    setAdding(null);
    load();
  }

  const scoreOf = (uid?: string) =>
    data?.challenge.scores.find((s) => s.user_id === uid)?.score ?? 0;
  const a = scoreOf(me.id), b = scoreOf(other?.id);
  const tot = a + b || 1;

  const raceIn = Math.max(0, diffDays(RACE_DATE, today()));

  return (
    <div className="wrap">
      <header className="top">
        <div className="brandrow">
          <div className="brand"><h1>Split</h1></div>
          <div className="clocks">
            <div className="clock x">
              <div className="n mono">{raceIn}</div>
              <div className="l">days · target race</div>
            </div>
            <a href="/settings" className="clock y" style={{ textDecoration: "none" }}>
              <div className="n mono">⚙</div><div className="l">settings</div>
            </a>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={view === "me"} onClick={() => setView("me")}>
            My training
          </button>
          <button role="tab" className="hb" aria-selected={view === "them"} onClick={() => setView("them")}>
            Coaching {other?.display_name ?? "—"}
          </button>
          <button role="tab" aria-selected={view === "vs"} onClick={() => setView("vs")}>
            Head to head
          </button>
        </nav>
      </header>

      <div className="weekbar">
        <div>
          <div className="range">
            {fmt(monday, { day: "numeric", month: "short" })} —{" "}
            {fmt(addDays(monday, 6), { day: "numeric", month: "short" })}
          </div>
          <div className="meta">{data ? `${data.sessions.length} sessions` : "loading…"}</div>
        </div>
        <div className="arrows">
          <button onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">←</button>
          <button onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">→</button>
        </div>
      </div>

      <div className="daystrip" role="group" aria-label="Pick a day">
        {DOW.map((d, i) => {
          const date = addDays(monday, i);
          const list = all.filter((s) => s.planned_date === date && visible(s));
          return (
            <button key={d} aria-pressed={i === day} onClick={() => setDay(i)}
              className={date === today() ? "tdy" : ""}>
              <span className="dw">{d}</span>
              <span className="dn">{fmt(date, { day: "numeric" })}</span>
              <span className="dots">
                {list.slice(0, 3).map((s) => (
                  <i key={s.id} style={{
                    background: s.status === "skipped" ? "var(--warn)"
                      : s.status === "planned" ? "var(--dimmer)"
                      : who(s) === "a" ? "var(--a)" : "var(--b)",
                  }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {error && <div className="errbox" role="alert">{error}</div>}
      {warning && <div className="warnbox">{warning}</div>}

      <div className="layout">
        <main>
          <div className="week">
            {days.map((i) => {
              const date = addDays(monday, i);
              const list = all.filter((s) => s.planned_date === date && visible(s));
              const isToday = date === today();
              return (
                <div key={i} className={`day${isToday ? " today" : ""}`}>
                  <div className="dayhead">
                    <span className="dow">{mobile ? fmt(date, { weekday: "long" }) : DOW[i]}</span>
                    <span className="dnum">{fmt(date, { day: "numeric" })}</span>
                  </div>

                  {list.length === 0 && mobile && <div className="emptyday">Nothing planned.</div>}

                  {list.map((s) => {
                    // an unplanned activity has no plan to measure against, so it
                    // gets a full rail rather than the empty one it used to show
                    const extra = s.status === "unplanned";
                    const pct = extra ? 100
                      : s.actual_minutes && s.planned_minutes
                        ? Math.min(100, Math.round((s.actual_minutes / s.planned_minutes) * 100))
                        : s.actual_minutes ? 100 : 0;
                    const over = !!(s.actual_minutes && s.planned_minutes && s.actual_minutes > s.planned_minutes);
                    return (
                      <button key={s.id} onClick={() => setOpen(s)}
                        className={`sess ${who(s)}${s.status === "planned" ? " planned" : ""}${s.status === "skipped" ? " skipped" : ""}${extra ? " extra" : ""}`}>
                        <div className="t">{s.title}</div>
                        <div className="k">
                          {label(s.kind)}
                          {view === "vs" && ` · ${s.user_id === me.id ? "You" : other?.display_name}`}
                          {s.source === "runna" && " · Runna"}
                          {extra && " · off plan"}
                        </div>
                        <div className="rail">
                          <i className={over ? "over" : who(s)} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="railnote">
                          <span>
                            {extra ? "not on the plan"
                              : s.planned_minutes ? `${s.planned_minutes} min planned` : "no duration set"}
                          </span>
                          <span>
                            {s.status === "skipped" ? "skipped"
                              : s.actual_minutes ? `${s.actual_minutes} min` : "—"}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {view !== "vs" && (
                    <button className="addbtn" onClick={() => setAdding(date)}>+ Add session</button>
                  )}
                </div>
              );
            })}
          </div>
        </main>

        <aside>
          <div className="card">
            <h3>This week&apos;s challenge</h3>
            <div className="tugname">{data?.challenge.label ?? "—"}</div>
            <div className="tugbar">
              <span className="x" style={{ width: `${(a / tot) * 100}%` }} />
              <span className="y" style={{ width: `${(b / tot) * 100}%` }} />
            </div>
            <div className="tugvals">
              <div>You<b className="va">{a}</b></div>
              <div className="r">{other?.display_name ?? "—"}<b className="vb">{b}</b></div>
            </div>
          </div>

          <div className="card">
            <h3>Adherence streak</h3>
            <div className="streakrow">
              <span style={{ fontWeight: 600 }}>You</span>
              <span className="streaknum va">{data?.streaks[me.id] ?? 0}</span>
            </div>
            {other && (
              <div className="streakrow">
                <span style={{ fontWeight: 600 }}>{other.display_name}</span>
                <span className="streaknum vb">{data?.streaks[other.id] ?? 0}</span>
              </div>
            )}
          </div>

        </aside>
      </div>

      {/* ---------- session sheet ---------- */}
      <div className={`scrim${open || adding ? " on" : ""}`}
        onClick={() => { setOpen(null); setAdding(null); }} />

      <div className={`sheet${open ? " on" : ""}`}>
        {open && (
          <>
            <div className="eyebrow">
              {fmt(open.planned_date, { weekday: "long", day: "numeric", month: "long" })}
              {" · "}{open.user_id === me.id ? "You" : other?.display_name}
            </div>
            <h2>{open.title}</h2>
            <div className="pvsa">
              <div>
                <div className="lab">Planned</div>
                <div className="val">
                  {open.status === "unplanned"
                    ? <>nothing<br />off plan</>
                    : <>{open.planned_minutes ?? "—"} min<br />{label(open.kind)}</>}
                </div>
              </div>
              <div>
                <div className="lab">
                  {open.status === "done" ? "Actual" : open.status === "adjusted" ? "Adjusted"
                    : open.status === "skipped" ? "Skipped"
                    : open.status === "unplanned" ? "Logged" : "Not yet"}
                </div>
                <div className="val">
                  {open.actual_minutes ? `${open.actual_minutes} min` : "—"}
                  {open.avg_hr ? <><br />{Math.round(open.avg_hr)} bpm</> : null}
                </div>
              </div>
            </div>

            {open.target && <div className="note">{open.target}</div>}
            {open.coach_note && (
              <div className="coachbox"><div className="lab">Coach note</div><p>{open.coach_note}</p></div>
            )}
            {open.effort_points ? <div className="note">{open.effort_points} effort points.</div> : null}

            {open.status === "unplanned" && (
              <p className="note">
                This arrived from Strava with nothing planned against it. Pairing it to a
                session by hand isn&apos;t built yet.
              </p>
            )}

            {open.status === "planned" && (
              <>
                <div className="actions" style={{ marginBottom: 10 }}>
                  <button className="act" onClick={() =>
                    act(open.id, { action: "move", to_date: addDays(open.planned_date, 1) })}>
                    Move a day
                  </button>
                  <button className="act" onClick={() => act(open.id, { action: "scale" })}>
                    Scale down
                  </button>
                </div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Can&apos;t do it?</div>
                <div className="actions">
                  {REASONS.map(([r, t]) => (
                    <button key={r} className="act danger"
                      onClick={() => act(open.id, { action: "skip", reason: r })}>
                      {t}
                    </button>
                  ))}
                </div>
                <p className="note" style={{ marginTop: 12 }}>
                  Skipped sessions don&apos;t roll forward, and come off the watch. Two
                  fatigue skips in a week and next week&apos;s volume comes down
                  automatically.
                </p>
              </>
            )}
          </>
        )}
      </div>

      {/* ---------- add sheet ---------- */}
      <div className={`sheet${adding ? " on" : ""}`}>
        {adding && (
          <>
            <div className="eyebrow">
              {fmt(adding, { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <h2>Add a session</h2>
            {KINDS.map((k) => (
              <button key={k.kind} className="opt"
                onClick={() => create(k, adding, view === "them" && other ? other.id : me.id)}>
                <b>{k.title}</b>
                <span>{label(k.kind)} · {k.minutes} min</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
