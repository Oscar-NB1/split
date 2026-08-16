"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";

const TEAL = "#0A8FB0";
const TEAL_T = "var(--teal-tint)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

export type Absence = {
  id: string; from_date: string; to_date: string; kind: string;
  days: number; consumes_deload: boolean; volume_factor: number; re_entry: boolean;
};

const KINDS: [string, string][] = [
  ["no_training", "No training"],
  ["some_access", "Some access"],
  ["normal", "Training as normal"],
];

/**
 * Weeks away, and what the plan does about them.
 *
 * One component, two homes: the intake asks for them while building a block,
 * and the profile edits them afterwards. Both write the same list, because a
 * trip booked in September is the same fact whichever screen you were on.
 *
 * Each entry states its own consequence rather than leaving the athlete to
 * wonder. Someone about to lose a fortnight wants to know the plan has already
 * absorbed it — that is the difference between a form and a coach.
 */
export default function Away({ onChange }: { onChange?: (n: number) => void }) {
  const [list, setList] = useState<Absence[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("some_access");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/absences").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      setList(j.absences); onChange?.(j.absences.length);
    });
    // onChange is a notifier, not an input: including it would refetch on every
    // parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const r = await fetch("/api/absences", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { setError((await r.json()).error ?? "That did not save."); return; }
    const j = await r.json();
    setList(j.absences); onChange?.(j.absences.length);
    setFrom(""); setTo("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={caps}>Time away</span>

      {(list ?? []).map((a) => (
        <div key={a.id} style={{
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
          padding: "12px 13px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {fmt(a.from_date, { day: "numeric", month: "short" })} –{" "}
              {fmt(a.to_date, { day: "numeric", month: "short" })}
            </span>
            <span style={{ fontSize: 11, color: INK40 }}>
              {a.days} {a.days === 1 ? "day" : "days"} ·{" "}
              <span style={{ fontWeight: 700, color: TEAL }}>
                {KINDS.find(([k]) => k === a.kind)?.[1]}
              </span>
            </span>
            <span style={{ fontSize: 10, lineHeight: 1.5, color: INK55 }}>{effectOf(a)}</span>
          </span>
          <button onClick={() => send({ remove: a.id })} disabled={busy} style={{
            background: "none", border: 0, padding: 0, fontSize: 11, fontWeight: 700,
            color: INK40,
          }}>Remove</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 3, background: "var(--off)",
        borderRadius: "var(--r-pill)", padding: 3 }}>
        {KINDS.map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} style={{
            flex: 1, borderRadius: "var(--r-pill)", padding: "9px 6px", fontSize: 10,
            fontWeight: 700, background: kind === k ? TEAL_T : "transparent",
            color: kind === k ? TEAL : INK55,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 7 }}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          aria-label="Away from" style={dateBox} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          aria-label="Away until" style={dateBox} />
      </div>

      <button onClick={() => send({ from_date: from, to_date: to, kind })}
        disabled={busy || !from || !to} style={{
          width: "100%", background: "none", border: `1px solid ${LINE}`,
          borderRadius: "var(--r-pill)", padding: 12, fontSize: 11, fontWeight: 800,
          letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink)",
          opacity: from && to ? 1 : .5,
        }}>Add a trip</button>

      {error && <span style={{ fontSize: 11, color: "#C07A3E" }}>{error}</span>}

      <span style={{ fontSize: 10, lineHeight: 1.5, color: INK40 }}>
        Weeks a trip overlaps are cut to what you can do, and a down week moves
        onto them rather than being spent beside them.
      </span>
    </div>
  );
}

/**
 * What this entry does, in the plan's own terms.
 *
 * The numbers are the generator's, not restated here — they come back from the
 * route so the sentence and the block cannot disagree.
 */
function effectOf(a: Absence): string {
  const cut = a.volume_factor < 1
    ? `Those weeks drop to ${Math.round(a.volume_factor * 100)}% of planned volume`
    : "Volume is unchanged — you are still training";
  const deload = a.consumes_deload ? ", and a down week moves onto the trip" : "";
  const back = a.re_entry
    ? ". The week you come back is 40% down and ramps over two, because picking up where you left off is where the injuries are."
    : ".";
  return cut + deload + back;
}

const caps: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

const dateBox: React.CSSProperties = {
  flex: 1, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
  padding: "11px 12px", fontSize: 13, color: "var(--ink)",
};
