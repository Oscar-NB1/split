"use client";
import { useRef, useState } from "react";

/**
 * Rebuild my week: a bottom sheet in, a preview in place out.
 *
 * Not a pop-up. A centred modal on mobile gets squeezed into a third of the screen by the
 * keyboard, and you lose sight of the week you are describing — which is the one thing you
 * need to see while typing. The input is small, one to three sentences; the output is a
 * whole week. So they want different containers.
 */

const NAVY = "#12314D", TEAL = "#0A8FB0", LIME = "#C6FF5B";

export type Proposal = {
  proposal_id: string;
  summary: string;
  volume_delta: number;
  sessions: {
    id: string; date: string; day: number; kind: string; label: string; title: string;
    km?: number; moved_from: string | null; was_km: number | null;
  }[];
  dropped: { id: string; kind: string; label: string; why: string; day: string }[];
  refusals: { what: string; why: string }[];
  parsed: { ambiguities: { quote: string; question: string; options: string[] }[] };
  rebuilds_left: number;
};

/**
 * The card. Permanent, and the only entry point.
 *
 * The brief argued for a small header link instead — "an always-visible card would be
 * clutter for something used maybe twice a month" — and both the design and his own
 * preference say the card. They are right: a text link in a header is invisible until you
 * already know to look for it, and this is the control that rescues a week that has gone
 * wrong. Something used twice a month is exactly the thing that has to be findable on the
 * day it is needed rather than discoverable in general.
 *
 * The link version was built and deleted rather than left in place. Two entry points to the
 * same sheet is a decision not made.
 */
export function RebuildCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button onClick={onOpen} style={{
      width: "100%", textAlign: "left", background: "var(--paper)",
      border: "1px solid var(--line)", borderRadius: "var(--r-card)",
      padding: "15px 16px", display: "flex", alignItems: "center", gap: 12,
      color: "var(--ink)",
    }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Something changed this week?</span>
        <span style={{ fontSize: 12.5, color: "var(--ink-55)", lineHeight: 1.5 }}>
          Tell us in a sentence and we will rebuild it around what is left.
        </span>
      </span>
      <span aria-hidden="true" style={{
        width: 26, height: 26, borderRadius: "50%", flex: "none",
        border: "1px solid var(--line)", display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 13, color: "var(--ink-55)",
      }}>›</span>
    </button>
  );
}

/**
 * The reactive prompt, which is the better entry point.
 *
 * It arrives at the moment somebody would actually want it, without them having to remember
 * the feature exists — two days with nothing logged is the app already suspecting the week
 * went sideways.
 */
