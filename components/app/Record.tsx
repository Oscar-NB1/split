"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms } from "@/lib/analysis";

const TEAL = "#0A8FB0";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

const PODIUM = [
  { face: "radial-gradient(circle at 32% 28%, #FFF0B8 0%, #E8C051 45%, #B08514 100%)", ink: "#4A3705", ring: "#B08514", name: "Gold" },
  { face: "radial-gradient(circle at 32% 28%, #FFFFFF 0%, #C9D4DD 45%, #8B9BA8 100%)", ink: "#33414D", ring: "#8B9BA8", name: "Silver" },
  { face: "radial-gradient(circle at 32% 28%, #E8B98C 0%, #C07A3E 45%, #8A4E22 100%)", ink: "#3D2110", ring: "#8A4E22", name: "Bronze" },
];

type Row = { seconds: number; id: string; name: string; local_date: string };

/**
 * Every ranked effort at one distance, best first.
 *
 * The top three take gold, silver and bronze — which is the design's conceit and
 * a good one: a personal best is not one number, it is the top of a list, and
 * seeing the fourth-best tells you whether the best was a fluke or a level.
 */
export default function Record({
  dist, openActivity,
}: { dist: string; openActivity: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/awards").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      const rec = j.records.find((x: { dist: string }) => x.dist === dist);
      setRows(rec?.rows ?? []);
      setNote(rec?.note ?? "");
    });
  }, [dist]);

  if (!rows) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;
  if (rows.length === 0) {
    return <div style={{ padding: 18 }}><p className="empty">Nothing recorded at {dist} yet.</p></div>;
  }
  const best = rows[0];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "20px 18px 22px",
        background: "linear-gradient(165deg, rgba(232,192,81,.22) 0%, var(--off) 78%)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em",
          textTransform: "uppercase", color: "var(--teal)" }}>Personal record</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 27, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 7 }}>{dist}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 14 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 40, fontWeight: 700,
            lineHeight: 1 }}>{hms(best.seconds)}</span>
          <span style={{ fontSize: 12, color: INK55 }}>
            {rows.length} ranked effort{rows.length > 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ fontSize: 11, color: INK40, marginTop: 8 }}>{note}</div>
      </div>

      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => {
          const p = PODIUM[i];
          return (
            <button key={r.id + i} onClick={() => openActivity(r.id)} style={{
              display: "flex", alignItems: "center", gap: 13, width: "100%", textAlign: "left",
              background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
              padding: "12px 14px", color: "var(--ink)",
            }}>
              <span style={{ width: 34, height: 34, flex: "none", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 800,
                background: p ? p.face : OFF, color: p ? p.ink : INK40,
                boxShadow: p ? `0 0 0 1.5px ${p.ring}` : "none" }}>{i + 1}</span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".12em",
                  textTransform: "uppercase", color: p ? p.ink : INK40 }}>
                  {p ? p.name : `#${i + 1}`}
                </span>
                <span style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>
                  {hms(r.seconds)}
                </span>
                <span style={{ fontSize: 11, color: INK55 }}>
                  {r.name} · {fmt(r.local_date, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
                textTransform: "uppercase", color: TEAL }}>Session ›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
