"use client";
import { useState } from "react";
import { fmt } from "@/lib/dates";

type Comment = {
  id: string; body: string; created_at: string; author_id: string; display_name: string;
};

/**
 * The coach thread on a session.
 *
 * Two people, so no read receipts and no threading — the useful thing is simply
 * that a note lives on the session it is about, rather than in a chat app where
 * nobody can find it three weeks later.
 */
export default function Thread({
  comments, meId, send, reload,
}: {
  comments: Comment[]; meId: string;
  send: (b: Record<string, unknown>) => Promise<boolean>; reload: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function post() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await send({ action: "comment", body: text });
    if (ok) { setDraft(""); reload(); }
    setBusy(false);
  }

  return (
    <div className="band">
      <span className="caps" style={{ color: "var(--ink)" }}>Coach thread</span>

      {comments.length === 0 && (
        <p className="empty" style={{ padding: 0 }}>Nothing said about this one yet.</p>
      )}

      {comments.map((c) => {
        const mine = c.author_id === meId;
        return (
          <div key={c.id} style={{
            display: "flex", flexDirection: "column", gap: 3,
            alignItems: mine ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "84%", padding: "10px 13px", borderRadius: 14, fontSize: 13, lineHeight: 1.45,
              background: mine ? "var(--navy)" : "var(--off)",
              color: mine ? "#fff" : "var(--ink)",
              borderBottomRightRadius: mine ? 4 : 14,
              borderBottomLeftRadius: mine ? 14 : 4,
            }}>{c.body}</div>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
              textTransform: "uppercase", color: "var(--ink-40)",
            }}>
              {mine ? "You" : c.display_name} · {fmt(c.created_at.slice(0, 10), { day: "numeric", month: "short" })}
            </span>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && post()}
          placeholder="Write feedback…" aria-label="Write feedback"
          style={{ flex: 1, borderRadius: "var(--r-pill)", background: "var(--off)" }} />
        <button onClick={post} disabled={busy || !draft.trim()} aria-label="Send"
          style={{
            background: "var(--navy)", borderRadius: "50%", width: 42, height: 42,
            color: "var(--lime)", fontSize: 16, flex: "none",
            opacity: draft.trim() ? 1 : .5,
          }}>↑</button>
      </div>
    </div>
  );
}
