"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import type { Zone } from "@/lib/zones";
import Notifications from "./Notifications";
import type { User } from "./Shell";

const TEAL = "#0A8FB0", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

export type Prof = {
  hr_max: number | null; notify: Record<string, boolean>; display_name: string;
  email: string; dob: string | null; weight_kg: number | null; injury_notes: string | null;
  connected: string[]; activities: number; since: string | null;
  coachees?: { id: string; display_name: string; email: string }[];
  coached_by?: { id: string; display_name: string; email: string }[];
  has_plan?: boolean;
};

const APPS: [string, string, string][] = [
  ["strava", "Strava", "Activities, splits and streams"],
  ["intervals", "intervals.icu", "Pushes your sessions to your watch"],
];

export default function Profile({
  me, openEdit, openConnect, openBuild, openCoachee,
}: {
  me: User; openEdit: () => void; openConnect: () => void;
  openBuild: () => void;
  /** enter someone else's week — coaching is a relationship, not a toggle */
  openCoachee: (id: string) => void;
}) {
  const [p, setP] = useState<Prof | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const t = localStorage.getItem("split-theme") === "dark" ? "dark" : "light";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    fetch("/api/profile").then(async (r) => r.ok && setP(await r.json()));
  }, []);

  function flip(t: "light" | "dark") {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem("split-theme", t);
  }


  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <button onClick={openEdit} style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
        background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
        padding: 16, color: "var(--ink)",
      }}>
        <span style={{ width: 56, height: 56, flex: "none", borderRadius: "50%",
          background: TEAL, color: "#fff", fontSize: 22, fontWeight: 800,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          {(p?.display_name ?? me.display_name).slice(0, 1).toUpperCase()}
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700 }}>
            {p?.display_name ?? me.display_name}
          </span>
          <span style={{ fontSize: 12, color: INK55 }}>{p?.email ?? ""}</span>
          <span style={{ fontSize: 11, color: INK40 }}>
            {p ? `${p.activities} activities${p.since ? ` since ${fmt(p.since, { month: "short", year: "numeric" })}` : ""}` : ""}
          </span>
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
          textTransform: "uppercase", color: TEAL }}>Edit ›</span>
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>Connected apps</span>
        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "4px 16px" }}>
          {APPS.map(([key, name, sub]) => {
            const on = p?.connected.includes(key) ?? false;
            return (
              // The switch is a state indicator, not a control — connecting Strava
              // is an OAuth round trip and intervals.icu needs a pasted key, so a
              // toggle cannot do either. It looked tappable, so now the row is:
              // it goes to the screen where the connection is actually made.
              <button key={key} onClick={openConnect} style={{ display: "flex", alignItems: "center", gap: 12,
                padding: "13px 0", borderBottom: "1px solid var(--line-2)",
                color: "var(--ink)", textDecoration: "none" }}>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: on ? TEAL : INK40 }}>
                    {p == null ? "…" : on ? "Connected" : "Not connected"}
                  </span>
                  <span style={{ fontSize: 11, color: INK40 }}>{sub}</span>
                </span>
                <span style={{
                  width: 42, height: 24, borderRadius: 12, flex: "none",
                  background: on ? TEAL : OFF, position: "relative",
                  border: `1px solid ${on ? TEAL : LINE}`,
                }}>
                  <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18,
                    height: 18, borderRadius: "50%", background: "#fff",
                    boxShadow: "0 1px 2px rgba(18,49,77,.25)" }} />
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={openConnect} style={{ fontSize: 12, color: TEAL, fontWeight: 600,
          background: "none", padding: 0, textAlign: "left" }}>Manage connections ↗</button>
      </div>

      <Zones />

      <Notifications prefs={p?.notify ?? {}} />

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={caps}>Appearance</span>
        <div style={{ display: "flex", gap: 3, background: OFF,
          borderRadius: "var(--r-pill)", padding: 3 }}>
          {(["light", "dark"] as const).map((t) => (
            <button key={t} onClick={() => flip(t)} style={{
              flex: 1, borderRadius: "var(--r-pill)", padding: "9px 12px", fontSize: 11,
              fontWeight: 700, background: theme === t ? NAVY : "transparent",
              color: theme === t ? "#fff" : INK55, textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>
      </div>

      {(p?.coachees ?? []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={caps}>Coaching</span>
          {(p?.coachees ?? []).map((c) => (
            <button key={c.id} onClick={() => openCoachee(c.id)} style={{
              width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-card)", padding: "15px 16px", color: "var(--ink)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ width: 32, height: 32, flex: "none", borderRadius: "50%",
                background: NAVY, color: "var(--lime)", fontSize: 12, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                {c.display_name.slice(0, 1).toUpperCase()}
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.display_name}</span>
                <span style={{ fontSize: 11, color: INK55 }}>
                  Open their plan and write their week
                </span>
              </span>
              <span style={{ fontSize: 13, color: INK40 }}>›</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={caps}>Training plan</span>
        <button onClick={openBuild} style={planRow}>
          {p?.has_plan ? "Rebuild my plan" : "Build a new plan"}
        </button>
        <button onClick={openBuild} style={{ ...planRow, display: "flex",
          flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Run the benchmark test</span>
          <span style={{ fontSize: 11, color: INK55 }}>
            Rebuilds paces and volume from measured numbers
          </span>
        </button>
      </div>

      <a href="/api/auth/logout" style={{
        width: "100%", background: "none", border: `1px solid ${LINE}`,
        borderRadius: "var(--r-pill)", padding: 15, fontSize: 12, fontWeight: 800,
        letterSpacing: ".06em", textTransform: "uppercase", color: INK55,
        textAlign: "center", display: "block",
      }}>Sign out</a>
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

const planRow: React.CSSProperties = {
  width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
  borderRadius: "var(--r-card)", padding: "15px 16px", color: "var(--ink)",
  fontSize: 13, fontWeight: 600,
};

/**
 * Heart-rate zones, editable two ways.
 *
 * The maximum moves and all five recalculate; a single ceiling moves and stays
 * between its neighbours. Both go to /api/zones, which owns the invariant — no
 * crossing, no gaps, labels agreeing with their numbers — so a table can never
 * be written from here that the rest of the app cannot read.
 */
function Zones() {
  const [z, setZ] = useState<{
    hr_max: number | null; zones: Zone[]; edited: boolean;
  } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/zones").then(async (r) => r.ok && setZ(await r.json())); }, []);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch("/api/zones", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (r.ok) setZ(await r.json());
  }

  if (!z) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={caps}>Heart rate zones</span>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "13px 16px",
        display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-70)" }}>
            Max heart rate
          </span>
          <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700 }}>
            {z.hr_max ?? 189}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {([["−5", -5], ["−1", -1], ["+1", 1], ["+5", 5]] as const).map(([l, d]) => (
            <button key={l} disabled={busy}
              onClick={() => send({ action: "max", hr_max: (z.hr_max ?? 189) + d })}
              style={{ flex: 1, padding: "10px 0", borderRadius: "var(--r-pill)",
                border: `1px solid ${LINE}`, background: OFF, fontSize: 12,
                fontWeight: 700, color: "var(--ink)" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "6px 16px" }}>
        {z.zones.map((row, i) => (
          <div key={row.tag} style={{ display: "flex", flexDirection: "column", gap: 9,
            padding: "11px 0", borderBottom: "1px solid var(--line-2)" }}>
            <button onClick={() => setOpen(open === i ? null : i)} disabled={i === 4}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, width: "100%", background: "none", padding: 0, color: "var(--ink)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: row.colour }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{row.tag}</span>
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-70)" }}>{row.label}</span>
            </button>
            {open === i && i < 4 && (
              <div style={{ display: "flex", gap: 5 }}>
                {([["−5", -5], ["−1", -1], ["+1", 1], ["+5", 5]] as const).map(([l, d]) => (
                  <button key={l} disabled={busy}
                    onClick={() => send({ action: "nudge", index: i, delta: d })}
                    style={{ flex: 1, padding: "8px 0", borderRadius: "var(--r-pill)",
                      border: `1px solid ${LINE}`, background: OFF, fontSize: 11,
                      fontWeight: 700, color: "var(--ink)" }}>{l}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
          {z.edited
            ? "Edited by hand. Every HR chart in the app reads this table."
            : `Derived from ${z.hr_max ?? 189} bpm as percentages, so the table is yours rather than the other athlete's.`}
        </span>
        {z.edited && (
          <button onClick={() => send({ action: "reset" })} disabled={busy}
            style={{ flex: "none", background: "none", border: 0, fontSize: 10,
              fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
              color: TEAL }}>Reset</button>
        )}
      </div>
    </div>
  );
}
