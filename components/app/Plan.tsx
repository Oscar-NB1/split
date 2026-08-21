"use client";
import { useEffect, useState } from "react";
import { fmt, mondayOf, today } from "@/lib/dates";
import {
  kindColour,
} from "@/lib/coach";
import { daysToRace, weekOf } from "@/lib/block";
import Form from "./Form";
import type { Session, WeekData } from "./Shell";

const TEAL = "#0A8FB0", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)", CREAM = "var(--cream)";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Tab = "Block" | "Form" | "Volume";

/**
 * The block, and whether it is working.
 *
 * Three tabs, as the design has them. Block is the fifteen weeks and what is in
 * them; Form is pace against prescription; Volume is kilometres against plan.
 * Form and Volume are kept apart because the diagnosis behind this block is that
 * they failed separately — running fell from 40–50 km/week to 14–20 AND quality
 * sessions were run 3:39–4:09 against a prescribed 4:15–4:30. One combined score
 * would hide exactly the thing worth seeing.
 */
export default function Plan({
  data, monday, uid, goStrategy, openSession,
}: {
  data: WeekData | null; monday: string;
  /*
   * Whose block this is. `/api/week` is household-scoped — it returns every athlete's
   * sessions for the week and leaves the filtering to the screen — so without this the
   * week card listed three people's training under one athlete's header. Week and Program
   * both already did this; only this screen did not.
   */
  uid: string;
  goStrategy: () => void; openSession: (s: Session) => void;
}) {
  const [tab, setTab] = useState<Tab>("Block");
  const [logged, setLogged] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/past").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      const by: Record<string, number> = {};
      for (const a of j.activities as { local_date: string; distance_m: number | null }[]) {
        if (!a.distance_m) continue;
        const wk = mondayOf(a.local_date);
        by[wk] = (by[wk] ?? 0) + a.distance_m / 1000;
      }
      setLogged(by);
    });
  }, []);

  const now = today();
  const thisMonday = mondayOf(now);
  const block = data?.block ?? null;
  const WEEKS = block?.weeks ?? [];
  const done = WEEKS.filter((w) => w.start < thisMonday).length;
  const totalKm = WEEKS.reduce((n, w) => n + w.km, 0);
  const left = daysToRace(block, now);
  /**
   * Where the numbers in this plan came from.
   *
   * Not what the athlete declined. A benchmark is only mentioned where one is
   * scheduled or has been run — everyone else was being told their paces were
   * estimates and offered a test they had already said no to.
   */
  const state = !block?.plan_state ? null : ({
    described: { label: "From your answers", bg: OFF, fg: INK55,
      why: "No times on file yet, so targets are efforts and heart-rate zones rather than paces." },
    from_time: { label: "From your 5 km", bg: "var(--teal-tint2)", fg: TEAL,
      why: "Every pace here is built from the 5 km time you gave, and the volume from the weeks you have actually run." },
    awaiting: { label: "Awaiting baseline", bg: "var(--teal-tint2)", fg: TEAL,
      why: "The benchmark is session 1; the numbers rebuild from it." },
    measured: { label: "Measured", bg: "var(--lime)", fg: "var(--on-lime)",
      why: "Paces, limiter and roxzone come from real numbers." },
    // Plans written before the states meant this. Nothing new is stored as it.
    estimated: { label: "From your answers", bg: OFF, fg: INK55,
      why: "Built from the answers you gave: the volume from weeks you have run, the paces from the time you gave." },
  } as Record<string, { label: string; bg: string; fg: string; why: string }>)[block.plan_state];
  const current = weekOf(block, thisMonday);

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 3, background: OFF,
        borderRadius: "var(--r-pill)", padding: 3 }}>
        {(["Block", "Form", "Volume"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, borderRadius: "var(--r-pill)", padding: "9px 12px", fontSize: 11,
            fontWeight: 700, background: tab === t ? NAVY : "transparent",
            color: tab === t ? "#fff" : INK55,
          }}>{t}</button>
        ))}
      </div>

      {!block ? (
        // The block is not this athlete's, so it is not shown as though it were.
        // Pace and volume against plan are equally meaningless without one.
        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: 18,
          display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700,
            lineHeight: 1.2, letterSpacing: "-.02em" }}>No block on your account.</span>
          <span style={{ fontSize: 12, color: INK55, lineHeight: 1.55 }}>
            The fifteen-week Hyrox block belongs to the other athlete, so it is not shown
            here as if it were yours. Everything you log still appears on the week and
            still counts in the head-to-head.
          </span>
        </div>
      ) : tab !== "Block" ? (
        <Form only={tab === "Form" ? "pace" : "volume"} />
      ) : (
        <>
          <div style={{ background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: 16,
            display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontFamily: "var(--display)", fontSize: 21, fontWeight: 700,
                lineHeight: 1.15, letterSpacing: "-.02em" }}>
                {/* The name already ends in "· 15 weeks"; appending the count
                    again produced "Hyrox doubles · 15 weeks · 15 weeks". */}
                {/\d+\s*weeks/.test(block.name)
                  ? block.name : `${block.name} · ${WEEKS.length} weeks`}
              </span>
              {block.race_name && (
                <span style={{ fontSize: 12, fontWeight: 600, color: TEAL }}>{block.race_name}</span>
              )}
              <span style={{ fontSize: 12, color: INK55 }}>
                {block.goal_label ? `Target ${block.goal_label}` : "No target time set yet"}
              </span>
              {state && (
                <span style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
                    textTransform: "uppercase", borderRadius: "var(--r-pill)",
                    padding: "4px 10px", flex: "none",
                    background: state.bg, color: state.fg }}>{state.label}</span>
                  <span style={{ fontSize: 11, lineHeight: 1.45, color: INK55 }}>{state.why}</span>
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 3 }}>
              {WEEKS.map((w) => (
                <span key={w.n} title={`Week ${w.n} · ${w.km.toFixed(1)} km`} style={{
                  flex: 1, height: 8, borderRadius: 2,
                  background: w.start < thisMonday ? TEAL
                    : w.start === thisMonday ? "#C6FF5B" : "rgba(18,49,77,.12)",
                }} />
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                  textTransform: "uppercase", color: INK55 }}>Weeks done</div>
                <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700 }}>
                  {done}<span style={{ fontSize: 13, color: INK40 }}>/15</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                  textTransform: "uppercase", color: INK55 }}>Total distance</div>
                <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700 }}>
                  {Math.round(totalKm)} km
                </div>
              </div>
            </div>

            {/* The tiles came out — Rearrange is the calendar icon in the week
                header, Form and Volume are the tabs above, coaching moved to the
                profile. The race countdown became the way into the strategy,
                which is the one thing that had nowhere else to go. */}
            <button onClick={goStrategy} style={{ width: "100%", textAlign: "left",
              background: "none", padding: 0, color: "var(--ink)",
              borderTop: `1px dashed ${LINE}`, borderLeft: 0, borderRight: 0, borderBottom: 0,
              paddingTop: 12, display: "flex",
              alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-70)" }}>
                {left == null ? `${WEEKS.length} weeks, no race date set`
                  : left > 0 ? `${left} days to race day`
                  : left === 0 ? "Race day" : "Block complete"}
              </span>
              <span style={{ fontSize: 10, color: INK40 }}>
                {fmt(block.start, { day: "numeric", month: "short" })} → {fmt(block.race_date ?? block.end, { day: "numeric", month: "short" })}
                {" ›"}
              </span>
            </button>
          </div>

          {WEEKS.map((w, i) => {
            const isNow = w.start === thisMonday;
            const ran = logged[w.start];
            /*
             * The current week shows what happened; every other week shows what the
             * plan holds for it.
             *
             * The fallback used to be a hardcoded example week — "Strength A",
             * "Key session", "Hyrox intervals" — so fourteen of fifteen weeks
             * displayed sessions no generator had ever written. The plan carries
             * its own shape for every week; this reads that.
             */
            const rows = isNow && data
              ? data.sessions
                  .filter((s) => s.user_id === uid
                    && s.planned_date >= w.start && s.planned_date < WEEKS[i + 1]?.start)
                  .slice()
                  .sort((a, b) => a.planned_date.localeCompare(b.planned_date)
                    || Number(a.slot === "PM") - Number(b.slot === "PM"))
                  .map((s) => ({
                    dow: DAYS[(new Date(s.planned_date).getDay() + 6) % 7],
                    label: s.title, kind: s.kind,
                    done: s.status === "done" || s.status === "adjusted",
                    session: s,
                  }))
              : w.shape
                  .slice()
                  .sort((a, b) => a.day - b.day
                    || Number(a.slot === "PM") - Number(b.slot === "PM"))
                  .map((d) => ({
                    dow: DAYS[d.day] ?? "", label: d.title, kind: d.kind, done: false,
                    session: null as Session | null,
                  }));

            return (
              <div key={w.n} style={{ display: "flex", flexDirection: "column", gap: 12,
                padding: "15px 16px", background: PAPER,
                border: isNow ? `2px solid ${NAVY}` : `1px solid ${LINE}`,
                borderRadius: "var(--r-card)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
                    textTransform: "uppercase", color: INK40 }}>
                    {fmt(w.start, { day: "numeric", month: "short" })} – {fmt(WEEKS[i + 1]?.start ?? block.race_date ?? block.end, { day: "numeric", month: "short" })}
                  </span>
                  <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700 }}>
                    Week {w.n}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 4 }}>
                  {rows.map((r, j) => (
                    <span key={j} style={{ flex: 1, height: 4, borderRadius: 2,
                      background: r.done ? TEAL : "rgba(18,49,77,.12)" }} />
                  ))}
                </div>

                <span style={{ fontSize: 12, color: INK55 }}>
                  {w.km.toFixed(1)} km planned
                  {/* The classes are the variable: their running is a bonus on top of the
                      week's own number, not part of it. */}
                  {w.class_km > 0 && ` +${w.class_km.toFixed(1)} in the classes`}
                  {ran != null && ` · ${ran.toFixed(1)} logged`}
                  {ran != null && ran < w.km * .9 && ` · ${(w.km - ran).toFixed(1)} short`}
                </span>

                {w.note && (
                  <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ink-70)",
                    background: CREAM, borderRadius: 10, padding: "9px 11px" }}>{w.note}</span>
                )}

                <div style={{ display: "flex", flexDirection: "column" }}>
                  {rows.map((r, j) => (
                    <button key={j} onClick={() => r.session && openSession(r.session)}
                      style={{ display: "grid", gridTemplateColumns: "12px 34px 1fr", gap: 10,
                        alignItems: "center", width: "100%", textAlign: "left",
                        padding: "5px 0", color: "var(--ink)",
                        cursor: r.session ? "pointer" : "default" }}>
                      <span style={{ width: 12, height: 12, borderRadius: 4,
                        background: kindColour(r.kind), opacity: r.done ? 1 : .45 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: INK40 }}>{r.dow}</span>
                      <span style={{ fontSize: 13, fontWeight: r.done ? 600 : 500 }}>{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <p className="empty">
            Volume targets and week intent come from the plan document. Only three weeks are
            written as sessions at a time — anything beyond that stays derived, so changing a
            rule re-renders the future rather than rewriting history.
          </p>
          {current && <p className="empty">You are in week {current.n}.</p>}
        </>
      )}
    </div>
  );
}
