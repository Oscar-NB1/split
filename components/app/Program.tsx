"use client";
import { useState } from "react";
import { addDays, fmt, today } from "@/lib/dates";
import { kindColour, kindLabel, weekDates, weekOf, WEEKS } from "@/lib/coach";
import type { Session, User, WeekData } from "./Shell";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The week editor.
 *
 * Moving a session is a tap-to-pick-up, tap-to-drop interaction rather than
 * drag-and-drop. This is a phone: dragging inside a vertically scrolling list
 * fights the scroll, and on iOS a long-press to start a drag collides with the
 * system text-selection gesture. Two taps always work.
 */
export default function Program({
  data, me, other, monday, setMonday, reload, openSession, openPicker,
}: {
  data: WeekData | null; me: User; other: User | null;
  monday: string; setMonday: (d: string) => void; reload: () => void;
  openSession: (s: Session) => void; openPicker: (date: string, slot: "AM" | "PM") => void;
}) {
  const [who, setWho] = useState<"me" | "them">("me");
  const [held, setHeld] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!data) return <div className="pad"><p className="empty">Loading…</p></div>;

  const uid = who === "me" ? me.id : other?.id;
  const all = data.sessions.filter((s) => s.user_id === uid);
  const dates = weekDates(monday);
  const week = weekOf(monday);

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch(`/api/sessions/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setNote(j.error ?? "That didn't save."); return false; }
    // the engine warns rather than refuses — a bad slot is a message, not a block
    setNote((j.warning as string) ?? null);
    reload();
    return true;
  }

  async function dropOn(date: string) {
    if (!held) return;
    if (held.planned_date === date) { setHeld(null); return; }
    if (await act(held.id, { action: "move", to_date: date })) setHeld(null);
  }

  const plannedKm = week?.km ?? null;

  return (
    <div className="pad">
      <div>
        <div className="eyebrow">
          {week ? `Week ${week.n} · ${week.km} km` : "Outside the block"}
        </div>
        <h1 className="h2" style={{ marginTop: 5 }}>
          {fmt(monday, { day: "numeric", month: "long" })} – {fmt(addDays(monday, 6), { day: "numeric", month: "long" })}
        </h1>
        {week?.note && <p className="muted" style={{ marginTop: 6 }}>{week.note}</p>}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" style={{ width: 46, padding: "10px 0" }}
          onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">←</button>
        {other && (
          <div className="pillrow" style={{ flex: 1 }}>
            <button aria-pressed={who === "me"} onClick={() => setWho("me")}>Mine</button>
            <button aria-pressed={who === "them"} onClick={() => setWho("them")}>{other.display_name}</button>
          </div>
        )}
        <button className="btn-ghost" style={{ width: 46, padding: "10px 0" }}
          onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">→</button>
      </div>

      {/* the block's week strip, so a move is made with the volume in view */}
      <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 4 }}>
        {WEEKS.map((w) => (
          <button key={w.n} onClick={() => setMonday(w.start)}
            style={{
              flex: "none", minWidth: 44, padding: "8px 6px", borderRadius: 10,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              background: w.start === monday ? "var(--navy)" : "var(--paper)",
              color: w.start === monday ? "#fff" : "var(--ink-55)",
              border: "1px solid var(--line)",
            }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{w.n}</span>
            <span style={{ fontSize: 9, opacity: .8 }}>{w.km}k</span>
          </button>
        ))}
      </div>

      {held && (
        <div className="okbox">
          Holding <b>{held.title}</b> — tap a day to move it, or{" "}
          <button onClick={() => setHeld(null)} style={{ textDecoration: "underline", color: "inherit" }}>
            put it back
          </button>.
        </div>
      )}
      {note && <div className="warnbox">{note}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {dates.map((date, i) => {
          const items = all.filter((s) => s.planned_date === date);
          const isTarget = held && held.planned_date !== date;
          return (
            <div key={date} style={{
              display: "flex", gap: 8, alignItems: "stretch",
              background: isTarget ? "var(--teal-tint)" : "transparent",
              borderRadius: "var(--r-card)", padding: isTarget ? 4 : 0,
              outline: isTarget ? "1px dashed var(--teal)" : "none",
            }}>
              <button onClick={() => dropOn(date)} disabled={!held || busy}
                style={{
                  width: 52, flex: "none", borderRadius: 12, display: "flex",
                  flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                  background: date === today() ? "var(--navy)" : "var(--paper)",
                  color: date === today() ? "#fff" : "var(--ink)",
                  border: "1px solid var(--line)",
                  cursor: held ? "pointer" : "default",
                }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
                  textTransform: "uppercase", opacity: .6 }}>{DOW[i]}</span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{fmt(date, { day: "numeric" })}</span>
              </button>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                {items.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <button onClick={() => openSession(s)} className="sess" style={{ flex: 1 }}>
                      <span className="edge" style={{ background: kindColour(s.kind) }} />
                      <span className="body" style={{ padding: "9px 11px", gap: 3 }}>
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {s.slot && <span className="slot">{s.slot}</span>}
                          <span className="kindlab" style={{ fontSize: 9 }}>{kindLabel(s.kind)}</span>
                          {s.status === "done" && <span className="tag done" style={{ fontSize: 9, padding: "2px 7px" }}>done</span>}
                          {s.status === "skipped" && <span className="tag skip" style={{ fontSize: 9, padding: "2px 7px" }}>skipped</span>}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
                        <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
                          {s.planned_minutes ? `${s.planned_minutes} min` : "—"}
                        </span>
                      </span>
                    </button>

                    <button onClick={() => act(s.id, { action: "slot", slot: s.slot === "AM" ? "PM" : "AM" })}
                      aria-label="Swap AM/PM" style={sideBtn}>
                      {s.slot === "PM" ? "PM" : "AM"}
                    </button>
                    <button onClick={() => setHeld(held?.id === s.id ? null : s)}
                      aria-label="Pick up to move"
                      style={{ ...sideBtn, background: held?.id === s.id ? "var(--navy)" : "var(--paper)",
                        color: held?.id === s.id ? "#fff" : "var(--ink-40)" }}>⇅</button>
                  </div>
                ))}

                <button onClick={() => openPicker(date, items.some((x) => x.slot === "AM") ? "PM" : "AM")}
                  style={{
                    padding: "9px 0", borderRadius: 10, border: "1px dashed var(--line)",
                    fontSize: 11, fontWeight: 600, color: "var(--ink-40)",
                  }}>+ Add session</button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="caps">Guardrails</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            plannedKm ? `${plannedKm} km target` : null,
            "Two hard days: Tue and Sat",
            "Easy runs under 152 bpm",
            "Doubles pair easy runs only",
          ].filter(Boolean).map((t) => <span key={t as string} className="chip">{t}</span>)}
        </div>
      </div>

      <p className="empty">
        Moving a session warns rather than refuses — a bad slot is a message, not a
        block. Nothing rolls forward: a skipped session leaves no debt, it feeds next
        week&apos;s volume instead.
      </p>
    </div>
  );
}

const sideBtn = {
  width: 40, flex: "none" as const, borderRadius: 10, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--ink-40)", fontSize: 10, fontWeight: 700,
};
