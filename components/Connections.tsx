"use client";
import { useState } from "react";

export default function Connections({
  me, connected,
}: { me: { display_name: string }; connected: Record<string, boolean> }) {
  const [feed, setFeed] = useState("");
  const [icu, setIcu] = useState({ athlete_id: "", api_key: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (method: "POST" | "PUT", body: unknown, label: string) => {
    setMsg(null);
    const res = await fetch("/api/intervals", {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = "/login"; return; }
    // say why, not just "failed" - most failures here are a mistyped key or URL
    setMsg(res.ok ? `${label} saved.` : `${label} failed: ${json.error ?? res.status}`);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ fontSize: 13, color: "var(--dim)", marginBottom: 18 }}>
        Signed in as {me.display_name}. Each of you connects your own accounts.
      </p>

      <div className="rows">
        <div className="card" style={{ border: "1px solid var(--line)", borderRadius: 3 }}>
          <h3>Activities</h3>
          <span className={`chip ${connected.strava ? "on" : ""}`}><s />Strava</span>
          <p className="note" style={{ marginTop: 8 }}>
            Garmin activities arrive here — Garmin&apos;s own API is business-only.
            Leave every permission box ticked, or only public activities come through.
          </p>
          <a className="act primary" href="/api/strava/connect" style={{ display: "block", textDecoration: "none" }}>
            {connected.strava ? "Reconnect Strava" : "Connect Strava"}
          </a>
        </div>

        <div className="card" style={{ border: "1px solid var(--line)", borderRadius: 3 }}>
          <h3>Runna plan</h3>
          <span className={`chip ${connected.runna ? "on" : ""}`}><s />Calendar feed</span>
          <p className="note" style={{ marginTop: 8 }}>
            In Runna: Profile → Sync to calendar → copy the subscription URL.
            Planned runs mirror in hourly; anything you&apos;ve already moved is left alone.
          </p>
          <input placeholder="webcal:// or https:// feed URL" value={feed}
            onChange={(e) => setFeed(e.target.value)} />
          <button className="act" style={{ marginTop: 10, width: "100%" }}
            onClick={() => save("PUT", { feed_url: feed.replace(/^webcal:/, "https:") }, "Feed")}>
            Save feed
          </button>
        </div>

        <div className="card" style={{ border: "1px solid var(--line)", borderRadius: 3 }}>
          <h3>Push to watch</h3>
          <span className={`chip ${connected.intervals ? "on" : ""}`}><s />intervals.icu</span>
          <p className="note" style={{ marginTop: 8 }}>
            In intervals.icu: Settings → Developer for your athlete ID and API key,
            then Connections → Garmin → tick <em>Upload planned workouts</em>.
            Programmed runs then land on the watch at the next sync.
          </p>
          <input placeholder="Athlete ID (i12345)" value={icu.athlete_id}
            onChange={(e) => setIcu({ ...icu, athlete_id: e.target.value })} />
          <input placeholder="API key" style={{ marginTop: 8 }} value={icu.api_key}
            onChange={(e) => setIcu({ ...icu, api_key: e.target.value })} />
          <button className="act" style={{ marginTop: 10, width: "100%" }}
            onClick={() => save("POST", icu, "intervals.icu")}>
            Save and push next 10 days
          </button>
        </div>
      </div>

      {msg && <p style={{ marginTop: 16, fontSize: 12, color: "var(--dim)" }}>{msg}</p>}
    </div>
  );
}
