"use client";
import { weeklyLoad, type Answers } from "@/lib/intake-steps";

const TEAL = "#0A8FB0";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

/** Steps where the week's arithmetic can change, and so should be shown. */
export const SHOWS_LOAD = ["days", "targetSessions", "commitments"];

/**
 * What the week comes to, on the steps that change it.
 *
 * Six sessions plus two commitments is eight sessions, and an athlete should meet
 * that number while they can still act on it rather than when the plan hands them
 * a double day. Shown on the three steps that move it and nowhere else — it was
 * bolted onto the equipment step, where nothing it counts can change.
 */
export default function IntakeLoad({ answers }: { answers: Answers }) {
  const asked = Number(String(answers.targetSessions ?? "")) || 0;
  if (asked === 0) return null;

  const total = weeklyLoad(answers);
  const extra = total - asked;
  const days = Array.isArray(answers.days) ? answers.days.length : 0;

  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`,
      borderRadius: "var(--r-card)", padding: "14px 15px",
      display: "flex", flexDirection: "column", gap: 7 }}>
      <Row k="Training sessions" v={String(asked)} />
      {extra > 0 && <Row k="Your commitments" v={`+${extra} on top`} />}
      <div style={{ height: 1, background: LINE }} />
      <Row k="Total per week" v={String(total)} aside={`~${(total * 1.075).toFixed(1)} h`} bold />
      <span style={{ fontSize: 10, lineHeight: 1.5, color: INK40 }}>
        {days > 0 && total > days
          ? `More than ${days} a week across ${days} days means doubles. Sessions get shorter to fit.`
          : total > 7
            ? "More than seven a week means doubles. Sessions get shorter to fit."
            : "That fits inside a week without doubling up."}
      </span>
    </div>
  );
}

const Row = ({ k, v, aside, bold }: {
  k: string; v: string; aside?: string; bold?: boolean;
}) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
    <span style={{ fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 500,
      color: bold ? "var(--ink)" : INK55 }}>{k}</span>
    <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
      <span style={{ fontSize: bold ? 17 : 13, fontWeight: 700 }}>{v}</span>
      {aside && <span style={{ fontSize: 11, color: TEAL }}>{aside}</span>}
    </span>
  </div>
);
