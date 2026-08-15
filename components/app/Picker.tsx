"use client";
import { useState } from "react";
import { fmt } from "@/lib/dates";
import { kindColour } from "@/lib/coach";

const TEAL = "#0A8FB0", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

/**
 * Adding a session.
 *
 * The list is this block's own week shape rather than a generic set of workout
 * types: what you add mid-block is another session the plan already contains.
 * Interval templates carry their intervals.icu target, so the session that
 * reaches the watch is the one written here and nobody retypes it.
 */
const TEMPLATES = [
  { kind: "run_easy", title: "Easy run", minutes: 45, detail: "HR 135–152. The run that protects Tuesday and Saturday.", target: "" },
  { kind: "run_long", title: "Long run", minutes: 95, detail: "Steady. Pace at HR ~150 is the benchmark that matters.", target: "" },
  { kind: "run_intervals", title: "Intervals · 5 × 1000 m", minutes: 50,
    detail: "Standing rest, 90 s. Rep 1 may never be the fastest.",
    target: "- 15m Z2 warm up\n- 5x\n- 1000m Z4\n- 90s Z1 walk\n- 10m Z1 cool down" },
  { kind: "run_intervals", title: "Race session · 8 × 1000 m @ 4:15", minutes: 60,
    detail: "Literally the race. 75 s standing rest.",
    target: "- 15m Z2 warm up\n- 8x\n- 1000m Z4\n- 75s Z1 walk\n- 10m Z1 cool down" },
  { kind: "hyrox", title: "Hyrox continuous", minutes: 65, detail: "Stations as active recovery. Drill the roxzone.", target: "" },
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
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontFamily: "var(--display)", fontSize: 23, fontWeight: 700,
        lineHeight: 1.1, letterSpacing: "-.02em" }}>
        Add to {fmt(date, { weekday: "long", day: "numeric", month: "long" })}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {(["AM", "PM"] as const).map((s) => (
          <button key={s} onClick={() => setPick(s)} style={{
            padding: "8px 13px", borderRadius: "var(--r-pill)", fontSize: 11, fontWeight: 600,
            border: `1px solid ${pick === s ? NAVY : LINE}`,
            background: pick === s ? NAVY : PAPER,
            color: pick === s ? "#fff" : INK55,
          }}>{s}</button>
        ))}
      </div>

      {err && <div className="errbox" role="alert">{err}</div>}

      {TEMPLATES.map((t) => (
        <button key={t.title} disabled={busy} onClick={() => create(t)} style={{
          textAlign: "left", padding: 0, display: "flex", alignItems: "stretch",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
          overflow: "hidden", color: "var(--ink)",
        }}>
          <span style={{ width: 4, flex: "none", alignSelf: "stretch",
            background: kindColour(t.kind) }} />
          <span style={{ display: "flex", flexDirection: "column", gap: 4, padding: "13px 14px" }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".12em",
              textTransform: "uppercase", color: INK40 }}>{t.kind.replace("_", " · ")}</span>
            <span style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>{t.title}</span>
            <span style={{ fontSize: 12, color: INK55, lineHeight: 1.4 }}>{t.detail}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: TEAL }}>{t.minutes} min</span>
          </span>
        </button>
      ))}

      <button onClick={onCancel} style={{
        width: "100%", border: `1px solid ${LINE}`, borderRadius: "var(--r-pill)", padding: 14,
        fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
        color: INK55, background: PAPER,
      }}>Cancel</button>
    </div>
  );
}
