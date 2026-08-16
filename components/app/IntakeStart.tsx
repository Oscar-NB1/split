"use client";
import Away from "./Away";
import { today } from "@/lib/dates";

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
  /*
   * Any day. A block used to snap to the Monday of whatever week was picked,
   * which quietly moved the answer — someone choosing Thursday because they want
   * to start on Thursday was given the Monday before it. Weeks are seven days
   * from wherever they begin, so there was never a reason to insist.
   */
  const from = startDate || today();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: INK55 }}>First week starts</span>
        <input type="date" value={from} min={today()}
          onChange={(e) => e.target.value && onStart(e.target.value)}
          style={{
            background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
            padding: "13px 14px", fontSize: 14, color: "var(--ink)",
          }} />
        <span style={{ fontSize: 10, lineHeight: 1.5, color: "var(--ink-40)" }}>
          Today, tomorrow, or whenever suits. Each week of the plan is the seven
          days from here.
        </span>
      </label>

      <Away />
    </div>
  );
}