export function RebuildNudge({ empty, onOpen, onDismiss }: {
  empty: string[]; onOpen: () => void; onDismiss: () => void;
}) {
  if (empty.length < 2) return null;
  const days = empty.length === 2 ? empty.join(" and ")
    : `${empty.slice(0, -1).join(", ")} and ${empty[empty.length - 1]}`;
  return (
    <div style={{ background: "var(--paper)", border: `1px solid ${TEAL}`,
      borderRadius: "var(--r-card)", padding: "14px 16px", display: "flex",
      flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        <b>{days} are empty.</b> Something change this week?
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onOpen} style={{ padding: "9px 14px", borderRadius: "var(--r-pill)",
          background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700 }}>
          Rebuild my week
        </button>
        <button onClick={onDismiss} style={{ padding: "9px 12px", fontSize: 12,
          fontWeight: 700, color: "var(--ink-55)" }}>
          No, I&apos;ll catch up
        </button>
      </div>
    </div>
  );
}

/** The sheet. Half-height, week visible behind it, swipe or tap away to dismiss. */
export function RebuildSheet({ monday, onClose, onProposal }: {
  monday: string; onClose: () => void; onProposal: (p: Proposal) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Proposal["parsed"]["ambiguities"][number] | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  async function send(extra?: string) {
    setBusy(true); setErr(null);
    const raw = extra ? `${text}. ${extra}` : text;
    const r = await fetch(`/api/weeks/${monday}/rebuild`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw_text: raw }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "That did not go through."); return; }
    /*
     * One clarifying question, in the same sheet, replacing the button. Never a second text
     * box — somebody who has already described their week should be tapping, not typing.
     */
    if (j.parsed?.ambiguities?.length && !extra) { setAsk(j.parsed.ambiguities[0]); return; }
    onProposal(j as Proposal);
  }

  return (
    <>
      {/* Dimmed, but the week stays legible behind it: that is what you are describing. */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40,
        background: "rgba(14,39,64,.38)" }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41,
        maxWidth: 520, margin: "0 auto", background: "var(--paper)",
        borderRadius: "18px 18px 0 0", padding: "16px 18px calc(20px + env(safe-area-inset-bottom))",
        display: "flex", flexDirection: "column", gap: 12,
        boxShadow: "0 -12px 40px rgba(14,39,64,.22)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>
            What&apos;s changed this week?
          </span>
          <button onClick={onClose} aria-label="Close"
            style={{ fontSize: 18, color: "var(--ink-40)", padding: 4 }}>✕</button>
        </div>

        {!ask && (
          <>
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)}
              rows={3} autoFocus
              placeholder="Out Wed to Fri, can run Friday night. Skipping the Hyrox class. No long run Sunday."
              style={{ width: "100%", resize: "none", borderRadius: 12, padding: "12px 13px",
                border: "1px solid var(--line)", background: "var(--off)", fontSize: 14,
                lineHeight: 1.5 }} />
            {/* Dictation is faster than thumb-typing for a rambling sentence, and the parser
                handles self-correcting speech anyway — so the mic is the point, not a bonus. */}
            <span style={{ fontSize: 11, color: "var(--ink-40)" }}>
              Say it out loud if that is easier — use your keyboard&apos;s microphone. Later
              sentences override earlier ones.
            </span>
            {err && <div className="errbox" role="alert">{err}</div>}
            <button disabled={busy || text.trim().length < 3} onClick={() => send()}
              style={{ padding: "13px 0", borderRadius: "var(--r-pill)", background: NAVY,
                color: "#fff", fontSize: 14, fontWeight: 700,
                opacity: busy || text.trim().length < 3 ? .5 : 1 }}>
              {busy ? "Working out your week…" : "Rebuild my week"}
            </button>
          </>
        )}

        {ask && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{ask.question}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ask.options.map((o) => (
                <button key={o} onClick={() => { setAsk(null); send(o); }}
                  style={{ padding: "9px 14px", borderRadius: "var(--r-pill)",
                    border: `1px solid ${TEAL}`, color: TEAL, fontSize: 12.5, fontWeight: 700 }}>
                  {o}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The confirm bar, pinned above the tab bar.
 *
 * One line of consequence and two actions; the detail is in the rows above, where they can
 * compare it against the week they already have in their head.
 */
export function RebuildBar({ p, onApply, onDiscard, busy }: {
  p: Proposal; onApply: () => void; onDiscard: () => void; busy?: boolean;
}) {
  return (
    <div style={{ position: "sticky", bottom: 0, zIndex: 20, background: NAVY,
      color: "#fff", borderRadius: "var(--r-card)", padding: "13px 15px",
      display: "flex", flexDirection: "column", gap: 10, margin: "12px 0" }}>
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{p.summary}</span>
      {/* Said out loud rather than implied: a rebuild that pretends nothing was lost teaches
          people to distrust the next one. */}
      {p.refusals.map((f) => (
        <span key={f.what} style={{ fontSize: 11.5, color: "rgba(255,255,255,.75)",
          lineHeight: 1.5 }}>
          We have kept {f.what} where it is — {f.why}.
        </span>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDiscard} style={{ flex: 1, padding: "11px 0",
          borderRadius: "var(--r-pill)", border: "1px solid rgba(255,255,255,.35)",
          color: "#fff", fontSize: 13, fontWeight: 700 }}>
          Discard
        </button>
        <button onClick={onApply} disabled={busy} style={{ flex: 1, padding: "11px 0",
          borderRadius: "var(--r-pill)", background: LIME, color: "var(--on-lime)",
          fontSize: 13, fontWeight: 800, opacity: busy ? .6 : 1 }}>
          {busy ? "Applying…" : "Apply"}
        </button>
      </div>
    </div>
  );
}

/**
 * A dropped session, kept visible as a ghost row.
 *
 * Deleting them outright makes the week look thinner than the change actually was, and hides
 * what was given up — which is the thing somebody needs to see before they agree to it.
 */
export function GhostRow({ label, why }: { label: string; why: string }) {
  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: "var(--r-card)",
      padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3,
      background: "transparent" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-40)",
          textDecoration: "line-through" }}>{label}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em",
          color: "#C07A3E" }}>REMOVED</span>
      </span>
      <span style={{ fontSize: 11.5, color: "var(--ink-55)" }}>{why}</span>
    </div>
  );
}
