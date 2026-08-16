"use client";
import { useEffect, useState } from "react";
import { addDays, dow, fmt, today } from "@/lib/dates";
import { kindColour, kindLabel, weekDates } from "@/lib/coach";
import { beforeBlock as isBefore, intentFor, weekOf } from "@/lib/block";
import { prescribedPace } from "@/lib/signals";
import type { Session, User, WeekData } from "./Shell";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TEAL = "#0A8FB0", LIME = "#C6FF5B", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

/** PM is the loud one: a second session in a day is worth noticing. */
const slotChip = (slot: string | null | undefined): React.CSSProperties => ({
  fontSize: 9, fontWeight: 800, letterSpacing: ".08em", padding: "3px 7px",
  borderRadius: "var(--r-pill)",
  background: slot === "PM" ? NAVY : OFF,
  color: slot === "PM" ? LIME : INK55,
});

const pc = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;

/**
 * The three numbers under a session card.
 *
 * Planned and completed sessions say different things: before, the useful figures
 * are the prescription and the alarm; after, they are what actually happened.
 */
function metrics(s: Session): [string, string, string] {
  const done = ["done", "adjusted", "unplanned"].includes(s.status);
  const pace = prescribedPace(s.title);
  if (s.kind === "strength") {
    return [`${s.planned_minutes ?? 40} min`, done ? "logged" : "3 lifts", ""];
  }
  const km = s.distance_m ? Number(s.distance_m) / 1000 : null;
  if (!s.kind.startsWith("run")) {
    return [
      s.actual_minutes ? `${s.actual_minutes} min` : `${s.planned_minutes ?? "—"} min`,
      done && s.avg_hr ? `avg ${Math.round(Number(s.avg_hr))} bpm` : "",
      "",
    ];
  }
  return [
    km ? `${km.toFixed(2)} km` : `${s.planned_minutes ?? "—"} min`,
    done && km && s.actual_minutes
      ? `${pc((s.actual_minutes * 60) / km)} /km`
      : pace ? `${pc(pace)} /km prescribed` : "",
    done && s.avg_hr ? `HR ${Math.round(Number(s.avg_hr))}` : pace ? `alert ${pc(pace - 3)}` : "",
  ];
}

