"use client";
import { useState } from "react";

export default function Login() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) location.href = "/";
    else {
      setErr((await res.json()).error ?? "That didn't work.");
      setBusy(false);
    }
  }

  return (
    <div className="centre">
      <h1 className="disp" style={{ fontSize: 40, letterSpacing: ".14em", marginBottom: 6 }}>
        Split
      </h1>
      <p style={{ color: "var(--dim)", fontSize: 13, marginBottom: 22 }}>
        Two athletes, one calendar.
      </p>
      <input
        type="password"
        placeholder="Access code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        autoFocus
      />
      {err && <p style={{ color: "var(--warn)", fontSize: 12, marginTop: 10 }}>{err}</p>}
      <button
        className="act primary"
        style={{ width: "100%", marginTop: 14 }}
        onClick={go}
        disabled={busy}
      >
        {busy ? "…" : "Enter"}
      </button>
    </div>
  );
}
