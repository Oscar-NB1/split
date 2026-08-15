"use client";
import { useState } from "react";
import { mmss } from "@/lib/prescription";

const TEAL = "#0A8FB0", LIME = "#C6FF5B", LIME_D = "#AAEA42", NAVY = "#12314D", NAVY_D = "#0E2740";
const TEAL_T2 = "var(--teal-tint2)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

/**
 * The race, segment by segment.
 *
 * Seeded from the plan's own numbers: run splits at race pace, stations at the
 * Heerenveen distribution the plan explicitly says to leave alone ("top 5.6% of
 * the field, twice — that lever is spent"), and a roxzone of 30 s per transition
 * against the 4:00 target. The notes are the doubles handover for each station,
 * which is the part you actually have to agree with Olivier in advance.
 */
type Row = { name: string; sec: number; kind: "Run" | "Station"; note: string };

const STRATEGY: Row[] = [
  { name: "Run 1", sec: 232, kind: "Run", note: "Hold back. Everyone goes out hot." },
  { name: "SkiErg 1000 m", sec: 165, kind: "Station", note: "Split 500/500. You start." },
  { name: "Run 2", sec: 236, kind: "Run", note: "" },
  { name: "Sled Push 50 m", sec: 130, kind: "Station", note: "Two pushes each, no rest between." },
  { name: "Run 3", sec: 238, kind: "Run", note: "" },
  { name: "Sled Pull 50 m", sec: 165, kind: "Station", note: "Your strongest station — take three pulls." },
  { name: "Run 4", sec: 238, kind: "Run", note: "" },
  { name: "Burpee Broad Jump 80 m", sec: 170, kind: "Station", note: "20 m blocks. Do not redline here." },
  { name: "Run 5", sec: 240, kind: "Run", note: "" },
  { name: "Row 1000 m", sec: 160, kind: "Station", note: "Split 500/500. Drop HR on the rest." },
  { name: "Run 6", sec: 240, kind: "Run", note: "" },
  { name: "Farmers Carry 200 m", sec: 85, kind: "Station", note: "One trip each. No set-downs." },
  { name: "Run 7", sec: 242, kind: "Run", note: "" },
  { name: "Sandbag Lunges 100 m", sec: 145, kind: "Station", note: "25 m blocks, swap every block." },
  { name: "Run 8", sec: 238, kind: "Run", note: "Empty the tank from 400 m out." },
  { name: "Wall Balls 100", sec: 180, kind: "Station", note: "Sets of 10. Never miss two in a row." },
];

/** The slow end of the stated 55:00–56:30 target. */
const TARGET = 56 * 60 + 30;

export default function Strategy() {
  const [rows, setRows] = useState<Row[]>(STRATEGY);
  const [roxEach, setRoxEach] = useState(30);
  const [exported, setExported] = useState(false);

  const total = rows.reduce((n, r) => n + r.sec, 0);
  const rox = roxEach * 8;
  const finish = total + rox;
  const inside = finish <= TARGET;
  const runTotal = rows.filter((r) => r.kind === "Run").reduce((n, r) => n + r.sec, 0);
  const stationTotal = rows.filter((r) => r.kind === "Station").reduce((n, r) => n + r.sec, 0);

  const bump = (i: number, by: number) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, sec: Math.max(60, r.sec + by) } : r)));

  // elapsed accumulates the transition after each station, as the race does
  let elapsed = 0;
  const withElapsed = rows.map((r) => {
    elapsed += r.sec;
    if (r.kind === "Station") elapsed += roxEach;
    return { ...r, elapsed };
  });

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>Race strategy · 28 Nov</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 5 }}>Hyrox Doubles</div>
      </div>

      <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: 16,
        display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>Projected finish</div>
            <div style={{ fontFamily: "var(--display)", fontSize: 34, fontWeight: 700,
              color: LIME, lineHeight: 1.05 }}>{mmss(finish)}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: "var(--r-pill)",
            padding: "6px 12px", background: inside ? TEAL_T2 : NAVY_D,
            color: inside ? TEAL : LIME }}>
            {inside ? "Inside the 56:30 target" : "Over the 56:30 target"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 18, borderTop: "1px solid rgba(255,255,255,.15)",
          paddingTop: 12 }}>
          {([["Runs", runTotal], ["Stations", stationTotal], ["Roxzone", rox]] as const).map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{mmss(v)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
        padding: "15px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase" }}>Roxzone</span>
            <span style={{ fontSize: 11, color: INK55 }}>
              8 transitions · {mmss(roxEach)} each
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setRoxEach((r) => Math.max(15, r - 5))} style={roxStep}>−</button>
            <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700,
              minWidth: 44, textAlign: "center" }}>{mmss(roxEach)}</span>
            <button onClick={() => setRoxEach((r) => r + 5)} style={roxStep}>+</button>
          </div>
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: roxEach > 32 ? NAVY_D : INK55 }}>
          {roxEach > 32
            ? "Heerenveen ran 0:38 average. Every 5 s here is 40 s on the clock."
            : "Inside the 4:00 roxzone target from your plan."}
        </div>
      </div>

      {withElapsed.map((r, i) => (
        <div key={r.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10,
            alignItems: "center", padding: "11px 13px", background: PAPER,
            border: `1px solid ${LINE}`,
            borderLeft: `3px solid ${r.kind === "Run" ? TEAL : LIME_D}`,
            borderRadius: "var(--r-card)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                textTransform: "uppercase", color: INK40 }}>{r.kind}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
              {r.note && (
                <span style={{ fontSize: 11, color: INK55, lineHeight: 1.4 }}>{r.note}</span>
              )}
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
                color: INK40 }}>elapsed {mmss(r.elapsed)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => bump(i, -5)} style={step} aria-label="Five seconds faster">−</button>
              <span style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 700,
                minWidth: 46, textAlign: "center" }}>{mmss(r.sec)}</span>
              <button onClick={() => bump(i, 5)} style={step} aria-label="Five seconds slower">+</button>
            </div>
          </div>
          {r.kind === "Station" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 13px 2px" }}>
              <span style={{ width: 3, height: 14, background: LINE, borderRadius: 2 }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: INK40 }}>
                Roxzone transition · {mmss(roxEach)}
              </span>
            </div>
          )}
        </div>
      ))}

      <button onClick={() => setExported(true)} style={{
        width: "100%", borderRadius: "var(--r-pill)", padding: 16, fontSize: 12, fontWeight: 800,
        letterSpacing: ".06em", textTransform: "uppercase",
        background: exported ? TEAL_T2 : LIME, color: exported ? TEAL : NAVY_D,
      }}>
        {exported ? "Sent to Garmin Forerunner 255" : "Export race plan to Garmin"}
      </button>
      <div style={{ fontSize: 11, color: INK40, lineHeight: 1.5 }}>
        Exports as a multisport workout with per-segment target times and lap alerts.
        Changes here are not saved yet.
      </div>
    </div>
  );
}

const roxStep: React.CSSProperties = {
  width: 34, height: 34, borderRadius: "50%", border: `1px solid ${LINE}`,
  background: OFF, color: "var(--ink)", fontSize: 15, fontWeight: 700, flex: "none",
};
const step: React.CSSProperties = {
  width: 30, height: 30, borderRadius: "50%", border: `1px solid ${LINE}`,
  background: OFF, color: "var(--ink)", fontSize: 14, fontWeight: 700, flex: "none",
};
