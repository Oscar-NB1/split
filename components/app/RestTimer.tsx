"use client";
import { useEffect, useState } from "react";
import { mmss } from "@/lib/prescription";

export type Rest = {
  /** the prescribed rest, kept so the progress bar has a denominator */
  rest: number;
  left: number;
  next: { name: string; line: string };
};

const NAVY_D = "#0E2740", LIME = "#C6FF5B", TEAL = "#0A8FB0";

/**
 * The rest timer, above the tab bar.
 *
 * Ticking a set starts it. It counts the prescribed rest down, says what is
 * next, and turns lime when the rest is up — so the screen tells you to go
 * without you having to watch it. +30s extends rather than restarts, because the
 * common case is needing a little longer, not needing the whole rest again.
 *
 * The interval is cleared on unmount and re-armed whenever a new set starts it,
 * so leaving the screen mid-rest does not leave a timer running.
 */
export default function RestTimer({
  rest, onChange, onDismiss,
}: { rest: Rest; onChange: (r: Rest) => void; onDismiss: () => void }) {
  const [, force] = useState(0);

  useEffect(() => {
    if (rest.left <= 0) return;
    const t = setInterval(() => {
      onChange({ ...rest, left: rest.left - 1 });
      force((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [rest, onChange]);

  const done = rest.left <= 0;
  const pct = done ? 100 : (1 - rest.left / Math.max(1, rest.rest)) * 100;
  const btn: React.CSSProperties = {
    border: `1px solid ${done ? "rgba(14,39,64,.3)" : "var(--line)"}`,
    borderRadius: "var(--r-pill)", padding: "8px 12px", fontSize: 10, fontWeight: 700,
    letterSpacing: ".06em", textTransform: "uppercase",
    color: done ? NAVY_D : "var(--ink-55)", background: "none", flex: "none",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px 13px",
      borderTop: "1px solid var(--line)", background: done ? LIME : "var(--paper)",
      flex: "none",
    }} role="status" aria-live="polite">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700,
          color: done ? NAVY_D : "var(--ink)", minWidth: 54 }}>
          {mmss(rest.left)}
        </span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".12em",
            textTransform: "uppercase", color: done ? NAVY_D : TEAL }}>
            {done ? "Next set" : "Rest"}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3,
            color: done ? NAVY_D : "var(--ink)", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rest.next.name}</span>
          <span style={{ fontSize: 11, opacity: .7, color: done ? NAVY_D : "var(--ink)" }}>
            {rest.next.line}
          </span>
        </div>
        <button style={btn}
          onClick={() => onChange({ ...rest, left: rest.left + 30, rest: rest.rest + 30 })}>
          +30s
        </button>
        <button style={btn} onClick={onDismiss}>Done</button>
      </div>
      <div style={{ height: 3, background: "rgba(18,49,77,.12)", borderRadius: 2 }}>
        <div style={{ height: 3, borderRadius: 2, width: `${pct.toFixed(1)}%`,
          background: done ? NAVY_D : TEAL }} />
      </div>
    </div>
  );
}