export default function Week({
  data, me, monday, openActivity, openSession, reload, openWeek, coaching,
}: {
  data: WeekData | null; me: User;
  monday: string;
  /** the athlete being coached, when the profile has opened someone else's week */
  coaching: string | null;
  openActivity: (id: string) => void; openSession: (s: Session) => void; reload: () => void;
  /** the whole week — the overview card is the way into it */
  openWeek: () => void;
}) {
  const [day, setDay] = useState(() => dow(today()));

  useEffect(() => {
    const t = today();
    setDay(t >= monday && t < addDays(monday, 7) ? dow(t) : 0);
  }, [monday]);

  if (!data) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  const uid = coaching ?? me.id;
  const all = [...data.sessions, ...data.unplanned].filter((s) => s.user_id === uid);
  const dates = weekDates(monday);
  // Someone with no plan of their own is not "before the block" — there is no
  // block. Showing the other athlete's rebuild weeks and 55:00 goal as hers was
  // the bug this closes.
  const block = data?.block ?? null;
  const week = weekOf(block, monday);
  const intent = week ? intentFor(block, week.n) : null;
  const beforeBlock = isBefore(block, monday);

  const dayList = all
    .filter((s) => s.planned_date === dates[day])
    .sort((a, b) => Number(a.slot === "PM") - Number(b.slot === "PM"));

  /**
   * How much of this plan is measured rather than assumed.
   *
   * Shown permanently rather than as a notification, because it is what explains
   * cautious numbers without anyone having to ask — and it makes the upgrade
   * obvious. Absent for a plan written by hand, which predates the state model.
   */
  const state = !block?.plan_state ? null : {
    estimated: {
      label: "Estimated", bg: OFF, fg: INK55,
      why: "Volume is held 15% low and the ramp capped. Run the benchmark and it comes up.",
    },
    awaiting: {
      label: "Awaiting baseline", bg: "var(--teal-tint2)", fg: "var(--teal)",
      why: "The benchmark is session 1. Every number rebuilds from its result.",
    },
    measured: {
      label: "Measured", bg: LIME, fg: "var(--on-lime)",
      why: "Paces, limiter and roxzone all come from real numbers.",
    },
  }[block.plan_state];

  const kmDone = all.filter((s) => ["done", "adjusted", "unplanned"].includes(s.status))
    .reduce((n, s) => n + (Number(s.distance_m) || 0), 0) / 1000;
  const doneCount = all.filter((s) => s.status === "done").length;

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* The day strip, pinned under the header. What you need first is first:
          the reordering the design asks for is sequence, not styling. */}
      <div style={{ margin: "-18px -18px 0", padding: "12px 18px", background: PAPER,
        borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
          {dates.map((d, i) => {
            const has = all.filter((s) => s.planned_date === d);
            const active = i === day;
            return (
              <button key={d} onClick={() => setDay(i)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "8px 0 7px", borderRadius: 12,
                background: active ? NAVY : "transparent", color: active ? "#fff" : "var(--ink)",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em",
                  color: active ? "rgba(255,255,255,.7)" : d === today() ? "var(--teal)" : INK40 }}>
                  {DAYS[i]}
                </span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{fmt(d, { day: "numeric" })}</span>
                <span style={{ display: "flex", gap: 2, height: 5, alignItems: "center" }}>
                  {has.slice(0, 3).map((s) => (
                    <span key={s.id} style={{ width: 5, height: 5, borderRadius: "50%",
                      background: active ? LIME : kindColour(s.kind) }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ----------------------------------------------------------- the day */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: INK55 }}>
            {fmt(dates[day], { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <span style={{ fontSize: 11, color: INK55 }}>
            {dayList.length === 0 ? "Rest day" : `${dayList.length} session${dayList.length > 1 ? "s" : ""}`}
          </span>
        </div>

        {dayList.length === 0 && <p className="empty">Nothing written for this day.</p>}

        {dayList.map((s) => {
          const [m1, m2, m3] = metrics(s);
          const isDone = s.status === "done" || s.status === "unplanned";
          return (
            <button key={s.id} onClick={() => openSession(s)} style={{
              textAlign: "left", width: "100%", padding: 0, background: PAPER,
              border: `1px solid ${LINE}`, borderRadius: "var(--r-card)", overflow: "hidden",
              display: "flex", alignItems: "stretch", color: "var(--ink)",
            }}>
              <span style={{ width: 4, flex: "none", alignSelf: "stretch",
                background: kindColour(s.kind) }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7,
                padding: "14px 14px 13px 16px" }}>
                <div style={{ display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {s.slot && <span style={slotChip(s.slot)}>{s.slot}</span>}
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
                      textTransform: "uppercase", color: INK55 }}>{kindLabel(s.kind)}</span>
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                    textTransform: "uppercase", padding: "4px 9px", borderRadius: "var(--r-pill)",
                    background: isDone ? "var(--teal-tint2)" : OFF,
                    color: isDone ? TEAL : INK55,
                  }}>
                    {s.status === "done" ? "Completed" : s.status === "adjusted" ? "Adjusted"
                      : s.status === "skipped" ? "Skipped"
                      : s.status === "unplanned" ? "Off plan" : "Planned"}
                  </span>
                </div>
                <div style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700,
                  lineHeight: 1.2, letterSpacing: "-.01em" }}>{s.title}</div>
                {s.target && (
                  <div style={{ fontSize: 12, color: INK55, lineHeight: 1.45 }}>
                    {s.target.split("\n")[0].replace(/^[-•*]\s*/, "")}
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, fontSize: 12, fontWeight: 600 }}>
                  <span>{m1}</span>
                  <span style={{ color: INK55, fontWeight: 500 }}>{m2}</span>
                  <span style={{ color: INK55, fontWeight: 500 }}>{m3}</span>
                </div>
                {s.significance && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: NAVY,
                    background: "var(--teal-tint2)", borderRadius: "var(--r-pill)",
                    padding: "4px 10px", alignSelf: "flex-start", textTransform: "capitalize" }}>
                    {s.significance}
                  </span>
                )}
                {/hyrox|race|sim/i.test(s.title) && s.significance && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6,
                    alignSelf: "flex-start", fontSize: 11, fontWeight: 600, color: INK55 }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", background: NAVY,
                      color: LIME, fontSize: 8, fontWeight: 800, display: "flex",
                      alignItems: "center", justifyContent: "center" }}>2</span>
                    With Olivier
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* The week at a glance, and the way into the whole of it. Two bars rather
          than three tiles: sessions done and distance run are the week's shape,
          and the third tile was a metric nobody navigated by. */}
      <button onClick={openWeek} style={{
        width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "15px 16px", color: "var(--ink)",
        display: "flex", flexDirection: "column", gap: 11,
      }}>
        <span style={{ display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {week ? `Week ${week.n} · ${week.km.toFixed(1)} km target` : "This week"}
          </span>
          <span style={{ fontSize: 13, color: INK40 }}>›</span>
        </span>
        <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <span style={{ height: 5, background: OFF, borderRadius: 3, overflow: "hidden" }}>
            <span style={{ display: "block", height: 5, background: "var(--teal)",
              width: `${all.length ? Math.round((doneCount / all.length) * 100) : 0}%` }} />
          </span>
          <span style={{ height: 5, background: OFF, borderRadius: 3, overflow: "hidden" }}>
            <span style={{ display: "block", height: 5, background: LIME,
              width: `${week?.km ? Math.min(100, Math.round((kmDone / week.km) * 100)) : 0}%` }} />
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 10, fontSize: 12, fontWeight: 600 }}>
          <span>{doneCount}/{all.length} sessions</span>
          <span>{kmDone.toFixed(kmDone < 10 ? 1 : 0)}{week?.km ? ` / ${week.km}` : ""} km</span>
        </span>
      </button>

      {/* The block, as context rather than the lead — and the plan-state chip,
          which is what explains cautious numbers without a notification. */}
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16,
        display: "flex", flexDirection: "column", gap: 7 }}>
        {state && (
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
              textTransform: "uppercase", borderRadius: "var(--r-pill)", padding: "4px 10px",
              flex: "none", background: state.bg, color: state.fg }}>{state.label}</span>
            <span style={{ fontSize: 11, lineHeight: 1.45, color: INK55 }}>{state.why}</span>
          </div>
        )}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>
          {intent ? intent.phase : !block ? "No block" : beforeBlock ? "Before the block" : "Off block"}
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>
          {week ? `${week.km.toFixed(1)} km, and two hard days.`
            : !block ? "No block on your account."
            : beforeBlock ? "The block starts Monday." : "Off block."}
        </div>
        <div style={{ fontSize: 12, color: INK55, lineHeight: 1.5 }}>
          {week?.note || (!block
            ? "Anything you log still appears here, and still counts in the head-to-head."
            : beforeBlock
            ? `${block.weeks.length} weeks to ${block.goal_label ?? block.race_name ?? "race day"}. Week 1 is ${block.weeks[0]?.km ?? 0} km — bought with consistency, not intensity.`
            : "Tuesday and Saturday are the week. Everything else supports them.")}
        </div>
      </div>

      {/* ------------------------------------------- what the week is for */}
      {intent && (
        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: 16,
          display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)" }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "var(--teal)" }}>{intent.phase}</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-70)" }}>{intent.purpose}</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7,
            borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: INK55 }}>Protect these</span>
            {intent.protect.map((p) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 9,
                background: "var(--teal-tint)", border: "1px solid var(--teal-tint2)",
                borderRadius: 10, padding: "10px 12px" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0A8FB0"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8,
            borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            {([["Drop first", intent.sacrifice], ["Watch for", intent.watch]] as const).map(([k, v]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "78px 1fr",
                gap: 10, alignItems: "start" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                  textTransform: "uppercase", whiteSpace: "nowrap", color: INK40 }}>{k}</span>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-70)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

const arrow: React.CSSProperties = {
  width: 40, height: 40, flex: "none", borderRadius: "var(--r-pill)",
  border: `1px solid ${LINE}`, background: PAPER, color: INK55, fontSize: 15,
};
