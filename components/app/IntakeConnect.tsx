"use client";
import Mark from "./Mark";
import { STRAVA_READS } from "@/lib/intake-steps";

const TEAL = "#0A8FB0", ORANGE = "#FC5200";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const LINE = "var(--line)", PAPER = "var(--paper)", OFF = "var(--off)";

/**
 * Connecting Strava, mid-intake.
 *
 * Offered here rather than afterwards because the next two questions are
 * numbers Strava already holds, and asking someone to remember what their
 * biggest week was while it sits in their watch is the kind of thing that makes
 * a form feel like it is not listening.
 *
 * Skippable, and the skip is not punished. An earlier version of this copy said
 * typed numbers start week 1 fifteen per cent lower; that discount no longer
 * exists, so saying so would be false.
 */
export default function IntakeConnect({
  connected, onConnect, skipLabel, onSkip,
}: {
  connected: boolean;
  onConnect: () => void;
  skipLabel: string;
  onSkip: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "4px 16px" }}>
        {STRAVA_READS.map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 10, padding: "12px 0",
            borderBottom: `1px solid var(--line-2)` }}>
            <span style={{ color: TEAL, fontSize: 12, flex: "none", lineHeight: 1.5 }}>✓</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{k}</span>
              <span style={{ fontSize: 11, lineHeight: 1.5, color: INK55 }}>{v}</span>
            </span>
          </div>
        ))}
      </div>

      <button onClick={onConnect} disabled={connected} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        gap: 10, border: 0, borderRadius: "var(--r-pill)", padding: 15, fontSize: 12,
        fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
        background: connected ? OFF : ORANGE, color: connected ? INK40 : "#fff",
      }}>
        {!connected && <Mark id="strava" label="" size={18} radius={4} />}
        {connected ? "Connected" : "Connect Strava"}
      </button>

      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK70 }}>
        {connected
          ? "Your last eight weeks are in. The next two questions are prefilled — check them rather than typing them."
          : "You will be handed to Strava to authorise, then returned here with your answers still filled in. Nothing is written back to Strava."}
      </span>

      {!connected && skipLabel && (
        <button onClick={onSkip} style={{
          width: "100%", background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-pill)", padding: 13, fontSize: 11, fontWeight: 700,
          color: INK55,
        }}>{skipLabel}</button>
      )}
    </div>
  );
}
