"use client";

const TEAL = "#0A8FB0", TEAL_T = "var(--teal-tint)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type Mode = "add" | "replace";

const MODES: [Mode, string, string][] = [
  ["add", "On top of the plan", "The plan keeps its sessions and works around this one."],
  ["replace", "Instead of a session", "This takes a slot, so the plan schedules one fewer."],
];

/**
 * Commitments, with the question that decides what they cost.
 *
 * Naming the activity is the easy half. The half that changes the plan is whether
 * it sits *on top of* the prescribed week or *instead of* one of its sessions —
 * and that was never asked, so every commitment was assumed additive. For someone
 * doing kickboxing twice a week that is two extra hard days the plan did not know
 * it was adding.
 *
 * The frequency and the fixed days matter for the same reason: a commitment
 * pinned to Tuesday forces the key session somewhere else, and one that floats
 * can be placed away from it.
 */
export default function IntakeCommitments({
  chips, picked, freq, days, modes, onToggle, onFreq, onDay, onMode,
}: {
  chips: string[];
  picked: string[];
  freq: Record<string, number>;
  days: Record<string, string[]>;
  modes: Record<string, Mode>;
  onToggle: (c: string) => void;
  onFreq: (c: string, n: number) => void;
  onDay: (c: string, d: string[]) => void;
  onMode: (c: string, m: Mode) => void;
}) {
  const live = picked.filter((c) => c !== "Nothing fixed");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chips.map((c) => {
          const on = picked.includes(c);
          return (
            <button key={c} onClick={() => onToggle(c)} style={{
              padding: "9px 14px", borderRadius: "var(--r-pill)", fontSize: 11,
              fontWeight: 600, border: `1px solid ${on ? TEAL : LINE}`,
              background: on ? TEAL_T : PAPER, color: on ? TEAL : INK55,
            }}>{c}</button>
          );
        })}
      </div>

      {live.map((c) => {
        const n = freq[c] ?? 1;
        const fixed = days[c] ?? [];
        const mode = modes[c] ?? "add";
        return (
          <div key={c} style={{ background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: "13px 14px",
            display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{c}</span>
              <button onClick={() => onToggle(c)} aria-label={`Remove ${c}`}
                style={{ fontSize: 12, color: INK40, padding: "0 6px" }}>✕</button>
              <Step label="−" onClick={() => onFreq(c, Math.max(1, n - 1))} />
              <span style={{ fontSize: 12, fontWeight: 700, minWidth: 62,
                textAlign: "center" }}>{n}× a week</span>
              <Step label="+" onClick={() => onFreq(c, Math.min(7, n + 1))} />
            </div>

            {/* The question that decides the cost. */}
            <div style={{ display: "flex", gap: 5 }}>
              {MODES.map(([m, label]) => (
                <button key={m} onClick={() => onMode(c, m)} style={{
                  flex: 1, padding: "9px 6px", borderRadius: "var(--r-pill)",
                  fontSize: 11, fontWeight: 700,
                  border: `1px solid ${mode === m ? TEAL : LINE}`,
                  background: mode === m ? TEAL_T : "var(--off)",
                  color: mode === m ? TEAL : INK55,
                }}>{label}</button>
              ))}
            </div>
            <span style={{ fontSize: 10, lineHeight: 1.5, color: INK55 }}>
              {MODES.find(([m]) => m === mode)![2]}
            </span>

            <div style={{ display: "flex", gap: 4 }}>
              {DAYS.map((d) => {
                const on = fixed.includes(d);
                return (
                  <button key={d}
                    onClick={() => onDay(c, on ? fixed.filter((x) => x !== d)
                      : [...fixed, d].slice(0, n))}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: "var(--r-pill)",
                      fontSize: 10, fontWeight: 700,
                      border: `1px solid ${on ? TEAL : LINE}`,
                      background: on ? TEAL_T : "var(--off)",
                      color: on ? TEAL : INK55,
                    }}>{d}</button>
                );
              })}
            </div>
            <span style={{ fontSize: 10, color: INK40 }}>
              {fixed.length === 0
                ? "No fixed day — the plan places it away from your key sessions."
                : `${fixed.join(", ")} fixed${n > fixed.length
                  ? ` · ${n - fixed.length} placed for you` : ""}`}
            </span>
          </div>
        );
      })}

      {live.length > 0 && (
        <span style={{ fontSize: 11, lineHeight: 1.5, color: INK55 }}>
          Each session counts at 0.3× aerobic volume and is placed away from your
          key days.
        </span>
      )}
    </div>
  );
}

const Step = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button onClick={onClick} style={{
    width: 26, height: 26, flex: "none", borderRadius: "50%",
    border: `1px solid ${LINE}`, background: "var(--off)",
    fontSize: 14, fontWeight: 700, color: "var(--ink)",
  }}>{label}</button>
);
