"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms } from "@/lib/analysis";

const FACE: Record<string, string> = {
  Bronze: "radial-gradient(circle at 32% 28%, #E8B98C 0%, #C07A3E 45%, #8A4E22 100%)",
  Silver: "radial-gradient(circle at 32% 28%, #FFFFFF 0%, #C9D4DD 45%, #8B9BA8 100%)",
  Gold: "radial-gradient(circle at 32% 28%, #FFF0B8 0%, #E8C051 45%, #B08514 100%)",
  Platinum: "radial-gradient(circle at 32% 28%, #FFFFFF 0%, #D9F2F8 40%, #8FC4D4 100%)",
};
const INK: Record<string, string> = {
  Bronze: "#3D2110", Silver: "#33414D", Gold: "#4A3705", Platinum: "#0E3A47",
};

type Medal = {
  cat: string; unit: string; value: number; icon: string;
  tier: number; tierName: string | null; next?: number; pct: number;
};
type RecRow = { seconds: number; id: string; name: string; local_date: string };
type Data = {
  totals: { km: number; sessions: number; hours: number; races: number; since: string | null };
  medals: Medal[];
  records: { dist: string; note: string; rows: RecRow[] }[];
};

export default function Awards({ meId, openActivity }: { meId: string; openActivity: (id: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/awards").then(async (r) => {
      if (r.status === 401) { location.href = "/login"; return; }
      if (r.ok) setD(await r.json());
    });
  }, [meId]);

  if (!d) return <div className="pad"><p className="empty">Loading…</p></div>;
  // Counts stay counts: "0.0 finishes" and "next at 1.0 finishes" read as a
  // rounding artefact rather than as a number of races.
  const fmtNum = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString()
    : n >= 1000 ? Math.round(n).toLocaleString()
    : n.toFixed(1);

  return (
    <div className="pad">
      <div>
        <div className="eyebrow">Accomplishments</div>
        <h1 className="h2" style={{ marginTop: 5 }}>Everything you have banked.</h1>
        {d.totals.since && (
          <p className="muted" style={{ marginTop: 6 }}>
            Since {fmt(d.totals.since, { month: "long", year: "numeric" })}
          </p>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Total l="Distance" v={fmtNum(d.totals.km)} u="km" />
        <Total l="Sessions" v={String(d.totals.sessions)} u="logged" />
        <Total l="Moving" v={fmtNum(d.totals.hours)} u="hours" />
        <Total l="Hyrox" v={String(d.totals.races)} u="races imported" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="caps">Medal case</span>
        <div className="medalgrid">
          {d.medals.map((m) => (
            <div className="medal" key={m.cat}>
              <span className="disc" style={{
                background: m.tierName ? FACE[m.tierName] : "var(--off)",
                color: m.tierName ? INK[m.tierName] : "var(--ink-40)",
                boxShadow: m.tierName ? `0 0 0 2px ${m.tierName === "Platinum" ? "#0A8FB0" : "rgba(18,49,77,.15)"}` : "none",
              }}>{m.icon}</span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase",
                color: m.tierName ? "var(--ink-70)" : "var(--ink-40)" }}>
                {m.tierName ?? "Not yet"}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{m.cat}</span>
              <span className="disp" style={{ fontSize: 15 }}>{fmtNum(m.value)} <span style={{ fontSize: 10, color: "var(--ink-40)" }}>{m.unit}</span></span>
              <div className="bar"><i style={{ width: `${m.pct}%` }} /></div>
              <span style={{ fontSize: 10, color: "var(--ink-40)" }}>
                {m.next === undefined ? "Top tier" : `Next at ${fmtNum(m.next)} ${m.unit}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="caps">Personal records</span>
        {d.records.length === 0 && <p className="empty">No kilometre splits imported yet.</p>}
        {d.records.map((rec) => {
          const best = rec.rows[0];
          const isOpen = open === rec.dist;
          return (
            <div className="card" key={rec.dist} style={{ padding: "13px 14px" }}>
              <button onClick={() => setOpen(isOpen ? null : rec.dist)}
                style={{ width: "100%", textAlign: "left", display: "flex", flexDirection: "column", gap: 5 }}>
                <div className="rowsplit">
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{rec.dist}</span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="disp" style={{ fontSize: 17 }}>{hms(best.seconds)}</span>
                    <span style={{ color: "var(--teal)", fontSize: 13 }}>{isOpen ? "⌄" : "›"}</span>
                  </span>
                </div>
                <span style={{ fontSize: 10, color: "var(--ink-40)" }}>{rec.note}</span>
              </button>

              {isOpen && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                  {rec.rows.map((r, i) => (
                    <button key={r.id + i} onClick={() => openActivity(r.id)}
                      style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 10,
                        alignItems: "center", textAlign: "left", padding: "8px 0",
                        borderTop: "1px solid var(--line-2)" }}>
                      <span className="disc" style={{ width: 22, height: 22, fontSize: 10,
                        background: i < 3 ? FACE[["Gold", "Silver", "Bronze"][i]] : "var(--off)",
                        color: i < 3 ? INK[["Gold", "Silver", "Bronze"][i]] : "var(--ink-40)" }}>{i + 1}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span className="disp" style={{ fontSize: 15 }}>{hms(r.seconds)}</span>
                        <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
                          {r.name} · {fmt(r.local_date, { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
                        textTransform: "uppercase", color: "var(--teal)" }}>Session ›</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="empty">
        Records are computed from stored kilometre splits, so they only cover activities
        whose detail has been imported. They are runs of whole-kilometre splits, not
        rolling-window times — a true 5K PR would be a second or two quicker.
      </p>
    </div>
  );
}

const Total = ({ l, v, u }: { l: string; v: string; u: string }) => (
  <div className="card" style={{ padding: 14 }}>
    <div className="caps-sm">{l}</div>
    <div className="disp" style={{ fontSize: 26, marginTop: 5 }}>{v}</div>
    <div style={{ fontSize: 11, color: "var(--ink-40)", marginTop: 2 }}>{u}</div>
  </div>
);
