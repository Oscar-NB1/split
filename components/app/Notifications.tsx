"use client";
import { useEffect, useState } from "react";

const KINDS = [
  ["partner_trained", "They trained", "Every activity that lands on their side."],
  ["session_paired", "Your session logged", "Confirmation it synced and matched the right plan."],
  ["record", "Personal bests", "Yours and theirs."],
  ["upcoming", "Tomorrow's session", "Benchmarks, race sessions and long runs — the night before, with the guardrail."],
  ["missed", "Two missed in a row", "Only to the coach, and only at two."],
  ["race", "Race countdown", "Four weeks, two weeks, race week, the night before."],
  ["weekly", "Sunday round-up", "The week's kilometres and the head-to-head."],
  ["comment", "Coach thread", "When the other one writes on a session."],
] as const;

/** base64url → the Uint8Array the Push API insists on. */
function toKey(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Turning push on, and choosing what it says.
 *
 * The iPhone rules are not optional and are the reason this is not just a
 * toggle: in a Safari *tab* the Push API is absent rather than denied, so the
 * app has to be on the Home Screen first; the permission prompt must come from a
 * real tap; and once refused it cannot be asked again from the page. All three
 * are detected and explained rather than left to fail silently.
 */
export default function Notifications({ prefs }: { prefs: Record<string, boolean> }) {
  const [state, setState] = useState<"unknown" | "unsupported" | "needs-install" | "off" | "on" | "denied">("unknown");
  const [msg, setMsg] = useState<string | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>(prefs);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const standalone = window.matchMedia("(display-mode: standalone)").matches;
        setState(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })();
  }, []);

  async function enable() {
    setBusy(true); setMsg(null);
    try {
      // must happen inside the click: iOS refuses a prompt that is not the
      // direct result of a tap
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) { setMsg("No VAPID public key is set on the server."); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, // required, and iOS enforces it
        applicationServerKey: toKey(key),
      });
      const res = await fetch("/api/push", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub, user_agent: navigator.userAgent }),
      });
      setState(res.ok ? "on" : "off");
      setMsg(res.ok ? "This device is registered." : "Couldn't register this device.");
    } catch (e) {
      setMsg(`Didn't work: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function test() {
    const r = await fetch("/api/push", { method: "PUT" });
    const j = await r.json().catch(() => ({}));
    setMsg(j.sent ? "Sent — it should arrive in a moment."
      : "Nothing was delivered. Check the VAPID keys are set on the server.");
  }

  async function toggle(kind: string) {
    const next = !(on[kind] ?? true);
    setOn({ ...on, [kind]: next });
    await fetch("/api/push", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, on: next }),
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="caps">Notifications</span>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className={`tag ${state === "on" ? "done" : "plan"}`} style={{ alignSelf: "flex-start" }}>
          {state === "on" ? "On for this device" : "Not on this device"}
        </span>

        {state === "needs-install" && (
          <p className="muted">
            On iPhone, notifications only work once the app is on your Home Screen — in a
            Safari tab the browser doesn&apos;t offer them at all. Share → <b>Add to Home
            Screen</b>, open it from there, then come back.
          </p>
        )}
        {state === "unsupported" && <p className="muted">This browser doesn&apos;t support push.</p>}
        {state === "denied" && (
          <p className="muted">
            Notifications are blocked for this app. That has to be undone in system
            settings — the page can&apos;t ask again once it has been refused.
          </p>
        )}

        {state === "off" && (
          <button className="btn-primary" onClick={enable} disabled={busy}>
            {busy ? "…" : "Turn on notifications"}
          </button>
        )}
        {state === "on" && <button className="btn-ghost" onClick={test}>Send a test</button>}
        {msg && <p className="muted">{msg}</p>}

        {state === "on" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {KINDS.map(([kind, label, note]) => (
              <label key={kind} style={{
                display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 0",
                borderTop: "1px solid var(--line-2)", cursor: "pointer",
              }}>
                <input type="checkbox" checked={on[kind] ?? true} onChange={() => toggle(kind)}
                  style={{ width: "auto", marginTop: 2, accentColor: "var(--teal)", flex: "none" }} />
                <span>
                  <b style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{label}</b>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-55)", lineHeight: 1.45, marginTop: 2 }}>
                    {note}
                  </span>
                </span>
              </label>
            ))}
            <p className="empty">
              Nothing is delivered between 21:00 and 07:00. It waits rather than disappearing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
