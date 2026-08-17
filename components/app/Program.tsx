"use client";
import { useState } from "react";
import { addDays, fmt, today } from "@/lib/dates";
import { kindColour, kindLabel, weekDates } from "@/lib/coach";
import { weekOf } from "@/lib/block";
import type { Session, User, WeekData } from "./Shell";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Written out, because "always on Mon" reads like an abbreviation of a thought. */
const DAYS_LONG = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays",
  "Saturdays", "Sundays"];
const TEAL = "#0A8FB0", LIME = "#C6FF5B", NAVY = "#12314D";
const TEAL_T = "var(--teal-tint)", TEAL_T2 = "var(--teal-tint2)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)", CREAM = "var(--cream)";

const slotChip = (slot: string | null | undefined): React.CSSProperties => ({
  fontSize: 9, fontWeight: 800, letterSpacing: ".08em", padding: "3px 7px",
  borderRadius: "var(--r-pill)",
  background: slot === "PM" ? NAVY : OFF, color: slot === "PM" ? LIME : INK55,
});

/**
 * The week editor.
 *
 * Two ways to move a session, as the design has it: drag it (which works with a
 * mouse) or press ⇅ and then a day (which works with a thumb, where dragging
 * inside a scrolling list fights the scroll). Both end at the same PATCH.
 *
 * Moving warns rather than refuses — a session in a bad slot produces a message,
 * not a rejection, because the athlete keeps agency and the change log keeps the
 * history.
 */
