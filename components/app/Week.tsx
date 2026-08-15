"use client";
import { useState } from "react";
import { addDays, dow, fmt, today } from "@/lib/dates";
import {
  BLOCK_START, GOAL, WEEKS, kindColour, kindLabel, weekDates, weekIntent, weekOf,
} from "@/lib/coach";
import type { Session, User, WeekData } from "./Shell";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const statusTag = (s: Session) =>
  s.status === "done" ? ["done", "Done"]
  : s.status === "adjusted" ? ["adj", "Adjusted"]
  : s.status === "skipped" ? ["skip", "Skipped"]
  : s.status === "unplanned" ? ["done", "Logged"]
  : ["plan", "Planned"];

export default function Week({
  data, me, other, monday, setMonday, openActivity, reload,
}: {
  data: WeekData | null; me: User; other: User | null;
  monday: string; setMonday: (d: string) => void;
  openActivity: (id: string) => void; reload: () => void;
}) {
  const [day, setDay] = useState(() => dow(today()));
  const [who, setWho] = useState<"me" | "them">("me");

  if (!data) return <div className="pad"><p className="empty">Loading…</p></div>;

  const uid = who === "me" ? me.id : other?.id;
  const all = [...data.sessions, ...data.unplanned].filter((s) => s.user_id === uid);
  const dates = weekDates(monday);
  const week = weekOf(monday);
  // Outside the block there is no phase to name. Borrowing week 1's intent put
  // "Rebuild · weeks 1-3" above a headline that said "Off block".
  const intent = week ? weekIntent(week.n) : null;
  const startsSoon = !week && monday < BLOCK_START;

  const dayDate = dates[day];
  const daySessions = all.filter((s) => s.planned_date === dayDate);

  // Week totals are counted off what actually happened, not what was planned —
  // a plan you did not do is not volume.
  const doneKm = all
    .filter((s) => s.distance_m)
    .reduce((n, s) => n + (Number(s.distance_m) || 0), 0) / 1000;
  const doneMin = all.reduce((n, s) => n + (s.actual_minutes ?? 0), 0);
  const plannedCount = all.filter((s) => s.status !== "unplanned").length;
  const doneCount = all.filter((s) => ["done", "adjusted", "unplanned"].includes(s.status)).length;

  return (
    <div className="pad">
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div className="eyebrow">
          {intent ? intent.phase : startsSoon ? "Before the block" : "Off block"}
        </div>
        <h1 className="h1">
          {week ? `${week.km} km, and two hard days.`
            : startsSoon ? "The block starts Monday." : "Off block."}
        </h1>
        <p className="muted">
          {week?.note
            || (startsSoon
              ? `Fifteen weeks to ${GOAL}. Week 1 is ${WEEKS[0].km} km — the rebuild is bought with consistency, not intensity.`
              : "Tuesday and Saturday are the week. Everything else supports them.")}
        </p>
      </div>

      {other && (
        <div className="pillrow" role="tablist" aria-label="Whose week">
          <button role="tab" aria-pressed={who === "me"} onClick={() => setWho("me")}>Mine</button>
          <button role="tab" aria-pressed={who === "them"} onClick={() => setWho("them")}>
            {other.display_name}
          </button>
        </div>
      )}

      {/* ---------------------------------------------- what the week is for */}
      {intent && (
      <section className="card intent">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="dot" /><span className="eyebrow">{intent.phase}</span>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-70)" }}>{intent.purpose}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <span className="caps">Protect these</span>
          {intent.protect.map((p) => (
            <div key={p} className="protect">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0A8FB0"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
              </svg>
              <span>{p}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div className="kv"><b>Drop first</b><span>{intent.sacrifice}</span></div>
          <div className="kv"><b>Watch for</b><span>{intent.watch}</span></div>
        </div>
      </section>
      )}

      {/* ------------------------------------------------------- the 7 days */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn-ghost" style={{ width: 46, padding: "10px 0" }}
          onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">←</button>
        <div className="strip" style={{ flex: 1 }}>
          {dates.map((d, i) => {
            const items = all.filter((s) => s.planned_date === d);
            return (
              <button key={d} onClick={() => setDay(i)} aria-pressed={day === i}
                className={d === today() ? "today" : undefined}>
                <span className="dw">{DOW[i]}</span>
                <span className="dn">{fmt(d, { day: "numeric" })}</span>
                <span className="dots">
                  {items.slice(0, 3).map((s) => (
                    <i key={s.id} style={{
                      background: kindColour(s.kind),
                      opacity: ["done", "adjusted", "unplanned"].includes(s.status) ? 1 : .35,
                    }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <button className="btn-ghost" style={{ width: 46, padding: "10px 0" }}
          onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">→</button>
      </div>

      <div className="stat3">
        <div className="kpi">
          <div className="l">Distance</div>
          <div className="v">{doneKm ? doneKm.toFixed(1) : "—"}</div>
          <div className="s">of {week?.km ?? "—"} km target</div>
        </div>
        <div className="kpi">
          <div className="l">Time</div>
          <div className="v">{doneMin ? `${Math.floor(doneMin / 60)}h ${doneMin % 60}m` : "—"}</div>
          <div className="s">logged this week</div>
        </div>
        <div className="kpi">
          <div className="l">Sessions</div>
          <div className="v">{doneCount}<span style={{ fontSize: 13, color: "var(--ink-40)" }}>/{plannedCount || doneCount}</span></div>
          <div className="s">{data.streaks[uid ?? ""] ?? 0} week streak</div>
        </div>
      </div>

      {/* ------------------------------------------------------ that day */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="rowsplit">
          <span className="caps">{fmt(dayDate, { weekday: "long", day: "numeric", month: "long" })}</span>
          <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
            {daySessions.length === 0 ? "Nothing planned"
              : `${daySessions.length} session${daySessions.length > 1 ? "s" : ""}`}
          </span>
        </div>

        {daySessions.length === 0 && (
          <p className="empty">Rest day, or nothing written yet.</p>
        )}

        {daySessions.map((s) => {
          const [cls, label] = statusTag(s);
          const km = s.distance_m ? Number(s.distance_m) / 1000 : null;
          return (
            <button key={s.id} className="sess"
              onClick={() => s.activity_id && openActivity(s.activity_id)}
              disabled={!s.activity_id}
              style={{ cursor: s.activity_id ? "pointer" : "default" }}>
              <span className="edge" style={{ background: kindColour(s.kind) }} />
              <span className="body">
                <span className="rowsplit">
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {s.slot && <span className="slot">{s.slot}</span>}
                    <span className="kindlab">{kindLabel(s.kind)}</span>
                  </span>
                  <span className={`tag ${cls}`}>{label}</span>
                </span>
                <span className="title">{s.title}</span>
                {s.target && <span className="detail">{s.target}</span>}
                <span className="metrics">
                  <span>{km ? `${km.toFixed(2)} km` : s.planned_minutes ? `${s.planned_minutes} min` : "—"}</span>
                  <span>{s.actual_minutes ? `${s.actual_minutes} min` : "not yet"}</span>
                  <span>{s.avg_hr ? `${Math.round(Number(s.avg_hr))} bpm` : ""}</span>
                </span>
                {s.coach_note && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: "var(--teal)",
                    background: "var(--teal-tint)", borderRadius: "var(--r-pill)",
                    padding: "4px 10px", alignSelf: "flex-start",
                  }}>{s.coach_note}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
