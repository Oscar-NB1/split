"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { zonesFor } from "@/lib/coach";
import Notifications from "./Notifications";
import type { User } from "./Shell";

const TEAL = "#0A8FB0", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

export type Prof = {
  hr_max: number | null; notify: Record<string, boolean>; display_name: string;
  email: string; dob: string | null; weight_kg: number | null; injury_notes: string | null;
  connected: string[]; activities: number; since: string | null;
};

const APPS: [string, string, string][] = [
  ["strava", "Strava", "Activities, splits and streams"],
  ["intervals", "intervals.icu", "Pushes workouts to the watch"],
  ["runna", "Runna", "The running spine, by iCal feed"],
];

export default function Profile({ me, openEdit }: { me: User; openEdit: () => void }) {
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

  const zones = zonesFor(p?.hr_max);

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
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 12,
                padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
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
              </div>
            );
          })}
        </div>
        <a href="/settings" style={{ fontSize: 12 }}>Manage connections ↗</a>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>Heart rate zones</span>
        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "6px 16px" }}>
          {zones.map((z) => (
            <div key={z.tag} style={{ display: "flex", alignItems: "center",
              justifyContent: "space-between", padding: "11px 0",
              borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: z.colour }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{z.tag}</span>
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-70)" }}>{z.label}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
          Derived from a maximum of {p?.hr_max ?? 189} bpm as percentages, so the table is
          yours rather than the other athlete&apos;s. Change it in Edit profile.
        </span>
      </div>

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
