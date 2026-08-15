"use client";
import { useEffect, useState } from "react";
import { fmt, mondayOf, today } from "@/lib/dates";
import {
  BLOCK_START, GOAL, RACE_DATE, RACE_NAME, WEEKS, daysToRace, weekIntent,
} from "@/lib/coach";

/**
 * The block at a glance: where you are in fifteen weeks, and what each week is
 * for. Volume bars are the plan's targets; the logged bar on top is what
 * actually happened, so a week that was written 46 km and run 22 reads as a gap
 * rather than as a success.
 */
export default function Plan({ monday, goStrategy, goProgram, goForm }: {
  monday: string; goStrategy: () => void; goProgram: () => void; goForm: () => void;
}) {
  const [actual, setActual] = useState<Record<string, number>>({});

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
      setActual(by);
    });
  }, []);

  const now = today();
  const current = WEEKS.find((w) => w.start === mondayOf(now));
  const done = WEEKS.filter((w) => w.start < mondayOf(now)).length;
  const totalKm = WEEKS.reduce((n, w) => n + w.km, 0);
  const left = daysToRace(now);
  const maxKm = Math.max(...WEEKS.map((w) => w.km));

  return (
    <div className="pad">
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span className="disp" style={{ fontSize: 21 }}>Hyrox doubles · 15 weeks</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--teal)" }}>{RACE_NAME}</span>
          <span className="muted">Target {GOAL} — from 1:00:45 Mechelen</span>
        </div>

        <div style={{ display: "flex", gap: 3 }}>
          {WEEKS.map((w) => (
            <span key={w.n} title={`Week ${w.n}`} style={{
              flex: 1, height: 8, borderRadius: 2,
              background: w.start < mondayOf(now) ? "var(--teal)"
                : w.start === mondayOf(now) ? "var(--lime)" : "var(--off)",
            }} />
          ))}
        </div>

        <div className="rowsplit">
          <div>
            <div className="caps-sm">Weeks done</div>
            <div className="disp" style={{ fontSize: 22 }}>{done}<span style={{ fontSize: 13, color: "var(--ink-40)" }}>/15</span></div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="caps-sm">Planned distance</div>
            <div className="disp" style={{ fontSize: 22 }}>{totalKm} km</div>
          </div>
        </div>

        <div className="rowsplit" style={{ borderTop: "1px dashed var(--line)", paddingTop: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-70)" }}>
            {left > 0 ? `${left} days to race day` : left === 0 ? "Race day" : "Block complete"}
          </span>
          <span style={{ fontSize: 10, color: "var(--ink-40)" }}>
            {fmt(BLOCK_START, { day: "numeric", month: "short" })} → {fmt(RACE_DATE, { day: "numeric", month: "short" })}
          </span>
        </div>
      </section>

      <button className="card" onClick={goForm}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Form</span>
          <span style={{ fontSize: 11, color: "var(--ink-40)" }}>Pace and volume against the plan</span>
        </span>
        <span style={{ color: "var(--teal)" }}>›</span>
      </button>

      <button className="card" onClick={goProgram}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Edit this week</span>
          <span style={{ fontSize: 11, color: "var(--ink-40)" }}>Move, add and re-slot sessions</span>
        </span>
        <span style={{ color: "var(--teal)" }}>›</span>
      </button>

      <button className="card" onClick={goStrategy}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Race strategy</span>
          <span style={{ fontSize: 11, color: "var(--ink-40)" }}>Split the target across runs and stations</span>
        </span>
        <span style={{ color: "var(--teal)" }}>›</span>
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="caps">The fifteen weeks</span>
        {WEEKS.map((w) => {
          const isNow = w.start === mondayOf(now);
          const ran = actual[w.start];
          const intent = weekIntent(w.n);
          return (
            <div className="card" key={w.n} style={{
              padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8,
              borderColor: isNow ? "var(--teal)" : "var(--line)",
            }}>
              <div className="rowsplit">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="caps-sm" style={{ color: isNow ? "var(--teal)" : "var(--ink-40)" }}>
                    Week {w.n} · {fmt(w.start, { day: "numeric", month: "short" })}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{intent.phase}</span>
                </div>
                <span className="disp" style={{ fontSize: 19 }}>{w.km}<span style={{ fontSize: 11, color: "var(--ink-40)" }}> km</span></span>
              </div>

              <div style={{ height: 8, background: "var(--off)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
                <i style={{ position: "absolute", inset: 0, width: `${(w.km / maxKm) * 100}%`, background: "var(--teal-tint2)", display: "block" }} />
                {ran != null && (
                  <i style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${Math.min(100, (ran / maxKm) * 100)}%`, background: "var(--teal)", display: "block" }} />
                )}
              </div>
              {ran != null && (
                <span style={{ fontSize: 11, color: ran >= w.km * .9 ? "var(--teal)" : "var(--ink-55)" }}>
                  {ran.toFixed(1)} km logged{ran < w.km * .9 ? ` · ${(w.km - ran).toFixed(1)} short` : ""}
                </span>
              )}
              {w.note && (
                <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ink-70)",
                  background: "var(--cream)", borderRadius: 10, padding: "9px 11px" }}>{w.note}</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="empty">
        Volume targets and week intent come from the plan document. Logged distance is
        counted from Strava activities in that calendar week.
      </p>
      {current && <p className="empty">You are in week {current.n}.</p>}
    </div>
  );
}
