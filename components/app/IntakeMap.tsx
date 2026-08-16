"use client";
import { useState } from "react";
import type { MapBlock } from "@/lib/intake-steps";

const TEAL = "#0A8FB0", TEAL_T = "var(--teal-tint)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

/**
 * Every question, by block, with somewhere to jump.
 *
 * Twenty-eight steps in a line meant the only route back to step 8 from step 26
 * was eighteen taps on an arrow. This is the alternative: the blocks, how much of
 * each is answered, and — expanded — every question with the answer beside it, so
 * checking what you said does not mean walking through the form again.
 *
 * The answers are shown rather than only the questions on purpose. An overview
 * that lists questions tells you where to go; one that lists answers tells you
 * whether you need to.
 */
export default function IntakeMap({
  blocks, stepLabel, onJump, onClose, ctaLabel,
}: {
  blocks: MapBlock[];
  stepLabel: string;
  onJump: (step: number) => void;
  onClose: () => void;
  ctaLabel: string;
}) {
  const [open, setOpen] = useState<string | null>(
    // The first block with something unanswered, since that is where they are.
    blocks.find((b) => b.answered < b.total)?.name ?? null,
  );

  return (
    <div style={{ padding: "16px 18px 26px", display: "flex",
      flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onClose} aria-label="Back to the question" style={{
          width: 28, height: 28, flex: "none", borderRadius: "50%",
          background: PAPER, border: `1px solid ${LINE}`, fontSize: 13,
        }}>←</button>
        <span style={{ flex: 1, fontFamily: "var(--display)", fontSize: 20,
          fontWeight: 700, letterSpacing: "-.02em" }}>Your answers</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: INK40 }}>{stepLabel}</span>
      </div>

      <span style={{ fontSize: 12, lineHeight: 1.55, color: INK55 }}>
        Tap any question to go straight to it. Nothing is lost by jumping around —
        changing an answer only clears the ones that depended on it.
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((b) => {
          const done = b.answered === b.total;
          return (
            <div key={b.name} style={{ background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-card)", overflow: "hidden" }}>
              <button onClick={() => setOpen(open === b.name ? null : b.name)}
                style={{
                  width: "100%", textAlign: "left", padding: "13px 14px",
                  display: "flex", alignItems: "center", gap: 10, color: "var(--ink)",
                }}>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{b.name}</span>
                    <span style={{ fontSize: 10, color: INK40 }}>{b.range}</span>
                  </span>
                  <span style={{ fontSize: 11, color: INK55 }}>{b.topics}</span>
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: ".04em",
                  padding: "4px 8px", borderRadius: "var(--r-pill)",
                  background: done ? TEAL_T : "var(--off)",
                  color: done ? TEAL : INK55,
                }}>{b.answered}/{b.total}</span>
                <span style={{ fontSize: 13, color: INK40 }}>
                  {open === b.name ? "⌄" : "›"}
                </span>
              </button>

              {open === b.name && (
                <div style={{ borderTop: `1px solid ${LINE}` }}>
                  {b.rows.map((r) => (
                    <button key={r.id} onClick={() => onJump(r.step)} style={{
                      width: "100%", textAlign: "left", padding: "11px 14px",
                      display: "flex", alignItems: "baseline", gap: 10,
                      borderBottom: "1px solid var(--line-2)", color: "var(--ink)",
                    }}>
                      <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>{r.q}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, textAlign: "right",
                        maxWidth: "44%",
                        color: r.answer ? TEAL : INK40,
                      }}>{r.answer || "Not answered"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={onClose} style={{
        width: "100%", background: "var(--lime)", border: 0,
        borderRadius: "var(--r-pill)", color: "var(--on-lime)", padding: 16,
        fontSize: 12, fontWeight: 800, letterSpacing: ".06em",
        textTransform: "uppercase",
      }}>{ctaLabel}</button>
    </div>
  );
}
