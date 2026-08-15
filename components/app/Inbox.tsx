"use client";
import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/dates";

const INK40 = "var(--ink-40)", LINE = "var(--line)", PAPER = "var(--paper)";

type Message = {
  id: string; body: string; created_at: string; author_id: string; display_name: string;
};

/**
 * The thread, from either end.
 *
 * Same screen for the coach and the athlete, because it is one conversation.
 * The only asymmetry is which side the bubbles sit on, and that comes from the
 * author id rather than from a role — a coach reading their own message should
 * see it where they left it.
 */
export default function Inbox({
  withId, withName, meId,
}: {
  withId: string; withName: string; meId: string;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const foot = useRef<HTMLDivElement>(null);

  const url = `/api/thread?with=${withId}`;
  useEffect(() => {
    fetch(url).then(async (r) => setMessages(r.ok ? (await r.json()).messages : []));
  }, [url]);

  useEffect(() => { foot.current?.scrollIntoView({ block: "end" }); }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (r.ok) { setDraft(""); setMessages((await r.json()).messages); }
  }

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700,
        letterSpacing: "-.02em" }}>{withName}</span>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {messages?.length === 0 && (
          <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-55)" }}>
            Nothing here yet.
          </span>
        )}
        {(messages ?? []).map((m) => {
          const mine = m.author_id === meId;
          return (
            <div key={m.id} style={{
              display: "flex", flexDirection: "column", gap: 3,
              alignItems: mine ? "flex-end" : "flex-start",
            }}>
              <div style={{
                maxWidth: "84%", padding: "10px 13px", borderRadius: 14,
                fontSize: 13, lineHeight: 1.45,
                background: mine ? "var(--navy)" : PAPER,
                color: mine ? "#fff" : "var(--ink)",
                border: mine ? 0 : `1px solid ${LINE}`,
                borderBottomRightRadius: mine ? 4 : 14,
                borderBottomLeftRadius: mine ? 14 : 4,
              }}>{m.body}</div>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: INK40,
              }}>
                {mine ? "You" : m.display_name} ·{" "}
                {fmt(m.created_at.slice(0, 10), { day: "numeric", month: "short" })}
              </span>
            </div>
          );
        })}
        <div ref={foot} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea value={draft} rows={2} onChange={(e) => setDraft(e.target.value)}
          placeholder={`Write to ${withName}…`} aria-label="Write a message"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
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
    </div>
  );
}
