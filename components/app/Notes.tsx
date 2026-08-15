"use client";
import { useEffect, useState } from "react";

const TEAL = "#0A8FB0";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

type Ctx = { key: string; label: string; hint: string; body: string };
type Warm = { id: string; body: string };

/**
 * What she reads in her week, written in advance.
 *
 * Two lists rather than one. A context message is keyed to a kind of week and
 * shown every time one comes round; a warm message belongs to no week and
 * rotates. Written ahead of time because the useful version of this is not a
 * notification at six in the morning — it is something already there when the
 * week opens.
 *
 * Only the coach sees this screen. She sees the one message her week resolved
 * to, in her week: seeing the rotation would spoil it, and reading the taper
 * message in August would spoil that too.
 */
export default function Notes({
  athleteId, athleteName, openInbox, openAthlete,
}: {
  athleteId: string; athleteName: string;
  openInbox: () => void; openAthlete: () => void;
}) {
  const [ctx, setCtx] = useState<Ctx[]>([]);
  const [warm, setWarm] = useState<Warm[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const url = `/api/notes?athlete=${athleteId}`;
  useEffect(() => {
    fetch(url).then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      setCtx(j.contexts); setWarm(j.warm);
    });
  }, [url]);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch(url, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) return;
    const j = await r.json();
    setCtx(j.contexts); setWarm(j.warm);
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    const r = await fetch(`/api/thread?with=${athleteId}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (r.ok) { setDraft(""); setSent(true); }
  }

  const written = ctx.filter((c) => c.body.trim()).length;
  const rotating = warm.filter((w) => w.body.trim()).length;

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>
          Messages for {athleteName}
        </span>
        <span style={{ fontSize: 12, lineHeight: 1.55, color: INK55 }}>
          {written} of {ctx.length} kinds of week written
          {rotating > 0 ? `, ${rotating} in rotation` : ""}.
        </span>
      </div>

      {/* Sending one now is a different act from writing one for later, so it
          is a different control — the thread, not the rotation. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ ...caps, color: TEAL }}>Send one now</span>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea value={draft} rows={2}
            onChange={(e) => { setDraft(e.target.value); setSent(false); }}
            placeholder={`Something for ${athleteName} to read now…`}
            aria-label="Send a message now"
            style={{
              flex: 1, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 14,
              padding: "12px 13px", fontSize: 13, lineHeight: 1.5, color: "var(--ink)",
              resize: "none",
            }} />
          <button onClick={send} disabled={busy || !draft.trim()} aria-label="Send"
            style={{
              background: "var(--navy)", borderRadius: "50%", width: 42, height: 42,
              color: "var(--lime)", fontSize: 16, flex: "none",
              opacity: draft.trim() ? 1 : .5,
            }}>↑</button>
        </div>
        {sent && <span style={{ fontSize: 11, color: TEAL }}>Sent.</span>}
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <button onClick={openInbox} style={{ ...link, color: TEAL }}>Open the thread ›</button>
          <button onClick={openAthlete} style={{ ...link, color: INK55 }}>
            Preview her week ›
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>One per kind of week</span>
        {ctx.map((c) => (
          <label key={c.key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ ...caps, fontSize: 10, letterSpacing: ".08em", color: TEAL }}>
              {c.label}
            </span>
            <textarea defaultValue={c.body} rows={2}
              onBlur={(e) => e.target.value.trim() !== c.body.trim()
                && save({ context: c.key, body: e.target.value })}
              style={box} />
            <span style={{ fontSize: 10, color: INK40 }}>{c.hint}</span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>In rotation</span>
        {warm.map((w, i) => (
          <div key={w.id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "baseline",
              justifyContent: "space-between", gap: 10 }}>
              <span style={{ ...caps, fontSize: 10, letterSpacing: ".08em", color: INK40 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <button onClick={() => save({ id: w.id, remove: true })}
                style={{ ...link, fontSize: 10, color: INK40 }}>Remove</button>
            </div>
            <textarea defaultValue={w.body} rows={2}
              placeholder={`Write something for ${athleteName}…`}
              onBlur={(e) => e.target.value.trim() !== w.body.trim()
                && save({ id: w.id, body: e.target.value })}
              style={box} />
          </div>
        ))}
        <button onClick={() => save({ action: "add-warm" })} disabled={busy} style={{
          width: "100%", background: PAPER, border: `1px dashed ${LINE}`,
          borderRadius: "var(--r-pill)", padding: 14, fontSize: 12, fontWeight: 700,
          color: INK55,
        }}>Add a message</button>
      </div>
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

const link: React.CSSProperties = {
  background: "none", border: 0, padding: 0, fontSize: 11, fontWeight: 700,
  letterSpacing: ".06em", textTransform: "uppercase",
};

const box: React.CSSProperties = {
  background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
  padding: "12px 13px", fontSize: 13, lineHeight: 1.5, color: "var(--ink)",
  resize: "vertical", width: "100%",
};
