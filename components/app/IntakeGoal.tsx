"use client";

const TEAL = "#0A8FB0";
const TEAL_T = "var(--teal-tint)";
const INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

export const GOALS: [string, string][] = [
  ["Just finish it", "Get round, enjoy it, no time pressure"],
  ["Finish strong, no blow-ups", "Even effort, nothing falls apart late"],
  ["Target a time", "A number to train toward"],
];

/**
 * What they want from race day.
 *
 * This is the one answer that decides whether the plan projects a finish time
 * at all. "Just finish it" is not a lesser goal handled by the same machinery
 * with a softer number — it turns projection off, and sessions go out by effort
 * instead. Saying so on the screen is the point: an athlete who picks it should
 * know they will not be shown a time, rather than wondering where it went.
 */
export default function IntakeGoal({
  goal, minutes, onGoal, onMinutes,
}: {
  goal: string | null;
  /** target finish, in minutes; only used by "Target a time" */
  minutes: number;
  onGoal: (g: string) => void;
  onMinutes: (m: number) => void;
}) {
  const wantsTime = goal === "Target a time";
  const label = `${Math.floor(minutes)}:${String(Math.round((minutes % 1) * 60)).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {GOALS.map(([l, sub]) => (
          <button key={l} onClick={() => onGoal(l)} style={{
            width: "100%", textAlign: "left", display: "flex", flexDirection: "column",
            gap: 3, padding: "13px 14px", borderRadius: "var(--r-card)",
            border: `1px solid ${goal === l ? TEAL : LINE}`,
            background: goal === l ? TEAL_T : PAPER, color: "var(--ink)",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{l}</span>
            <span style={{ fontSize: 11, lineHeight: 1.45, color: INK55 }}>{sub}</span>
          </button>
        ))}
      </div>

      {wantsTime && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 12, alignItems: "center",
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
          padding: "18px 16px 14px",
        }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 36, fontWeight: 700,
            letterSpacing: "-.02em", lineHeight: 1.1 }}>{label}</span>
          <div style={{ display: "flex", gap: 5, width: "100%" }}>
            {([[-5, "−5 min"], [-1, "−1"], [1, "+1"], [5, "+5 min"]] as const).map(([d, l]) => (
              <button key={l} onClick={() => onMinutes(Math.max(30, minutes + d))} style={{
                flex: 1, padding: "10px 0", borderRadius: "var(--r-pill)",
                border: `1px solid ${LINE}`, background: "var(--off)",
                fontSize: 11, fontWeight: 700, color: "var(--ink)",
              }}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>{note(goal)}</span>
    </div>
  );
}

function note(goal: string | null): string {
  if (goal === "Just finish it") {
    return "No projected finish time will be shown. Sessions are prescribed by effort, and the plan stays inside what you can absorb.";
  }
  if (goal === "Target a time") {
    return "Pace targets are written backwards from this, and every benchmark is measured against it.";
  }
  return "The plan is built for an even race: nothing in it is faster than you can hold to the last station.";
}
