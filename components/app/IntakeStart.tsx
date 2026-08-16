"use client";
import Away from "./Away";
import { mondayOf, today } from "@/lib/dates";

const INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

/**
 * When the block starts, and anything already in the way of it.
 *
 * The two belong on one step because they answer one question: what does the
 * calendar actually look like between now and race day. A start date collected
 * without the trips around it produces a block that gets rebuilt in week three.
 */
export default function IntakeStart({
  startDate, onStart,
}: {
  startDate: string | null;
  onStart: (d: string) => void;
}) {
  // Blocks start on a Monday. Offering an arbitrary day would mean either a
  // part-week at the front or silently moving what they picked.
  const monday = mondayOf(startDate || today());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: INK55 }}>First Monday</span>
        <input type="date" value={monday}
          onChange={(e) => e.target.value && onStart(mondayOf(e.target.value))}
          style={{
            background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
            padding: "13px 14px", fontSize: 14, color: "var(--ink)",
          }} />
        <span style={{ fontSize: 10, lineHeight: 1.5, color: "var(--ink-40)" }}>
          Weeks run Monday to Sunday, so whatever you pick snaps to the Monday of
          that week.
        </span>
      </label>

      <Away />
    </div>
  );
}
