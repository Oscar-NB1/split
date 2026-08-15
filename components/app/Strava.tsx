"use client";
import { useEffect, useState } from "react";
import Mark from "./Mark";

const TEAL = "var(--teal)", LIME = "var(--lime)";
const INK = "var(--ink)", INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";
const LINE2 = "var(--line-2)", CREAM = "var(--cream)";

/**
 * The Strava connection.
 *
 * One connection rather than a list of toggles, because connecting a service is
 * an authorisation and not a preference — a switch implies the app can turn it
 * on, and it cannot.
 *
 * The screen states the import contract in the athlete's own language:
 * activities, laps and splits, the heart-rate stream, elevation and cadence in;
 * nothing out. That sentence is a check on the sync worker as much as a promise
 * to the reader — if anything ever writes back to Strava, this screen has to
 * change first.
 */

type Row = { key: string; label: string; sub: string; required: boolean };
type State = {
  connected: boolean; since: string | null; granted: string[];
  scopes: Row[]; total: number;
  recent: { what: string; when: string; matched: boolean; state: string }[];
};

/** What comes in. Named exactly, because "syncs your data" tells nobody anything. */
const IMPORTS = [
  { title: "Activities", sub: "Matched to the session they were meant to be, by day and sport." },
  { title: "Laps and splits", sub: "Every rep and every kilometre, so an interval session reads as intervals." },
  { title: "The heart-rate stream", sub: "The whole trace, which is what zone time and drift are computed from." },
  { title: "Elevation and cadence", sub: "Where your watch recorded them." },
];

export default function Strava({ onDone }: { onDone?: () => void }) {
  const [s, setS] = useState<State | null>(null);
  const [wantPrivate, setWantPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/connections/strava").then(async (r) => {
      if (r.status === 401) { location.href = "/"; return; }
      const j: State = await r.json();
      setS(j);
      setWantPrivate(j.granted.includes("activity:read_all"));
    });

  useEffect(() => { load(); }, []);

  async function disconnect() {
    setBusy(true);
    await fetch("/api/connections/strava", { method: "DELETE" });
    setBusy(false);
    await load();
  }

  if (!s) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  const scopeRow = (row: Row, live: boolean) => {
    const on = row.required || (live ? s.granted.includes(row.key) : wantPrivate);
    return (
      <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 12,
        padding: "13px 0", borderBottom: `1px solid ${LINE2}` }}>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</span>
          <span style={{ fontSize: 11, lineHeight: 1.45, color: INK40 }}>
            {row.sub}{row.required ? " Required." : ""}
          </span>
        </span>
        <button
          onClick={() => !row.required && !live && setWantPrivate(!wantPrivate)}
          disabled={row.required || live}
          aria-label={row.label}
          style={{
            width: 42, height: 24, borderRadius: 12, padding: 2, display: "flex", flex: "none",
            border: 0, background: on ? TEAL : "rgba(18,49,77,.18)",
            justifyContent: on ? "flex-end" : "flex-start",
            opacity: row.required || live ? 0.55 : 1,
          }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff" }} />
        </button>
      </div>
    );
  };

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Mark id="strava" label="Strava" size={60} radius={14} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700,
            lineHeight: 1.1 }}>Strava</span>
          <span style={{ fontSize: 12, fontWeight: 700,
            color: s.connected ? TEAL : INK40 }}>
            {s.connected ? `Connected · ${s.total} activities` : "Not connected"}
          </span>
        </div>
      </div>

      {!s.connected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: INK70, margin: 0 }}>
            Connecting Strava is what makes the plan self-completing. Every activity you upload is
            matched to the session it was meant to be, and the numbers fill themselves in.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={caps}>What gets imported</span>
            <div style={card}>
              {IMPORTS.map((i) => (
                <div key={i.title} style={{ display: "flex", flexDirection: "column", gap: 3,
                  padding: "12px 0", borderBottom: `1px solid ${LINE2}` }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</span>
                  <span style={{ fontSize: 12, lineHeight: 1.45, color: INK55 }}>{i.sub}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={caps}>Permissions you will grant</span>
            <div style={{ ...card, padding: "4px 16px" }}>
              {s.scopes.map((row) => scopeRow(row, false))}
            </div>
          </div>

          <a href={`/api/strava/connect${wantPrivate ? "?private=1" : ""}`} style={{
            width: "100%", background: LIME, borderRadius: "var(--r-pill)",
            color: "var(--on-lime)", padding: 17, fontSize: 12, fontWeight: 800,
            letterSpacing: ".06em", textTransform: "uppercase", textAlign: "center",
            textDecoration: "none", display: "block",
          }}>Connect Strava</a>
          <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40, textAlign: "center" }}>
            You will be handed to Strava to authorise, then returned here. Nothing is written back
            to Strava.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: CREAM, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: 16,
            display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
              textTransform: "uppercase", color: TEAL }}>Auto-import on</span>
            <span style={{ fontSize: 13, lineHeight: 1.55, color: INK70 }}>
              New activities arrive within a few minutes of upload and are matched to the planned
              session by day and sport.
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={caps}>Recent imports</span>
            <div style={card}>
              {s.recent.length === 0 && (
                <div style={{ padding: "12px 0", fontSize: 12, color: INK55 }}>
                  Nothing imported yet. The next activity you upload appears here.
                </div>
              )}
              {s.recent.map((r) => (
                <div key={r.what + r.when} style={{ display: "flex", alignItems: "center",
                  gap: 12, padding: "12px 0", borderBottom: `1px solid ${LINE2}` }}>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.what}</span>
                    <span style={{ fontSize: 11, color: INK40 }}>{r.when}</span>
                  </span>
                  {/* an unmatched activity is a run nobody planned, not a failure */}
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em",
                    borderRadius: "var(--r-pill)", padding: "4px 9px", flex: "none",
                    maxWidth: 148, overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    background: r.matched ? "var(--teal-tint2)" : OFF,
                    color: r.matched ? TEAL : INK55 }}>{r.state}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={caps}>Permissions</span>
            <div style={{ ...card, padding: "4px 16px" }}>
              {s.scopes.map((row) => scopeRow(row, true))}
            </div>
            {!s.granted.includes("activity:read_all") && (
              <a href="/api/strava/connect?private=1" style={{ fontSize: 11, color: TEAL,
                fontWeight: 600, textDecoration: "none" }}>
                Include private activities ↗
              </a>
            )}
          </div>

          <button onClick={disconnect} disabled={busy} style={{
            width: "100%", background: "none", border: `1px solid ${LINE}`,
            borderRadius: "var(--r-pill)", padding: 15, fontSize: 12, fontWeight: 800,
            letterSpacing: ".06em", textTransform: "uppercase", color: INK55,
          }}>{busy ? "Disconnecting…" : "Disconnect Strava"}</button>
          <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40, textAlign: "center" }}>
            Disconnecting stops new imports. The {s.total} activities already here stay — they are
            a record of what you did.
          </span>
        </div>
      )}

      {/* absent on the standalone page, which has its own way back — a control
          that does nothing is worse than no control */}
      {onDone && (
        <button onClick={onDone} style={{ fontSize: 12, color: INK55, background: "none",
          padding: 0 }}>Back to profile</button>
      )}
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: INK55,
};
const card: React.CSSProperties = {
  background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
  padding: "6px 16px",
};
