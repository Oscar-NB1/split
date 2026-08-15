"use client";
import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { kindLabel } from "@/lib/coach";
import type { StepGroup } from "@/lib/prescription";
import Thread from "./Thread";

export type SessionDetail = {
  session: {
    id: string; user_id: string; planned_date: string; title: string; kind: string;
    planned_minutes: number | null; target: string | null; coach_note: string | null;
    status: string; actual_minutes: number | null; significance: string | null;
    slot: string | null; activity_id: string | null; display_name: string;
    effort_points: number | null;
  };
  steps: StepGroup[];
  reps: number;
  lifts: { name: string; sets: number; reps: number; load: number | null }[];
  sets: SetRow[];
  feedback: { rpe: number | null; length_feel: string | null; note: string | null } | null;
  comments: { id: string; body: string; created_at: string; author_id: string; display_name: string }[];
  activity: { id: string; name: string; moving_seconds: number; distance_m: string; avg_hr: string } | null;
};
export type SetRow = {
  id: string; exercise: string; ord: number; set_no: number;
  prescribed_load: number | null; prescribed_reps: number | null;
  load_kg: number | null; reps: number | null; done: boolean; note: string | null;
};

/** Everything both session screens need to load and write. */
export function useSession(id: string) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/session/${id}`);
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Couldn't load it."); return; }
    setD(await r.json());
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/session/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "That didn't save.");
    return r.ok;
  }, [id]);

  return { d, setD, err, load, send };
}

/**
 * The session brief: what to do, and why it exists.
 *
 * The guardrail is given its own panel rather than being buried in a note. On
 * this plan it is the single most repeated instruction — willpower has failed
 * four times on record, so the cap is the point of the screen.
 */
export default function Brief({
  id, meId, openActivity, onChanged,
}: { id: string; meId: string; openActivity: (a: string) => void; onChanged: () => void }) {
  const { d, err, load, send } = useSession(id);
  const [warmOpen, setWarmOpen] = useState(false);

  if (err) return <div className="pad"><div className="errbox" role="alert">{err}</div></div>;
  if (!d) return <div className="pad"><p className="empty">Loading…</p></div>;

  const s = d.session;
  const done = s.status === "done" || s.status === "adjusted";
  // the note's first line is the guardrail; the rest is context
  const noteLines = s.coach_note?.split("\n").filter(Boolean) ?? [];
  const [guardrail, ...rest] = noteLines;

  return (
    <div>
      <div className={`hero${s.significance === "race" ? " gold" : ""}`}>
        <div className="eyebrow">
          {fmt(s.planned_date, { weekday: "long", day: "numeric", month: "long" })}
          {s.slot ? ` · ${s.slot}` : ""}
          {s.user_id !== meId ? ` · ${s.display_name}` : ""}
        </div>
        <h1 className="h1" style={{ marginTop: 8 }}>{s.title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{kindLabel(s.kind)}</p>

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 18 }}>
          <span className="disp" style={{ fontSize: 25 }}>
            {s.planned_minutes ? `${s.planned_minutes} min` : "—"}
          </span>
          {d.reps > 0 && <span style={{ fontSize: 11, color: "var(--ink-55)" }}>{d.reps} reps prescribed</span>}
        </div>

        {s.significance && (
          <span className="tag" style={{
            display: "inline-block", marginTop: 12, background: "var(--navy)",
            color: "#fff", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 10,
          }}>{s.significance}</span>
        )}
      </div>

      {/* ------------------------------------------------------- the guardrail */}
      {guardrail && (
        <div className="band">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 18, height: 18, borderRadius: 5, background: "var(--teal-tint2)",
              color: "var(--teal)", fontSize: 10, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>i</span>
            <span className="caps" style={{ color: "var(--ink)" }}>Why this session matters</span>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-70)" }}>{guardrail}</p>
          {rest.map((line, i) => (
            <p key={i} style={{ fontSize: 12, lineHeight: 1.55, color: "var(--ink-55)" }}>{line}</p>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------- warm-up */}
      <div className="band">
        <button className="rowsplit" style={{ width: "100%" }} onClick={() => setWarmOpen(!warmOpen)}>
          <span className="caps" style={{ color: "var(--ink)" }}>Warm-up</span>
          <span style={{ fontSize: 11, color: "var(--teal)", fontWeight: 700 }}>
            {warmOpen ? "Hide" : "Show"}
          </span>
        </button>
        {warmOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {WARMUP.map((w, i) => (
              <div key={w.name} style={{
                display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 10,
                alignItems: "center", padding: "9px 0", borderTop: i ? "1px solid var(--line-2)" : "none",
              }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", background: "var(--off)",
                  fontSize: 10, fontWeight: 700, display: "flex",
                  alignItems: "center", justifyContent: "center", color: "var(--ink-55)",
                }}>{i + 1}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-55)", lineHeight: 1.4 }}>{w.cue}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--teal)", whiteSpace: "nowrap" }}>{w.dose}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ what to do */}
      {d.steps.length > 0 && (
        <div className="band">
          <span className="caps" style={{ color: "var(--ink)" }}>What to do</span>
          {d.steps.map((g, gi) => (
            <div key={gi} style={{
              border: "1px solid var(--line)", borderRadius: "var(--r-card)", overflow: "hidden",
            }}>
              <div style={{
                padding: "8px 12px", background: g.repeat > 1 ? "var(--navy)" : "var(--off)",
                color: g.repeat > 1 ? "#fff" : "var(--ink-55)",
                fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
              }}>{g.label}</div>
              {g.items.map((it, ii) => (
                <div key={ii} style={{
                  display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center",
                  padding: "11px 12px", borderTop: ii ? "1px solid var(--line-2)" : "none",
                  background: "var(--paper)",
                }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {it.dose || it.label || "—"}
                    </span>
                    {it.dose && it.label && (
                      <span style={{ fontSize: 11, color: "var(--ink-55)" }}>{it.label}</span>
                    )}
                  </span>
                  {it.zone && (
                    <span className="tag" style={{
                      background: it.rest ? "var(--off)" : "var(--teal-tint)",
                      color: it.rest ? "var(--ink-55)" : "var(--teal)", fontWeight: 700,
                    }}>{it.zone}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* --------------------------------------------------------- outcome */}
      {d.activity && (
        <div className="band">
          <span className="caps" style={{ color: "var(--ink)" }}>Logged</span>
          <button className="sess" onClick={() => openActivity(d.activity!.id)}>
            <span className="edge" style={{ background: "var(--teal)" }} />
            <span className="body">
              <span className="title" style={{ fontSize: 16 }}>{d.activity.name}</span>
              <span className="metrics">
                <span>{Math.round(d.activity.moving_seconds / 60)} min</span>
                <span>{Number(d.activity.distance_m) ? `${(Number(d.activity.distance_m) / 1000).toFixed(2)} km` : ""}</span>
                <span>{d.activity.avg_hr ? `${Math.round(Number(d.activity.avg_hr))} bpm` : ""}</span>
              </span>
            </span>
          </button>
        </div>
      )}

      <Rpe d={d} send={send} reload={load} />
      <Thread comments={d.comments} meId={meId} send={send} reload={load} />

      <div className="pad">
        <button className="btn-primary" onClick={async () => {
          await send({ action: "complete", done: !done });
          await load(); onChanged();
        }}>
          {done ? "Mark not done" : "Mark complete"}
        </button>
      </div>
    </div>
  );
}

/** A fixed warm-up. The plan prescribes sessions, not mobility, so this is ours. */
const WARMUP = [
  { name: "Easy jog", cue: "Conversational. Nothing to prove yet.", dose: "8 min" },
  { name: "Leg swings", cue: "Front-to-back then side-to-side, holding something.", dose: "10 each" },
  { name: "Walking lunge", cue: "Long step, back knee low, chest tall.", dose: "10 each" },
  { name: "A-skips", cue: "Quick ground contact, tall posture.", dose: "2 × 20 m" },
  { name: "Strides", cue: "Build to target pace, not past it.", dose: "4 × 20 s" },
];

/** RPE and how long it felt. Both are the athlete's report, not the watch's. */
export function Rpe({
  d, send, reload,
}: { d: SessionDetail; send: (b: Record<string, unknown>) => Promise<boolean>; reload: () => void }) {
  const rpe = d.feedback?.rpe ?? null;
  const feel = d.feedback?.length_feel ?? null;
  return (
    <div className="band">
      <span className="caps" style={{ color: "var(--ink)" }}>How did it feel?</span>
      <div style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} onClick={async () => { await send({ action: "feedback", rpe: n }); reload(); }}
            style={{
              flex: 1, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: rpe === n ? "var(--navy)" : "var(--off)",
              color: rpe === n ? "#fff" : "var(--ink-55)",
            }}>{n}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {["short", "right", "long"].map((f) => (
          <button key={f} onClick={async () => { await send({ action: "feedback", length_feel: f }); reload(); }}
            style={{
              flex: 1, padding: "9px 0", borderRadius: "var(--r-pill)", fontSize: 11, fontWeight: 700,
              border: "1px solid var(--line)",
              background: feel === f ? "var(--teal-tint)" : "transparent",
              color: feel === f ? "var(--teal)" : "var(--ink-55)",
              borderColor: feel === f ? "var(--teal)" : "var(--line)",
            }}>
            {f === "short" ? "Too short" : f === "right" ? "About right" : "Too long"}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 10, color: "var(--ink-40)" }}>
        RPE is your read, not the watch&apos;s. It is the only number here a heart-rate
        strap cannot produce.
      </p>
    </div>
  );
}