export default function Program({
  data, me, other, monday, setMonday, reload, openSession, openPicker,
}: {
  data: WeekData | null; me: User; other: User | null;
  monday: string; setMonday: (d: string) => void; reload: () => void;
  openSession: (s: Session) => void; openPicker: (date: string, slot: "AM" | "PM") => void;
}) {
  const [who, setWho] = useState<"me" | "them">("me");
  const [moving, setMoving] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /*
   * The move the plan could learn from.
   *
   * Offered rather than inferred. Three moves in a row is a pattern, and it is also
   * possibly three busy Wednesdays — guessing wrong reshapes somebody's block without
   * being asked, which is worse than not learning at all.
   */
  const [offer, setOffer] = useState<{
    id: string; kind: string; label: string; weekday: number;
  } | null>(null);

  if (!data) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  const uid = who === "me" ? me.id : other?.id;
  const all = data.sessions.filter((s) => s.user_id === uid);
  const dates = weekDates(monday);
  // the week strip is the athlete's own block, so an athlete without one gets no
  // strip rather than a row of someone else's week numbers
  const WEEKS = data.block?.weeks ?? [];
  const week = weekOf(data.block, monday);

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/sessions/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setNote(j.error ?? "That didn't save."); return null; }
    setNote((j.learned as string) ?? (j.warning as string) ?? null);
    reload();
    return j as Record<string, unknown>;
  }

  const moveTo = async (i: number) => {
    const id = dragging || moving;
    if (!id) return;
    const s = all.find((x) => x.id === id);
    setDragging(null); setDragOver(null); setMoving(null);
    if (!s || s.planned_date === dates[i]) return;
    setOffer(null);
    const ok = await patch(id, { action: "move", to_date: dates[i] });
    /*
     * Only offered for sessions the plan wrote.
     *
     * A commitment is already on a day the athlete chose — the plan schedules around
     * it and has nothing to learn from them moving their own class.
     */
    if (ok && s.source === "template") {
      setOffer({ id, kind: s.kind, label: kindLabel(s.kind), weekday: i });
    }
  };

  const active = !!(moving || dragging);

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>
          {who === "me" ? "Program · me" : `Coaching · ${other?.display_name}`}
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 5 }}>
          {week ? `Week ${week.n} · ${fmt(monday, { day: "numeric", month: "long" })}`
            : fmt(monday, { day: "numeric", month: "long" })}
        </div>
        {/* The athlete's own block. This line was one athlete's — "Hyrox doubles ·
            15 weeks to 28 Nov. Target 55:00–56:30 from 1:00:45" — printed above
            everybody's week, including the weeks of anyone with a different race. */}
        {data.block && (
          <div style={{ fontSize: 12, color: INK55, marginTop: 8, lineHeight: 1.5 }}>
            {[
              data.block.name,
              data.block.race_date
                ? `${data.block.weeks.length} weeks to ${fmt(data.block.race_date, { day: "numeric", month: "short" })}`
                : null,
              data.block.goal_label ? `target ${data.block.goal_label}` : null,
            ].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>

      {other && (
        <div style={{ display: "flex", gap: 3, background: OFF, borderRadius: "var(--r-pill)", padding: 3 }}>
          {(["me", "them"] as const).map((w) => (
            <button key={w} onClick={() => setWho(w)} style={{
              flex: 1, padding: "7px 16px", borderRadius: "var(--r-pill)", fontSize: 12,
              fontWeight: 700, background: who === w ? NAVY : "transparent",
              color: who === w ? "#fff" : INK55,
            }}>{w === "me" ? "Mine" : other.display_name}</button>
          ))}
        </div>
      )}

      {WEEKS.length > 0 && (
      <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 4 }}>
        {WEEKS.map((w) => (
          <button key={w.n} onClick={() => setMonday(w.start)} style={{
            flex: "none", minWidth: 44, display: "flex", flexDirection: "column",
            alignItems: "center", gap: 1, padding: "8px 6px", borderRadius: 10,
            border: `1px solid ${LINE}`,
            background: w.start === monday ? NAVY : PAPER,
            color: w.start === monday ? "#fff" : INK55,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>W{w.n}</span>
            <span style={{ fontSize: 9, opacity: .8 }}>{w.km}k</span>
          </button>
        ))}
      </div>
      )}

      <div style={{ fontSize: 11, lineHeight: 1.55, padding: "11px 13px",
        borderRadius: "var(--r-card)", background: week?.note ? CREAM : PAPER,
        border: `1px solid ${LINE}`, color: week?.note ? "var(--ink)" : INK55 }}>
        {week?.note || `${week?.km ?? "—"} km · Mon strength + kickboxing, Tue key session, Sat Hyrox continuous, Sun long run.`}
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.5, padding: "9px 4px",
        color: active ? TEAL : INK40, fontWeight: active ? 700 : 500 }}>
        {moving ? "Pick a day to move it to."
          : dragging ? "Drop it on a day."
          : "Drag a session to another day, or press ⇅ then a day."}
      </div>

      {note && <div className="warnbox">{note}</div>}

      {offer && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
          background: TEAL_T2, border: `1px solid ${TEAL}`, borderRadius: "var(--r-card)",
          padding: "12px 14px" }}>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, flex: 1, minWidth: 180 }}>
            Moved. Should {offer.label.toLowerCase()} always be on {DAYS_LONG[offer.weekday]}?
          </span>
          <button onClick={async () => {
            const o = offer;
            setOffer(null);
            /*
             * Re-sent as the same move with `always`, rather than a separate
             * endpoint: the day is already correct, so this is the athlete
             * confirming what the move meant rather than making a second change.
             */
            await patch(o.id, { action: "move", to_date: dates[o.weekday], always: true });
          }} style={{ padding: "8px 14px", borderRadius: "var(--r-pill)", fontSize: 12,
            fontWeight: 700, background: NAVY, color: "#fff" }}>
            Always
          </button>
          <button onClick={() => setOffer(null)} style={{ padding: "8px 12px", fontSize: 12,
            fontWeight: 700, color: INK55 }}>
            Just this week
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {dates.map((date, i) => {
          const items = all.filter((s) => s.planned_date === date)
            .sort((a, b) => Number(a.slot === "PM") - Number(b.slot === "PM"));
          return (
            <div key={date}
              onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
              onDragLeave={() => { if (dragOver === i) setDragOver(null); }}
              onDrop={(e) => { e.preventDefault(); moveTo(i); }}
              style={{
                display: "flex", gap: 8, alignItems: "flex-start", padding: 6,
                borderRadius: "var(--r-card)",
                background: dragOver === i ? TEAL_T2 : active ? TEAL_T : "transparent",
                outline: dragOver === i ? `1px dashed ${TEAL}` : "none", outlineOffset: -2,
              }}>
              <button onClick={() => moveTo(i)} style={{
                width: 42, flex: "none", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2, padding: "9px 0", borderRadius: 12,
                cursor: moving ? "pointer" : "default", color: "var(--ink)", background: PAPER,
                border: `1px ${moving || dragOver === i ? `dashed ${TEAL}` : `solid ${LINE}`}`,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                  textTransform: "uppercase", color: date === today() ? TEAL : INK40 }}>{DAYS[i]}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{fmt(date, { day: "numeric" })}</span>
              </button>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                {items.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <button onClick={() => openSession(s)} draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", s.id);
                        setDragging(s.id); setMoving(null);
                      }}
                      onDragEnd={() => { setDragging(null); setDragOver(null); }}
                      style={{
                        flex: 1, textAlign: "left", padding: 0, display: "flex",
                        alignItems: "stretch", background: PAPER,
                        border: `1px solid ${moving === s.id || dragging === s.id ? TEAL : LINE}`,
                        borderRadius: "var(--r-card)", overflow: "hidden", color: "var(--ink)",
                        cursor: "grab", opacity: dragging === s.id ? .45 : 1,
                      }}>
                      <span style={{ width: 4, flex: "none", alignSelf: "stretch",
                        background: kindColour(s.kind) }} />
                      <span style={{ display: "flex", flexDirection: "column", gap: 3,
                        padding: "9px 11px" }}>
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {s.slot && <span style={slotChip(s.slot)}>{s.slot}</span>}
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                            textTransform: "uppercase", color: INK40 }}>{kindLabel(s.kind)}</span>
                          {s.status === "done" && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: TEAL }}>DONE</span>
                          )}
                          {s.status === "skipped" && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#C07A3E" }}>SKIPPED</span>
                          )}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
                        <span style={{ fontSize: 11, color: INK55 }}>
                          {s.planned_minutes ? `${s.planned_minutes} min` : "—"}
                        </span>
                      </span>
                    </button>

                    <button onClick={() => patch(s.id, { action: "slot", slot: s.slot === "AM" ? "PM" : "AM" })}
                      aria-label="Swap AM and PM" style={{
                        width: 32, flex: "none", borderRadius: "var(--r-card)", fontSize: 9,
                        fontWeight: 800, letterSpacing: ".04em", border: `1px solid ${LINE}`,
                        background: PAPER, color: INK55,
                      }}>{s.slot === "AM" ? "PM" : "AM"}</button>

                    <button onClick={() => setMoving(moving === s.id ? null : s.id)}
                      aria-label="Pick up to move" style={{
                        width: 32, flex: "none", borderRadius: "var(--r-card)", fontSize: 14,
                        border: `1px solid ${moving === s.id ? TEAL : LINE}`,
                        background: moving === s.id ? TEAL_T : PAPER,
                        color: moving === s.id ? TEAL : INK55,
                      }}>⇅</button>
                  </div>
                ))}

                <button onClick={() => openPicker(date, items.some((x) => x.slot === "AM") ? "PM" : "AM")}
                  style={{
                    textAlign: "left", border: "1px dashed rgba(18,49,77,.18)",
                    borderRadius: "var(--r-card)", padding: "9px 11px", color: INK55,
                    fontSize: 11, fontWeight: 600, background: "none",
                  }}>+ Add session</button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: INK55 }}>Guardrails</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            `${week?.km ?? "—"} km target`,
            "Two hard days: Tue and Sat",
            "Easy runs under 152 bpm",
            "Doubles pair easy runs only",
          ].map((t) => (
            <span key={t} style={{ fontSize: 11, fontWeight: 600, color: TEAL,
              background: TEAL_T, border: `1px solid ${TEAL_T2}`,
              borderRadius: "var(--r-pill)", padding: "6px 12px" }}>{t}</span>
          ))}
        </div>
      </div>

      <p className="empty">
        A move warns rather than refuses. Nothing rolls forward: a skipped session leaves no
        debt, it feeds next week&apos;s volume instead.
      </p>
    </div>
  );
}
