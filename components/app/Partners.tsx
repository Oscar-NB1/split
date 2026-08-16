"use client";
import { useCallback, useEffect, useState } from "react";

const TEAL = "#0A8FB0", CREAM = "var(--cream)";
const INK = "var(--ink)", INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

type Athlete = { id: string; display_name: string; avatar_url: string | null };
type Row = { id: string; athlete: Athlete; since: string };
type Data = {
  invite: { code: string; url: string; expires_at: string };
  incoming: Row[]; outgoing: Row[]; connected: Row[];
};

/**
 * Connecting a training partner.
 *
 * Two ways in, and they are the same mechanism from both ends: you hand over a
 * code, or you type one in. There is no search by name — usernames were dropped,
 * and with them the endpoint that would answer "does this person exist".
 *
 * Entering a code sends a request rather than connecting outright. A link travels
 * further than the person it was sent to, so the athlete who created it is the one
 * who confirms who turned up.
 */
export default function Partners({ onOpenVersus }: { onOpenVersus?: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/partners");
    if (r.ok) setD(await r.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<Response>, good?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ text: j.error ?? "That did not go through.", bad: true });
      else if (good || j.note) setMsg({ text: j.note ?? good!, bad: false });
      else setMsg(null);
      if (r.ok) await load();
    } finally { setBusy(false); }
  };

  const share = async () => {
    if (!d) return;
    const text = `Train with me — open this and accept: ${d.invite.url}`;
    // Share sheet where there is one, clipboard where there is not. Both end with
    // the athlete holding something they can paste.
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch { /* dismissed */ }
    }
    await navigator.clipboard?.writeText(d.invite.url);
    setMsg({ text: "Link copied.", bad: false });
  };

  if (!d) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex",
      flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ ...caps, color: TEAL }}>Connections</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700,
          letterSpacing: "-.02em" }}>Connect a training partner</div>
      </div>

      <div style={{ background: PAPER, border: `1px solid ${TEAL}`,
        borderRadius: "var(--r-card)", padding: 16,
        display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ ...caps, color: TEAL }}>Share an invite link</span>
        <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
          Send a link. When they open it, a request comes to you to accept. Works
          whether or not they already have the app. The code works once and lasts
          a week.
        </span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={share} style={{
            flex: "1 1 auto", minWidth: 130, background: "var(--lime)", border: 0,
            borderRadius: "var(--r-pill)", padding: "16px 18px", fontSize: 12,
            fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            color: "var(--on-lime)",
          }}>Share link</button>
          <button onClick={async () => {
            await navigator.clipboard?.writeText(d.invite.code);
            setMsg({ text: "Code copied.", bad: false });
          }} style={{
            flex: "1 1 auto", minWidth: 130, background: PAPER,
            border: `1px solid ${LINE}`, borderRadius: "var(--r-pill)",
            padding: "16px 18px", fontSize: 12, fontWeight: 700, color: INK,
          }}>Copy code: {d.invite.code}</button>
        </div>
        <button onClick={() => act(() => fetch("/api/partners", { method: "POST" }),
          "New code. The old one no longer works.")} disabled={busy} style={{
          alignSelf: "flex-start", fontSize: 11, fontWeight: 700, color: INK55,
          textDecoration: "underline",
        }}>Replace this code</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={caps}>Enter a code</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="7K2M-P4XQ" aria-label="Their invite code"
            autoCapitalize="characters" autoComplete="off" spellCheck={false}
            style={{ flex: 1, background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: 12, padding: "14px 15px", fontSize: 15,
              letterSpacing: ".06em", fontWeight: 700 }} />
          <button disabled={busy || code.trim().length < 8}
            onClick={() => act(async () => {
              const r = await fetch("/api/partners/redeem", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ code }),
              });
              if (r.ok) setCode("");
              return r;
            })} style={{
              flex: "none", background: code.trim().length < 8 ? "var(--off)" : TEAL,
              border: 0, borderRadius: 12, padding: "0 18px", fontSize: 12,
              fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
              color: code.trim().length < 8 ? INK40 : "#fff",
            }}>Send</button>
        </div>
        {msg && (
          <span style={{ fontSize: 12, lineHeight: 1.55,
            color: msg.bad ? "#8A6D14" : TEAL, fontWeight: 600 }}>{msg.text}</span>
        )}
      </div>

      {d.incoming.length > 0 && (
        <Section label="Waiting for you">
          {d.incoming.map((r) => (
            <div key={r.id} style={{ ...card, background: CREAM }}>
              <Who name={r.athlete.display_name} sub="Wants to go head-to-head" />
              <button onClick={() => act(() => patch(r.id, "decline"))} disabled={busy}
                style={{ ...caps, flex: "none", color: INK40, padding: "6px 4px" }}>
                Decline
              </button>
              <button onClick={() => act(() => patch(r.id, "accept"), "Connected.")}
                disabled={busy} style={{
                  flex: "none", border: `1px solid ${TEAL}`, background: PAPER,
                  borderRadius: "var(--r-pill)", padding: "9px 15px", fontSize: 10,
                  fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                  color: TEAL,
                }}>Accept</button>
            </div>
          ))}
        </Section>
      )}

      {d.outgoing.length > 0 && (
        <Section label="Invites you sent">
          {d.outgoing.map((r) => (
            <div key={r.id} style={card}>
              <Who name={r.athlete.display_name} sub={`Sent ${r.since}`} />
              <Pill onClick={() => act(() => del(r.id))} busy={busy}>Cancel</Pill>
            </div>
          ))}
        </Section>
      )}

      {d.connected.length > 0 && (
        <Section label="Connected">
          {d.connected.map((r) => (
            <div key={r.id} style={card}>
              <Who name={r.athlete.display_name} sub={`Connected ${r.since}`} />
              <Pill onClick={() => act(() => del(r.id),
                "Disconnected. The weeks already won are kept if you reconnect.")}
                busy={busy}>Disconnect</Pill>
            </div>
          ))}
        </Section>
      )}

      {d.connected.length > 0 && onOpenVersus && (
        <button onClick={onOpenVersus} style={{
          width: "100%", background: "var(--navy)", border: 0,
          borderRadius: "var(--r-pill)", padding: 16, fontSize: 12, fontWeight: 800,
          letterSpacing: ".06em", textTransform: "uppercase", color: "#fff",
        }}>See the head-to-head</button>
      )}

      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
        A connection shares how much of your own plan you finished each week — the
        share, the sessions, the volume. It does not share your plan, your notes,
        or anything you write to your coach.
      </span>
    </div>
  );
}

const patch = (id: string, action: "accept" | "decline") =>
  fetch(`/api/partners/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      // The rivalry's week boundary is fixed at accept from this clock, so both
      // sides agree when a week ended.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });

const del = (id: string) => fetch(`/api/partners/${id}`, { method: "DELETE" });

const caps: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: ".1em",
  textTransform: "uppercase", color: INK55,
};
const card: React.CSSProperties = {
  background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
  padding: "14px 15px", display: "flex", alignItems: "center", gap: 10,
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={caps}>{label}</span>
      {children}
    </div>
  );
}

function Who({ name, sub }: { name: string; sub: string }) {
  return (
    <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{name}</span>
      <span style={{ fontSize: 11, color: INK55 }}>{sub}</span>
    </span>
  );
}

function Pill({ onClick, busy, children }: {
  onClick: () => void; busy: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={busy} style={{
      flex: "none", background: PAPER, border: `1px solid ${LINE}`,
      borderRadius: "var(--r-pill)", padding: "9px 15px", fontSize: 10,
      fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
      color: INK55,
    }}>{children}</button>
  );
}
