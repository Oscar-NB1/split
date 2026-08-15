"use client";
import { useMemo, useState } from "react";


/**
 * Race strategy: the target split across eight runs, eight stations and the
 * roxzone, adjustable segment by segment with the elapsed clock recomputed.
 *
 * Seeded from the plan's own numbers rather than from nothing: run pace 4:15,
 * the Heerenveen station distribution (which the plan explicitly says to leave
 * alone), and a roxzone target of 4:00 against the 5:20 actually run. That last
 * one is the plan's headline finding — 90–110 seconds available for zero
 * fitness cost — so the roxzone control is separate and prominent.
 */

const RUN = 255;   // 4:15/km, the plan's race-pace target
const STATIONS: [string, number][] = [
  ["1000m SkiErg", 225],
  ["50m Sled Push", 130],
  ["50m Sled Pull", 165],
  ["80m Burpee Broad Jump", 200],
  ["1000m Row", 160],
  ["200m Farmers Carry", 105],
  ["100m Sandbag Lunges", 175],
  ["100 Wall Balls", 180],
];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

export default function Strategy() {
  const [runs, setRuns] = useState<number[]>(() => Array(8).fill(RUN));
  const [stations, setStations] = useState<number[]>(() => STATIONS.map(([, s]) => s));
  const [rox, setRox] = useState(30); // seconds per transition; 8 of them

  const { total, runTotal, stationTotal, roxTotal, rows } = useMemo(() => {
    const runTotal = runs.reduce((a, b) => a + b, 0);
    const stationTotal = stations.reduce((a, b) => a + b, 0);
    const roxTotal = rox * 8;
    let elapsed = 0;
    const rows: { kind: string; name: string; time: number; elapsed: number; i: number; isRun: boolean }[] = [];
    for (let i = 0; i < 8; i++) {
      elapsed += runs[i];
      rows.push({ kind: `Run ${i + 1}`, name: "1 km", time: runs[i], elapsed, i, isRun: true });
      elapsed += rox;
      elapsed += stations[i];
      rows.push({ kind: `Station ${i + 1}`, name: STATIONS[i][0], time: stations[i], elapsed, i, isRun: false });
    }
    return { total: runTotal + stationTotal + roxTotal, runTotal, stationTotal, roxTotal, rows };
  }, [runs, stations, rox]);

  const step = (isRun: boolean, i: number, by: number) => {
    if (isRun) setRuns((r) => r.map((v, j) => (j === i ? Math.max(120, v + by) : v)));
    else setStations((s) => s.map((v, j) => (j === i ? Math.max(30, v + by) : v)));
  };

  const goal = 56 * 60 + 30; // the slow end of the 55:00–56:30 target
  const under = total <= goal;

  return (
    <div className="pad">
      <div>
        <div className="eyebrow">Race strategy · 28 Nov</div>
        <h1 className="h2" style={{ marginTop: 5 }}>Where the 56 minutes go.</h1>
      </div>

      <section className="vs" style={{ gap: 12 }}>
        <div className="rowsplit">
          <div>
            <div className="caps-sm" style={{ color: "rgba(255,255,255,.55)" }}>Projected finish</div>
            <div className="disp" style={{ fontSize: 34, color: "var(--lime)", lineHeight: 1.05 }}>{clock(total)}</div>
          </div>
          <span className="tag" style={{
            background: under ? "rgba(198,255,91,.18)" : "rgba(192,122,62,.24)",
            color: under ? "var(--lime)" : "#F0C08A",
          }}>
            {under ? "Inside target" : `${clock(total - goal)} over`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 18, borderTop: "1px solid rgba(255,255,255,.15)", paddingTop: 12 }}>
          {[["Runs", runTotal], ["Stations", stationTotal], ["Roxzone", roxTotal]].map(([l, v]) => (
            <div key={l as string}>
              <div className="caps-sm" style={{ color: "rgba(255,255,255,.55)" }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{clock(v as number)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The plan's single biggest free saving, so it gets its own control. */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="rowsplit">
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span className="caps" style={{ color: "var(--ink)" }}>Roxzone</span>
            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>per transition · 8 of them</span>
          </div>
          <Stepper value={clock(rox)} onMinus={() => setRox((r) => Math.max(10, r - 5))}
            onPlus={() => setRox((r) => r + 5)} />
        </div>
        <div style={{
          fontSize: 11, lineHeight: 1.5, borderRadius: 10, padding: "9px 11px",
          background: rox <= 30 ? "var(--teal-tint)" : "var(--cream)",
          color: rox <= 30 ? "var(--teal)" : "var(--ink-70)",
        }}>
          {rox <= 30
            ? `${clock(roxTotal)} total — at or inside the 4:00 target the plan sets.`
            : `${clock(roxTotal)} total. Heerenveen was 5:20 (top 27%) against top 5–13% everywhere else — 90–110 seconds available here for zero fitness cost.`}
        </div>
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.kind} className="card" style={{
            padding: "11px 13px", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 10,
            borderLeft: `3px solid ${r.isRun ? "var(--teal)" : "var(--navy)"}`,
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="caps-sm" style={{ color: r.isRun ? "var(--teal)" : "var(--ink-40)" }}>{r.kind}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-40)" }}>
                elapsed {clock(r.elapsed)}
              </span>
            </div>
            <Stepper value={clock(r.time)}
              onMinus={() => step(r.isRun, r.i, -5)} onPlus={() => step(r.isRun, r.i, 5)} />
          </div>
        ))}
      </div>

      <p className="empty">
        Runs seeded at 4:15/km and stations at the Heerenveen distribution, which the plan
        says to leave alone — the remaining time is in the roxzone and the running. Changes
        here are not saved yet.
      </p>
    </div>
  );
}

function Stepper({ value, onMinus, onPlus }: { value: string; onMinus: () => void; onPlus: () => void }) {
  const s = {
    width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--line)",
    fontSize: 15, lineHeight: 1, color: "var(--ink-55)", flex: "none",
  } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button style={s} onClick={onMinus} aria-label="Less">−</button>
      <span className="disp mono" style={{ fontSize: 17, minWidth: 46, textAlign: "center" }}>{value}</span>
      <button style={s} onClick={onPlus} aria-label="More">+</button>
    </div>
  );
}
