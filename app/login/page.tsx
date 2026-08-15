"use client";
import { useState } from "react";

/**
 * The bootstrap, and nothing links to it.
 *
 * Sign-in is Google or Strava, on the gate at `/`. This exists for the two
 * accounts that predate providers: they hold a training history and neither
 * provider can reach them by email. Sign in here once, add a provider from the
 * profile, and the code stops opening that account for good.
 */
export default function Bootstrap() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) { location.href = "/"; return; }
    setErr((await res.json()).error ?? "That didn't work.");
    setBusy(false);
  }

  return (
    <div className="app">
      <div style={{ flex: 1, display: "flex", flexDirection: "column",
        justifyContent: "center", gap: 18, padding: "40px 26px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: "var(--teal)" }}>Existing account</span>
          <span style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
            lineHeight: 1.15, letterSpacing: "-.02em" }}>Sign in with your code</span>
          <span style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-55)" }}>
            For the accounts that came before Google and Strava. Add a provider from your profile
            afterwards and this stops working for you.
          </span>
        </div>

        <input type="password" placeholder="Access code" value={code} autoFocus
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          style={{ background: "var(--paper)", border: "1px solid var(--line)",
            borderRadius: 12, padding: "14px 15px", fontSize: 14 }} />

        {err && <div className="errbox">{err}</div>}

        <button onClick={go} disabled={busy || !code} style={{
          width: "100%", borderRadius: "var(--r-pill)", padding: 16, fontSize: 12,
          fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", border: 0,
          background: busy || !code ? "var(--off)" : "var(--lime)",
          color: busy || !code ? "var(--ink-40)" : "var(--on-lime)",
        }}>{busy ? "Signing in…" : "Sign in"}</button>

        <a href="/" style={{ fontSize: 12, fontWeight: 700, color: "var(--teal)" }}>
          Use Google or Strava instead
        </a>
      </div>
    </div>
  );
}
