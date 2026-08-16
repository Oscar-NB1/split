"use client";
import { useMemo } from "react";
import { dialPreview, type Preview } from "@/lib/plan/preview";
import type { Intake } from "@/lib/intake";

const TEAL = "#0A8FB0";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const LINE = "var(--line)", PAPER = "var(--paper)";
const H = 74;

/**
 * What the two dials would do to the block.
 *
 * The point of showing it here is that the dials are the only two answers whose
 * effect is otherwise invisible: every other question changes something the
 * athlete can picture. A curve that moves as they tap is the difference between
 * choosing "Aggressive" and understanding it.
 *
 * It is explicitly indicative and says so. This runs the real resolve and the real
 * volume skeleton, but no absences, no races and no placement — so it is the shape
 * of the block rather than the block, and presenting it as the plan would be a
 * promise the next screen has to break.
 */
export default function IntakeDials({ answers }: { answers: Intake }) {
  const p: Preview | null = useMemo(() => {
    try {
      return dialPreview(answers);
    } catch {
      // A half-answered form is not a bug and not worth an error: the curve simply
      // is not knowable yet.
      return null;
    }
  }, [answers]);

  if (!p || p.weeks.length === 0) {
    return (
      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
        The shape of the block appears here once the earlier answers are in.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "14px 15px",
        display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: TEAL }}>Weekly volume</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: INK40 }}>
            {p.ceiling ? `Ceiling ${p.ceiling} km` : `Peak ${p.peak} km`}
          </span>
        </div>

        {/* A number above each bar rather than a y-axis: there are ten of them and
            the question is always "what is that week", never "what is 40%". */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
          {p.weeks.map((w) => (
            <div key={w.n} style={{ flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: INK55 }}>{w.km}</span>
              <span style={{
                width: "100%", height: Math.max(6, Math.round((w.km / p.peak) * H)),
                borderRadius: "4px 4px 0 0",
                background: w.deload ? "rgba(10,143,176,.28)" : TEAL,
              }} />
              <span style={{ fontSize: 8, fontWeight: 700,
                color: w.deload ? INK40 : INK55 }}>W{w.n}</span>
            </div>
          ))}
        </div>

        <span style={{ fontSize: 11, lineHeight: 1.5, color: INK55 }}>{p.curve}</span>

        <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 9,
          display: "flex", flexDirection: "column", gap: 6 }}>
          {p.rows.map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "baseline",
              justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 11, color: INK55 }}>{r.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/*
        * Said plainly, under the chart it applies to.
        *
        * The real block also moves down weeks onto trips, absorbs the races either
        * side, and holds week 1 to what the athlete can actually do — none of which
        * is in this curve.
        */}
      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
        Indicative, not your plan. It shows how these two settings change the shape
        of the block — the real one also works around your trips, your races and the
        days you gave, and you see it on the next screen.
      </span>
    </div>
  );
}

/** The two explanation cards, which follow the dial rather than the athlete. */
export function DialText({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`,
      borderRadius: "var(--r-card)", padding: "13px 14px",
      display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
        textTransform: "uppercase", color: TEAL }}>{label}</span>
      <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>{text}</span>
    </div>
  );
}
