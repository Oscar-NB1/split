"use client";
import { useEffect, useState } from "react";
import { fmt, mondayOf, today } from "@/lib/dates";
import {
  BLOCK_START, GOAL, RACE_DATE, RACE_NAME, TEMPLATE_WEEK, WEEKS,
  daysToRace, kindColour, weekOf,
} from "@/lib/coach";
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
  data, monday, goStrategy, goProgram, openSession,
}: {
  data: WeekData | null; monday: string;
  goStrategy: () => void; goProgram: () => void; openSession: (s: Session) => void;
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
  const done = WEEKS.filter((w) => w.start < thisMonday).length;
  const totalKm = WEEKS.reduce((n, w) => n + w.km, 0);
  const left = daysToRace(now);
  const current = weekOf(thisMonday);

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

      {tab !== "Block" ? (
        <Form only={tab === "Form" ? "pace" : "volume"} />
      ) : (
        <>
          <div style={{ background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: 16,
            display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontFamily: "var(--display)", fontSize: 21, fontWeight: 700,
                lineHeight: 1.15, letterSpacing: "-.02em" }}>Hyrox doubles · 15 weeks</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: TEAL }}>{RACE_NAME}</span>
              <span style={{ fontSize: 12, color: INK55 }}>
                Target {GOAL} — from 1:00:45 Mechelen
              </span>
            </div>

            <div style={{ display: "flex", gap: 3 }}>
              {WEEKS.map((w) => (
                <span key={w.n} title={`Week ${w.n} · ${w.km} km`} style={{
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
                  {totalKm} km
                </div>
              </div>
            </div>

            <div style={{ borderTop: `1px dashed ${LINE}`, paddingTop: 12, display: "flex",
              alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-70)" }}>
                {left > 0 ? `${left} days to race day` : left === 0 ? "Race day" : "Block complete"}
              </span>
              <span style={{ fontSize: 10, color: INK40 }}>
                {fmt(BLOCK_START, { day: "numeric", month: "short" })} → {fmt(RACE_DATE, { day: "numeric", month: "short" })}
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: "Rearrange", sub: "workouts", go: goProgram },
              { label: "Form", sub: "vs plan", go: () => setTab("Form") },
              { label: "Volume", sub: "vs plan", go: () => setTab("Volume") },
              { label: "Race strategy", sub: "28 Nov", go: goStrategy },
            ].map((x) => (
              <button key={x.label} onClick={x.go} style={{
                display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
                padding: "13px 14px", color: "var(--ink)",
              }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{x.label}</span>
                  <span style={{ fontSize: 11, color: INK40 }}>{x.sub}</span>
                </span>
                <span style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: "50%",
                  background: OFF, color: TEAL, fontSize: 12, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>›</span>
              </button>
            ))}
          </div>

          {WEEKS.map((w, i) => {
            const isNow = w.start === thisMonday;
            const ran = logged[w.start];
            // the current week shows its real sessions; the others show the shape
            const rows = isNow && data
              ? data.sessions
                  .filter((s) => s.planned_date >= w.start && s.planned_date < WEEKS[i + 1]?.start)
                  .slice()
                  .sort((a, b) => a.planned_date.localeCompare(b.planned_date)
                    || Number(a.slot === "PM") - Number(b.slot === "PM"))
                  .map((s) => ({
                    dow: DAYS[(new Date(s.planned_date).getDay() + 6) % 7],
                    label: s.title, kind: s.kind,
                    done: s.status === "done" || s.status === "adjusted",
                    session: s,
                  }))
              : TEMPLATE_WEEK.map((t) => ({
                  dow: DAYS[t.dow], label: t.label, kind: t.kind, done: false,
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
                    {fmt(w.start, { day: "numeric", month: "short" })} – {fmt(WEEKS[i + 1]?.start ?? RACE_DATE, { day: "numeric", month: "short" })}
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
                  {w.km} km planned
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
