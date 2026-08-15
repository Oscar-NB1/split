"use client";
import { useEffect, useState } from "react";
import { ZONES } from "@/lib/coach";
import type { User } from "./Shell";

/** Settings: who you are, what is connected, and the zones everything is scored against. */
export default function Profile({ me }: { me: User }) {
  const [connected, setConnected] = useState<Record<string, boolean> | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem("split-theme");
    const t = saved === "dark" ? "dark" : "light";
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }, []);

  useEffect(() => {
    fetch("/api/connections").then(async (r) => r.ok && setConnected(await r.json()));
  }, []);

  function flip(t: "light" | "dark") {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem("split-theme", t);
  }

  const apps = [
    ["strava", "Strava", "Activities, splits and streams"],
    ["intervals", "intervals.icu", "Pushes workouts to the watch"],
    ["runna", "Runna", "The running spine, by iCal feed"],
  ] as const;

  return (
    <div className="pad">
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span className="avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
          {me.display_name.slice(0, 1).toUpperCase()}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="disp" style={{ fontSize: 19 }}>{me.display_name}</span>
          <span style={{ fontSize: 11, color: "var(--ink-40)" }}>Signed in on this device</span>
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="caps">Connected apps</span>
        <div className="card" style={{ padding: "4px 16px" }}>
          {apps.map(([key, name, sub]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 12,
              padding: "13px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 11, color: "var(--ink-40)" }}>{sub}</span>
              </span>
              <span className={`tag ${connected?.[key] ? "done" : "plan"}`}>
                {connected === null ? "…" : connected[key] ? "Connected" : "Not connected"}
              </span>
            </div>
          ))}
        </div>
        <a href="/settings" style={{ fontSize: 12 }}>Manage connections ↗</a>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="caps">Heart rate zones</span>
        <div className="card" style={{ padding: "6px 16px" }}>
          {ZONES.map((z) => (
            <div key={z.tag} className="rowsplit" style={{ padding: "11px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: z.colour, display: "block" }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{z.tag}</span>
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-70)" }}>{z.label}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 10, color: "var(--ink-40)", lineHeight: 1.5 }}>
          Set from a measured max of 189 bpm. Easy runs belong under 152 — the plan&apos;s
          single most repeated instruction.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span className="caps">Appearance</span>
        <div className="pillrow">
          <button aria-pressed={theme === "light"} onClick={() => flip("light")}>Light</button>
          <button aria-pressed={theme === "dark"} onClick={() => flip("dark")}>Dark</button>
        </div>
      </div>

      <a className="btn-ghost" href="/api/auth/logout" style={{ textAlign: "center", display: "block" }}>Sign out</a>
    </div>
  );
}
