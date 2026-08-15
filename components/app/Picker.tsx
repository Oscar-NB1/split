"use client";
import { useState } from "react";
import { fmt } from "@/lib/dates";
import { kindColour } from "@/lib/coach";

/**
 * Adding a session.
 *
 * The templates are the plan's own week shape, not a generic list of workout
 * types: what you actually add mid-block is another one of the sessions this
 * block already contains, and giving it the right target text means it reaches
 * the watch correctly without anyone retyping intervals.icu syntax.
 */
const TEMPLATES = [
  { kind: "run_easy", title: "Easy run", minutes: 45, detail: "HR 135–152. The one that protects Tuesday and Saturday.",
    target: "" },
  { kind: "run_long", title: "Long run", minutes: 95, detail: "Steady. Pace at HR ~150 is the real benchmark.",
    target: "" },
  { kind: "run_intervals", title: "Intervals · 5 × 1000 m", minutes: 50,
    detail: "Standing rest, 90 s. First rep may never be the fastest.",
    target: "- 15m Z2 warm up\n- 5x\n- 1000m Z4\n- 90s Z1 walk\n- 10m Z1 cool down" },
  { kind: "hyrox", title: "Hyrox continuous", minutes: 65,
    detail: "Stations as active recovery. Drill the roxzone.", target: "" },
  { kind: "hyrox", title: "Kickboxing", minutes: 60, detail: "Not a third hard day.", target: "" },
  { kind: "strength", title: "Strength A", minutes: 40, detail: "Heavy and short. Three compounds.",
    target: "Trap bar deadlift 3x5 @ 130\nBack squat 3x5 @ 105\nWeighted pull-up 3x6 @ 12" },
  { kind: "strength", title: "Strength B", minutes: 40, detail: "Front squat, hinge, single leg.",
    target: "Front squat 3x5 @ 85\nRomanian deadlift 3x8 @ 90\nWalking lunge 3x20 @ 24" },
];

export default function Picker({
  date, slot, forUser, onDone, onCancel,
}: {
  date: string; slot: "AM" | "PM"; forUser: string;
  onDone: () => void; onCancel: () => void;
}) {
  const [pick, setPick] = useState<"AM" | "PM">(slot);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(t: (typeof TEMPLATES)[number]) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_id: forUser, planned_date: date, title: t.title, kind: t.kind,
        planned_minutes: t.minutes, target: t.target || null, slot: pick,
      }),
    });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Couldn't add it."); return; }
    onDone();
  }

  return (
    <div className="pad">
      <div>
        <div className="eyebrow">Add to</div>
        <h1 className="h2" style={{ marginTop: 5 }}>
          {fmt(date, { weekday: "long", day: "numeric", month: "long" })}
        </h1>
      </div>

      <div className="pillrow">
        <button aria-pressed={pick === "AM"} onClick={() => setPick("AM")}>Morning</button>
        <button aria-pressed={pick === "PM"} onClick={() => setPick("PM")}>Evening</button>
      </div>

      {err && <div className="errbox" role="alert">{err}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TEMPLATES.map((t) => (
          <button key={t.title} className="sess" disabled={busy} onClick={() => create(t)}>
            <span className="edge" style={{ background: kindColour(t.kind) }} />
            <span className="body" style={{ gap: 4 }}>
              <span className="kindlab" style={{ fontSize: 9 }}>{t.kind.replace("_", " · ")}</span>
              <span className="title" style={{ fontSize: 16 }}>{t.title}</span>
              <span className="detail">{t.detail}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--teal)" }}>{t.minutes} min</span>
            </span>
          </button>
        ))}
      </div>

      <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      <p className="empty">
        Interval sessions carry their intervals.icu target, so the session that reaches
        your watch is the one written here — nobody retypes it.
      </p>
    </div>
  );
}
