"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Saying what you did, on the way out of the gym.
 *
 * Strava's account of a Hyrox class is "WeightTraining, 111 minutes". Everything that made it a
 * session — the stations, the load, how it felt, the knee that started complaining on the
 * lunges — exists for about as long as it takes to reach the car park. Typing it is a chore
 * nobody does twice; saying it takes fifteen seconds.
 *
 * The recorder is the fast path and the textarea is the one that always works. `MediaRecorder`
 * is missing on older iOS, the permission can be denied, transcription can be unconfigured or
 * down — and in every one of those cases the box is still there and the words still land.
 */

type Structured = {
  summary: string;
  kind: string | null;
  duration_min: number | null;
  rpe: number | null;
  stations: { name: string; detail: string | null }[];
  lifts: { name: string; sets: number | null; reps: number | null; load_kg: number | null }[];
  running_km: number | null;
  notes: string | null;
};

type Suggestion =
  | { type: "reclassify"; from: string; to: string; why: string }
  | { type: "save_lifts"; count: number };

type Saved = {
  transcript: string; source: string; structured: Structured | null;
  suggestions: Suggestion[]; read: boolean;
};

const INK55 = "var(--ink-55)";
const say = (k: string) => k.replace(/_/g, " ");

export default function LogVoice({
  sessionId, activityId, onDate, onApplied,
}: {
  sessionId?: string | null;
  activityId?: string | null;
  onDate?: string | null;
  /** a suggestion was accepted, so whatever is showing this needs to reload */
  onApplied?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  /* A running count, because a recorder with no elapsed time feels broken. */
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const canRecord = typeof window !== "undefined"
    && typeof MediaRecorder !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia);

  async function send(body: Record<string, unknown>) {
    setBusy("Reading it…");
    setErr(null);
    const r = await fetch("/api/log", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId ?? null, activity_id: activityId ?? null,
        on_date: onDate ?? null, ...body,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(j.error ?? "That did not save."); return; }
    setSaved(j as Saved);
    setText("");
  }

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      /*
       * Whatever the browser will give us. Safari records mp4/aac and Chrome webm/opus; asking
       * for a specific one is how this ends up working on one phone and not the other.
       */
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 1200) { setErr("That was too short to hear."); return; }
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        await send({ audio: btoa(bin), mime: mr.mimeType || "audio/webm" });
      };
      rec.current = mr;
      setSeconds(0);
      setRecording(true);
      mr.start();
    } catch {
      /* Denied, or no microphone. The textarea is right there. */
      setErr("No microphone — type it instead.");
    }
  }

  function stop() {
    setRecording(false);
    rec.current?.stop();
    rec.current = null;
  }

  async function apply(s: Suggestion) {
    if (!sessionId) return;
    setBusy("Applying…");
    const body = s.type === "reclassify"
      ? { action: "apply_log_kind", kind: s.to }
      : { action: "save_log_lifts", lifts: saved?.structured?.lifts ?? [] };
    const r = await fetch(`/api/session/${sessionId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(j.error ?? "That did not apply."); return; }
    setSaved({ ...saved!, suggestions: (saved?.suggestions ?? []).filter((x) => x !== s) });
    onApplied?.();
  }

  const s = saved?.structured;

  return (
    <div style={{ margin: "14px 18px 0", padding: "14px 16px", background: "var(--paper)",
      border: "1px solid var(--line)", borderRadius: "var(--r-card)" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
        textTransform: "uppercase", color: INK55 }}>What did you do?</div>

      {!saved && (
        <>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-70)", margin: "6px 0 10px" }}>
            Say it out loud — stations, weights, how it felt. Rough is fine.
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
            placeholder="Hyrox class, about an hour, sled push and pull, 50 wall balls, felt like an 8…"
            style={{ width: "100%", padding: "10px 12px", fontSize: 14, lineHeight: 1.5,
              borderRadius: 10, border: "1px solid var(--line)", background: "var(--off)",
              color: "var(--ink)", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            {canRecord && (
              <button onClick={recording ? stop : start} disabled={Boolean(busy)}
                style={{ padding: "10px 16px", fontSize: 11, fontWeight: 800,
                  letterSpacing: ".06em", textTransform: "uppercase",
                  borderRadius: "var(--r-pill)",
                  background: recording ? "#A01B1B" : "var(--off)",
                  color: recording ? "#fff" : "var(--ink)",
                  border: "1px solid var(--line)" }}>
                {recording
                  ? `Stop · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                  : "Record"}
              </button>
            )}
            <button disabled={!text.trim() || Boolean(busy)} onClick={() => send({ text })}
              style={{ padding: "10px 16px", fontSize: 11, fontWeight: 800,
                letterSpacing: ".06em", textTransform: "uppercase",
                borderRadius: "var(--r-pill)",
                background: text.trim() ? "var(--lime)" : "var(--off)",
                color: text.trim() ? "var(--on-lime)" : INK55 }}>
              {busy ?? "Save"}
            </button>
          </div>
        </>
      )}

      {saved && (
        <div style={{ marginTop: 8 }}>
          {/* The words first. They are the record; everything below is a reading of them. */}
          <div style={{ fontSize: 13, lineHeight: 1.55, fontStyle: "italic",
            color: "var(--ink-70)" }}>“{saved.transcript}”</div>

          {s && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.summary}</div>
              <div style={{ fontSize: 11, color: INK55 }}>
                {[
                  s.kind ? say(s.kind) : null,
                  s.duration_min ? `${s.duration_min} min` : null,
                  s.running_km ? `${s.running_km} km running` : null,
                  s.rpe ? `RPE ${s.rpe}` : null,
                ].filter(Boolean).join(" · ")}
              </div>
              {s.stations.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-70)", marginTop: 4 }}>
                  {s.stations.map((st) => st.detail ? `${st.name} (${st.detail})` : st.name)
                    .join(" · ")}
                </div>
              )}
              {s.lifts.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-70)" }}>
                  {s.lifts.map((l) => [l.name, l.sets && l.reps ? `${l.sets}×${l.reps}` : null,
                    l.load_kg ? `${l.load_kg} kg` : null].filter(Boolean).join(" "))
                    .join(" · ")}
                </div>
              )}
              {s.notes && (
                <div style={{ fontSize: 12, color: "var(--ink-70)", marginTop: 4 }}>{s.notes}</div>
              )}
            </div>
          )}

          {!saved.read && (
            <div style={{ fontSize: 11, color: INK55, marginTop: 8 }}>
              Saved as written — nothing read it into detail, which changes nothing about the
              words being kept.
            </div>
          )}

          {/*
            * Offered, not done. Each one is a change to something that gets counted — and each
            * one needs a session to change, so on a workout nobody planned they are not shown at
            * all rather than shown inert.
            */}
          {sessionId && saved.suggestions.map((sg, i) => (
            <button key={i} onClick={() => apply(sg)} disabled={Boolean(busy) || !sessionId}
              style={{ marginTop: 10, width: "100%", textAlign: "left", padding: "10px 12px",
                borderRadius: 10, border: "1px dashed var(--line)", background: "var(--off)",
                color: "var(--ink)", fontSize: 12, lineHeight: 1.45 }}>
              {sg.type === "reclassify"
                ? <>Looks like a <b>{say(sg.to)}</b> session — {sg.why}. Tap to correct it.</>
                : <>Save {sg.count} lift{sg.count > 1 ? "s" : ""} as sets, so next week&apos;s
                  loads build on them.</>}
            </button>
          ))}
        </div>
      )}

      {err && <div className="errbox" role="alert" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
