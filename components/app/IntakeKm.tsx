"use client";
import type { Step } from "@/lib/intake-steps";

const TEAL = "#0A8FB0", ORANGE = "#FC5200";
const TEAL_T = "var(--teal-tint)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

/**
 * A distance, in kilometres.
 *
 * Steppers rather than a text field: it is a phone, the useful range is narrow,
 * and a number pad invites a typo of a factor of ten. The first tap jumps to a
 * plausible figure rather than counting up from zero.
 *
 * "I do not know" is a real answer and is stored as one — distinct from zero,
 * which would otherwise read as "I ran nothing".
 */
export default function IntakeKm({
  step, value, unknown, pulled, onChange, onUnknown,
}: {
  step: Step;
  value: number;
  unknown: boolean;
  /** the figure came from Strava, so it is shown as something to check */
  pulled: boolean;
  onChange: (v: number) => void;
  onUnknown: (v: boolean) => void;
}) {
  const min = step.min ?? 0, max = step.max ?? 99, inc = step.step ?? 1;
  const bump = (d: number) => {
    if (unknown) onUnknown(false);
    onChange(value === 0 ? (step.seed ?? inc) : Math.max(min, Math.min(max, value + d)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{
        display: "flex", flexDirection: "column", gap: 12, alignItems: "center",
        background: PAPER, border: `1px solid ${pulled ? ORANGE : LINE}`,
        borderRadius: "var(--r-card)", padding: "20px 16px 16px",
      }}>
        {pulled && (
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: ORANGE }}>
            From Strava · edit if it looks wrong
          </span>
        )}
        <span style={{
          fontFamily: "var(--display)", fontSize: value && !unknown ? 40 : 22,
          fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1,
          color: value && !unknown ? "var(--ink)" : INK40,
        }}>
          {unknown ? "Unknown" : value ? `${value} ${step.unit ?? "km"}` : "Tap to set"}
        </span>
        <div style={{ display: "flex", gap: 5, width: "100%" }}>
          {([[-inc * 2, `−${inc * 2}`], [-inc, `−${inc}`], [inc, `+${inc}`], [inc * 2, `+${inc * 2}`]] as const)
            .map(([d, label]) => (
              <button key={label} onClick={() => bump(d)} style={{
                flex: 1, padding: "12px 0", borderRadius: "var(--r-pill)",
                border: `1px solid ${LINE}`, background: "var(--off)",
                fontSize: 12, fontWeight: 700, color: "var(--ink)",
              }}>{label}</button>
            ))}
        </div>
      </div>

      {step.skip && (
        <button onClick={() => onUnknown(!unknown)} style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          gap: 8, borderRadius: "var(--r-pill)", padding: 13, fontSize: 11, fontWeight: 700,
          background: unknown ? TEAL_T : PAPER,
          border: `1px solid ${unknown ? TEAL : LINE}`,
          color: unknown ? TEAL : INK55,
        }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", flex: "none",
            border: `1px solid ${unknown ? TEAL : LINE}`,
            background: unknown ? TEAL : "transparent" }} />
          {step.skip}
        </button>
      )}

      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>{note(step, value, unknown)}</span>
    </div>
  );
}

/**
 * What the number changes, said as it is set.
 *
 * The "unknown" line no longer threatens a fifteen per cent haircut, because
 * there is not one — it falls back to the training bracket and says so.
 */
function note(step: Step, value: number, unknown: boolean): string {
  if (unknown) {
    return step.id === "peakWeek"
      ? "Without it, week 1 comes from your training history and how you described your running instead. Strava would answer this in a second."
      : "Without it, the long run starts from your training history instead. Strava would answer this in a second.";
  }
  if (!value) return "";
  if (step.id === "longestRun") {
    return value >= 21
      ? "Half-marathon distance already in the legs — the long run can start where it is."
      : "The first long run sits just above this, then grows about a kilometre a week.";
  }
  return "Week 1 is built from this, not from a bracket.";
}
