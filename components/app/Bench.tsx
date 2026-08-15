"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import type { Change, Reading, Severity } from "@/lib/plan/findings";

const TEAL = "#0A8FB0", LIME = "#C6FF5B", GOLD = "#E8C051";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const LINE = "var(--line)", PAPER = "var(--paper)", NAVY = "var(--navy)";

const DOT: Record<Severity, string> = { good: LIME, neutral: TEAL, attention: GOLD };

export type Attempt = {
  id: string; completed_at: string; variant: string; submaximal: boolean;
  aborted: boolean; label: string;
  rounds: { run_s: number; distance_m?: number; station_s?: number }[];
  readings: Reading[];
  changes: Change[];
  applied: boolean;
};

/**
 * What the test found, and what it changed.
 *
 * Two halves, and the order between them is the point: the findings are what
 * the athlete did, the changes are what the plan did about it. Showing the
 * changes first would make the plan the subject, and then a number moving is
 * something that happened to them rather than something they caused.
 */
export default function Bench({ athleteId }: { athleteId?: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [at, setAt] = useState(0);
  const [openFinding, setOpenFinding] = useState<number | null>(null);
  const [openChange, setOpenChange] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = `/api/benchmarks${athleteId ? `?athlete=${athleteId}` : ""}`;
  useEffect(() => {
    fetch(url).then(async (r) => setAttempts(r.ok ? (await r.json()).attempts : []));
  }, [url]);

  if (!attempts) return null;

  if (attempts.length === 0) {
    return (
      <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>No test logged yet</span>
        <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
          The first benchmark is scheduled in week one. Until it is run, every pace
          in the plan is an estimate carried forward from your answers — which is
          why the block starts more conservatively than it otherwise would.
        </span>
      </div>
    );
  }

  const a = attempts[Math.min(at, attempts.length - 1)];
  const shown = all ? a.readings : a.readings.slice(0, 4);
  const runs = a.rounds.map((r) => r.run_s);
  const best = Math.min(...runs), worst = Math.max(...runs);

  async function apply() {
    setBusy(true);
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "apply", id: a.id }),
    });
    setBusy(false);
    if (r.ok) setAttempts((await r.json()).attempts);
  }

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...caps, color: TEAL }}>
            {a.submaximal ? "Submaximal" : a.aborted ? "Stopped early" : "Full test"}
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: INK40 }}>{a.variant}</span>
        </div>
        <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>Benchmark results</span>
        <span style={{ fontSize: 12, color: INK55 }}>
          {fmt(a.completed_at.slice(0, 10), { day: "numeric", month: "long", year: "numeric" })}
        </span>
      </div>

      {attempts.length > 1 && (
        <div style={{ display: "flex", gap: 3, background: "var(--off)",
          borderRadius: "var(--r-pill)", padding: 3 }}>
          {attempts.map((x, i) => (
            <button key={x.id} onClick={() => { setAt(i); setOpenFinding(null); setOpenChange(null); }}
              style={{
                flex: 1, borderRadius: "var(--r-pill)", padding: "9px 12px", fontSize: 11,
                fontWeight: 700, background: i === at ? "#12314D" : "transparent",
                color: i === at ? "#fff" : INK55,
              }}>{x.label}</button>
          ))}
        </div>
      )}

      {/* The rounds, as they were run. A bar per round rather than a line,
          because four points is not a curve and drawing one implies a trend
          that four numbers cannot support. */}
      <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: "18px 18px 16px",
        display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 96 }}>
          {a.rounds.map((r, i) => {
            const h = worst === best ? 100 : 42 + ((worst - r.run_s) / (worst - best)) * 58;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column",
                justifyContent: "flex-end", gap: 6, height: "100%" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textAlign: "center" }}>
                  {mmss(r.run_s)}
                </span>
                <div style={{ height: `${h}%`, borderRadius: 6,
                  background: r.run_s === best ? LIME : "rgba(255,255,255,.34)" }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em",
                  color: "rgba(255,255,255,.6)", textAlign: "center" }}>R{i + 1}</span>
              </div>
            );
          })}
        </div>
        <span style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,.7)" }}>
          Lime is the quickest round. The shape across the four is the finding —
          a single fast one says less than four that hold together.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={caps}>What it found</span>
        {shown.map((f, i) => (
          <button key={f.dim} onClick={() => setOpenFinding(openFinding === i ? null : i)}
            style={{
              width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-card)", padding: "14px 16px", color: "var(--ink)",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: DOT[f.severity] }} />
              <span style={{ ...caps, fontSize: 10, flex: 1 }}>{f.dim} · {f.band}</span>
              <span style={{ fontSize: 13, color: INK40 }}>›</span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{f.headline}</span>
            {openFinding === i && (
              <span style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 3 }}>
                <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>{f.body}</span>
                <span style={{ fontSize: 11, lineHeight: 1.55, color: TEAL, fontWeight: 600 }}>
                  {f.effect}
                </span>
              </span>
            )}
          </button>
        ))}
        {a.readings.length > 4 && (
          <button onClick={() => setAll(!all)} style={{
            width: "100%", background: "none", border: `1px solid ${LINE}`,
            borderRadius: "var(--r-pill)", padding: 13, fontSize: 11, fontWeight: 700,
            letterSpacing: ".06em", textTransform: "uppercase", color: INK55,
          }}>{all ? "Show fewer" : `All ${a.readings.length} findings`}</button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span style={caps}>What changed in your plan</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: a.changes.length ? TEAL : INK40 }}>
            {a.changes.length === 0 ? "Nothing" : `${a.changes.length} line${a.changes.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {a.changes.length === 0 && (
          <span style={{ fontSize: 12, lineHeight: 1.6, color: INK55 }}>
            The test confirmed what the plan already assumed, so nothing moved. That
            is a result, not a failure to find one.
          </span>
        )}

        {a.changes.map((c, i) => (
          <div key={c.label} style={{ display: "flex", flexDirection: "column" }}>
            <button onClick={() => setOpenChange(openChange === i ? null : i)} style={{
              width: "100%", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: openChange === i ? "var(--r-card) var(--r-card) 0 0" : "var(--r-card)",
              padding: "13px 16px", color: "var(--ink)",
              display: "flex", alignItems: "center", gap: 9,
            }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, textAlign: "left" }}>
                {c.label}
              </span>
              <span style={{ fontSize: 12, color: INK40, textDecoration: "line-through" }}>
                {c.before}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>{c.after}</span>
              <span style={{ fontSize: 12, color: INK40 }}>›</span>
            </button>
            {openChange === i && (
              <div style={{ background: "var(--off)", border: `1px solid ${LINE}`, borderTop: 0,
                borderRadius: "0 0 var(--r-card) var(--r-card)", padding: "13px 16px",
                display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ ...caps, fontSize: 9, color: TEAL }}>
                  Because · {c.dim} {c.band}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.45 }}>{c.headline}</span>
                <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>{c.rule}</span>
                <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>
                  In training · {c.feel}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {a.changes.length > 0 && (
        <>
          <button onClick={apply} disabled={busy || a.applied} style={{
            width: "100%", background: a.applied ? "var(--off)" : LIME, border: 0,
            borderRadius: "var(--r-pill)", color: a.applied ? INK55 : "#12314D",
            padding: 16, fontSize: 12, fontWeight: 800, letterSpacing: ".06em",
            textTransform: "uppercase",
          }}>{a.applied ? "Applied to the block" : "Apply to the block"}</button>
          <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>
            Weeks you have already trained are left as they were. Only the ones
            ahead of you are rewritten.
          </span>
        </>
      )}
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

const mmss = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
