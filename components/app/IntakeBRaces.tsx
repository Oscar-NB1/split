"use client";
import { useState } from "react";
import { fmt } from "@/lib/dates";
import { INTENTS, INTENT_COST, intentOptions, tooClose, type Intent } from "@/lib/race/brace";

const TEAL = "#0A8FB0", TEAL_T = "var(--teal-tint)", GOLD = "#8A6D14";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

export type BRace = { date: string; venue: string; intent: Intent };

/**
 * Races between now and the target.
 *
 * Each one costs training time, and how much depends on what the athlete wants
 * from it — so the intent is asked here rather than assumed, and what it costs is
 * shown next to the choice. An intent that quietly costs more than advertised is
 * worse than one that costs more openly.
 *
 * The gating is not duplicated: `intentOptions` from lib/race/brace.ts decides
 * what a gap can afford, and this renders exactly what that returns. Two copies
 * of a rule is one copy too many, and this is the copy that would drift.
 */
export default function IntakeBRaces({
  races, targetDate, onChange, skipLabel, onSkip,
}: {
  races: BRace[];
  /** the target race; without one there is no gap to gate against */
  targetDate: string | null;
  onChange: (r: BRace[]) => void;
  skipLabel: string;
  onSkip: () => void;
}) {
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");

  if (!targetDate) {
    return (
      <span style={{ fontSize: 12, lineHeight: 1.6, color: INK55 }}>
        Set your target race first and this will know what a second one costs.
      </span>
    );
  }

  const o = date ? intentOptions(date, targetDate) : null;
  const clash = races.find((r) => date && tooClose(r.date, date));
  const afterTarget = date && date >= targetDate;

  const add = (intent: Intent) => {
    onChange([...races, { date, venue: venue.trim(), intent }]);
    setDate(""); setVenue("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {races.map((r, i) => (
        <div key={i} style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "12px 13px",
          display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {fmt(r.date, { day: "numeric", month: "short" })}
              {r.venue ? ` · ${r.venue}` : ""}
            </span>
            <span style={{ fontSize: 11, color: INK55 }}>
              {r.intent} — costs {INTENT_COST[r.intent].cost}
            </span>
          </span>
          <button onClick={() => onChange(races.filter((_, n) => n !== i))}
            style={{ background: "none", border: 0, padding: 0, fontSize: 11,
              fontWeight: 700, color: INK40 }}>Remove</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 7 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          max={targetDate} aria-label="Race date"
          style={{ flex: 1, background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: 12, padding: "11px 12px", fontSize: 13 }} />
        <input value={venue} onChange={(e) => setVenue(e.target.value)}
          placeholder="Where" aria-label="Venue"
          style={{ flex: 1, background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: 12, padding: "11px 12px", fontSize: 13 }} />
      </div>

      {afterTarget && (
        <span style={{ fontSize: 11, color: GOLD }}>
          That is on or after your target race. A race after the one you are
          training for belongs in the next block.
        </span>
      )}

      {clash && !afterTarget && (
        <span style={{ fontSize: 11, color: GOLD }}>
          You already have a race on {fmt(clash.date, { day: "numeric", month: "short" })},
          which is inside five days of this one.
        </span>
      )}

      {o && !clash && !afterTarget && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
            textTransform: "uppercase", color: INK55 }}>
            {o.gap_weeks} weeks before your target — what do you want from it?
          </span>

          {INTENTS.map((i) => {
            const allowed = o.allowed.includes(i);
            const blocked = o.blocked.find((b) => b.intent === i);
            return (
              <button key={i} onClick={() => allowed && add(i)} disabled={!allowed}
                style={{
                  width: "100%", textAlign: "left", padding: "12px 13px",
                  borderRadius: "var(--r-card)",
                  border: `1px solid ${allowed ? TEAL : LINE}`,
                  background: allowed ? PAPER : "var(--off)",
                  display: "flex", flexDirection: "column", gap: 3,
                  opacity: allowed ? 1 : .8,
                }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, textTransform: "capitalize",
                    color: allowed ? "var(--ink)" : INK55 }}>{i}</span>
                  <span style={{ fontSize: 11, fontWeight: 600,
                    color: allowed ? TEAL : INK40 }}>
                    costs {INTENT_COST[i].cost}
                  </span>
                </span>
                {/* A blocked option says why rather than vanishing: an athlete
                    who wanted to race it should know what it would have cost. */}
                <span style={{ fontSize: 11, lineHeight: 1.5,
                  color: allowed ? INK55 : GOLD }}>
                  {allowed
                    ? `Before: ${INTENT_COST[i].before}. After: ${INTENT_COST[i].after}.`
                    : blocked?.reason}
                </span>
              </button>
            );
          })}

          {o.warning && (
            <span style={{ fontSize: 11, lineHeight: 1.5, color: GOLD,
              background: TEAL_T, borderRadius: 10, padding: "9px 11px" }}>
              {o.warning}
            </span>
          )}
        </div>
      )}

      {races.length === 0 && !date && skipLabel && (
        <button onClick={onSkip} style={{
          width: "100%", background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-pill)", padding: 13, fontSize: 12,
          fontWeight: 600, color: INK55,
        }}>{skipLabel}</button>
      )}
    </div>
  );
}
