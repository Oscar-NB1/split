"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";

const TEAL = "#0A8FB0", LIME = "#C6FF5B", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)", CREAM = "var(--cream)";

type Data = {
  me: { id: string; name: string };
  other: { id: string; name: string } | null;
  week: { start: string; metric: string; label: string; mine: number; theirs: number };
  rows: { label: string; suffix?: string; mine: number; theirs: number }[];
  history: { week: string; label: string; mine: number; theirs: number; result: "W" | "L" | "D" }[];
  record: { won: number; lost: number; drawn: number };
};

const NUDGES = [
  "Two sessions up. Your move.",
  "Tempo Saturday. Loser buys coffee.",
  "I saw that skipped shake-out.",
  "Nice week. Still behind though.",
];

export default function Versus() {
  const [d, setD] = useState<Data | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/versus").then(async (r) => {
      if (r.status === 401) { location.href = "/login"; return; }
      if (r.ok) setD(await r.json());
    });
  }, []);

  if (!d) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;
  if (!d.other) {
    return (
      <div style={{ padding: 18 }}>
        <p className="empty">
          Versus needs a second athlete. Only one account has been set up so far.
        </p>
      </div>
    );
  }

  const { mine, theirs } = d.week;
  const total = mine + theirs || 1;
  const lead = mine === theirs ? "Level" : mine > theirs ? "You lead" : `${d.other.name} leads`;
  const initial = (n: string) => n.slice(0, 1).toUpperCase();

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>Head to head</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 5 }}>
          You vs {d.other.name}
        </div>
      </div>

      <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: "18px 16px",
        display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ width: 34, height: 34, borderRadius: "50%", background: TEAL,
              color: "#fff", fontSize: 13, fontWeight: 800, display: "flex",
              alignItems: "center", justifyContent: "center" }}>{initial(d.me.name)}</span>
            <span style={{ fontFamily: "var(--display)", fontSize: 30, fontWeight: 700,
              lineHeight: 1, color: mine >= theirs ? LIME : "#fff" }}>{mine}</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.6)" }}>You</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em",
            color: "rgba(255,255,255,.4)" }}>VS</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <span style={{ width: 34, height: 34, borderRadius: "50%",
              background: "rgba(255,255,255,.18)", color: "#fff", fontSize: 13, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              {initial(d.other.name)}
            </span>
            <span style={{ fontFamily: "var(--display)", fontSize: 30, fontWeight: 700,
              lineHeight: 1, color: theirs > mine ? LIME : "#fff" }}>{theirs}</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.6)" }}>{d.other.name}</span>
          </div>
        </div>

        <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden",
          background: "rgba(255,255,255,.12)" }}>
          <span style={{ width: `${(mine / total) * 100}%`, background: LIME }} />
          <span style={{ width: `${(theirs / total) * 100}%`, background: "rgba(255,255,255,.35)" }} />
        </div>

        <div style={{ display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: LIME }}>{lead}</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.55)" }}>{d.week.label}</span>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", paddingTop: 12,
          display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>Weeks won</span>
          {d.history.length === 0 ? (
            <span style={{ fontSize: 12, color: "rgba(255,255,255,.6)", lineHeight: 1.5 }}>
              No finished weeks yet. The first result lands next Sunday.
            </span>
          ) : (
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {d.history.map((h) => (
                <span key={h.week} title={`${fmt(h.week, { day: "numeric", month: "short" })} · ${h.label} · ${h.mine}–${h.theirs}`}
                  style={{
                    width: 22, height: 22, borderRadius: 6, fontSize: 10, fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: h.result === "W" ? LIME : h.result === "L" ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.10)",
                    color: h.result === "W" ? NAVY : "#fff",
                  }}>{h.result}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- the metrics */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, background: PAPER,
        border: `1px solid ${LINE}`, borderRadius: "var(--r-card)", padding: 16 }}>
        {d.rows.map((r) => {
          const max = Math.max(r.mine, r.theirs, 1);
          const iWin = r.mine > r.theirs, theyWin = r.theirs > r.mine;
          return (
            <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr",
                alignItems: "baseline", gap: 10 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  {iWin && <Check />}
                  <span style={{ fontSize: 15, fontWeight: iWin ? 800 : 600,
                    color: iWin ? TEAL : INK55 }}>{r.mine}{r.suffix ?? ""}</span>
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                  textTransform: "uppercase", color: INK40 }}>{r.label}</span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 5,
                  justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 15, fontWeight: theyWin ? 800 : 600,
                    color: theyWin ? TEAL : INK55 }}>{r.theirs}{r.suffix ?? ""}</span>
                  {theyWin && <Check />}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", height: 10,
                  background: OFF, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ width: `${(r.mine / max) * 100}%`,
                    background: iWin ? TEAL : INK40 }} />
                </div>
                <div style={{ height: 10, background: OFF, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ height: 10, width: `${(r.theirs / max) * 100}%`,
                    background: theyWin ? TEAL : INK40 }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: INK55 }}>Season record</div>
          <div style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, marginTop: 4 }}>
            {d.record.won}–{d.record.lost}
          </div>
          <div style={{ fontSize: 10, color: INK40, marginTop: 3, lineHeight: 1.4 }}>
            {d.history.length === 0 ? "from next Sunday"
              : `${d.history.length} finished week${d.history.length > 1 ? "s" : ""}${d.record.drawn ? `, ${d.record.drawn} drawn` : ""}`}
          </div>
        </div>
        <div style={{ flex: 1, background: CREAM, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: TEAL }}>This week</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-70)", marginTop: 6 }}>
            Scored on {d.week.label.toLowerCase()}. The metric rotates weekly, so a week lost
            on distance can be won on effort.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: INK55 }}>Send a nudge</span>
        {NUDGES.map((n) => (
          <button key={n} onClick={() => setSent(n)} style={{
            textAlign: "left", background: sent === n ? "var(--teal-tint)" : PAPER,
            border: `1px solid ${sent === n ? TEAL : LINE}`, borderRadius: "var(--r-pill)",
            padding: "11px 15px", fontSize: 12, fontWeight: 600,
            color: sent === n ? TEAL : "var(--ink)",
          }}>{n}</button>
        ))}
        {sent && (
          <p className="empty">
            Nudges aren&apos;t wired to notifications yet — this only marks which one you picked.
          </p>
        )}
      </div>
    </div>
  );
}

const Check = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke={TEAL}
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 13l5 5L20 7" />
  </svg>
);
