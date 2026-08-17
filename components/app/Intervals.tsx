"use client";
import { useEffect, useState } from "react";

const TEAL = "#0A8FB0", LIME = "#C6FF5B";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const LINE = "var(--line)";

/**
 * Getting a session onto the watch.
 *
 * The plumbing has been finished for a while — a per-session push, an hourly cron for the next
 * ten days, an update-in-place so pressing send twice does not create a second workout — and it
 * could not be reached, because the only thing missing was somewhere to put the key. The push
 * route told people to add it in Settings and Settings only ever showed Strava.
 *
 * intervals.icu rather than Garmin directly: Garmin's Training API needs an approved developer
 * account, and intervals.icu already holds a two-way sync with Garmin Connect that an athlete can
 * turn on themselves in a minute. A structured workout pushed here appears on the watch as
 * prompted steps with pace targets, which is the whole point — and it is the same route a
 * Garmin-direct integration would replace later without any screen changing.
 */

type State = {
  connected: boolean; athlete_id: string | null; since: string | null;
  pushed: number; due: number;
};

export default function Intervals() {
  const [s, setS] = useState<State | null>(null);
  const [athlete, setAthlete] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [needsId, setNeedsId] = useState(false);

  const load = () => fetch("/api/intervals").then((r) => r.json()).then(setS).catch(() => {});
  useEffect(() => { load(); }, []);

  async function connect() {
    setBusy(true); setSaid(null);
    const r = await fetch("/api/intervals", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ athlete_id: athlete.trim(), api_key: key.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      /* The one failure that is a question rather than a mistake. */
      if (/which athlete/i.test(String(j.error))) setNeedsId(true);
      setSaid(j.error ?? "That did not go through.");
      return;
    }
    /* The key is never held in the page after it has been sent. */
    setKey("");
    setSaid(j.pushed > 0
      ? `Connected. ${j.pushed} session${j.pushed === 1 ? "" : "s"} sent — they will appear on your watch once Garmin syncs.`
      : "Connected. Nothing to send yet; the next ten days will go automatically.");
    load();
  }

  if (!s) return null;
  /* The key alone is enough: the athlete id is looked up from it, and only asked for if that
     lookup comes back empty. */
  const ready = key.trim().length > 10;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700 }}>
          Your watch
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
          textTransform: "uppercase", color: s.connected ? TEAL : INK40 }}>
          {s.connected ? `Connected · ${s.pushed} sent` : "Not connected"}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: INK70 }}>
        Sessions go to intervals.icu, which syncs into Garmin Connect and onto the watch as a
        structured workout — it prompts each step and holds you to the pace the plan asked for.
        {" "}Garmin has no direct route without an approved developer account; this one you can
        turn on yourself.
      </p>

      {s.connected ? (
        <>
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12.5 }}>
              Athlete <b>{s.athlete_id}</b>
            </span>
            <span style={{ fontSize: 11.5, color: INK55, lineHeight: 1.5 }}>
              {s.due > 0
                ? `${s.due} run${s.due === 1 ? "" : "s"} in the next ten days will be there. Runs only — a class, a lift and a race are not structured workouts.`
                : "No runs in the next ten days to send."}
            </span>
          </div>
          <span style={{ fontSize: 11.5, color: INK55, lineHeight: 1.55 }}>
            In intervals.icu, turn on the Garmin Connect sync once and the workouts arrive by
            themselves. Sending the same session twice updates the one workout rather than making
            a second.
          </span>
        </>
      ) : (
        <>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7,
            color: INK70, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Open intervals.icu → <b>Settings</b>, and connect Garmin there first.</li>
            <li>Same page, at the bottom: <b>Developer Settings</b>. Copy the API key.</li>
            <li>That is all — the athlete ID comes from the key.</li>
          </ol>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={key} onChange={(e) => setKey(e.target.value)}
              type="password" placeholder="API key" aria-label="intervals.icu API key"
              autoComplete="off"
              style={{ borderRadius: 11, border: `1px solid ${LINE}`, padding: "12px 13px",
                fontSize: 14, background: "var(--off)" }} />
            {/*
              * Only shown once the lookup has failed.
              *
              * Asking for a number buried in a URL when the key can answer for you is asking for
              * a wrong number — so it is asked for second, and only when it has to be.
              */}
            {needsId && (
              <input value={athlete} onChange={(e) => setAthlete(e.target.value)}
                placeholder="Athlete ID — i12345, or paste the whole URL"
                aria-label="intervals.icu athlete ID"
                style={{ borderRadius: 11, border: `1px solid ${TEAL}`, padding: "12px 13px",
                  fontSize: 14, background: "var(--off)" }} />
            )}
          </div>
          <button onClick={connect} disabled={!ready || busy} style={{
            width: "100%", border: 0, borderRadius: "var(--r-pill)", padding: 15,
            fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            background: ready ? LIME : "var(--off)", color: ready ? "#0E2740" : INK55,
            opacity: busy ? .6 : 1,
          }}>{busy ? "Checking it…" : "Connect and send the next ten days"}</button>
          {/* Verified against intervals.icu before anything is stored, so a mistyped key
              cannot be saved and then reported as connected. */}
          <span style={{ fontSize: 11, color: INK40, lineHeight: 1.5 }}>
            The key is checked against intervals.icu before it is saved, and it is never shown
            again afterwards.
          </span>
        </>
      )}

      {said && <div className="errbox" role="status">{said}</div>}
    </div>
  );
}
