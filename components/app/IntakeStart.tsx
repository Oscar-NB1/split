"use client";
import { useState } from "react";
import Away from "./Away";
import { addDays, fmt, iso, mondayOf, today } from "@/lib/dates";

const TEAL = "#0A8FB0", TEAL_T = "var(--teal-tint)";
const INK = "var(--ink)", INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

/** Nine days: today, tomorrow, and the week after them. */
const HORIZON = 9;

/**
 * When the block starts, and anything already in the way of it.
 *
 * The two belong on one step because they answer one question: what does the
 * calendar actually look like between now and race day. A start date collected
 * without the trips around it produces a block that gets rebuilt in week three.
 *
 * A native date field was the wrong control for this. Nobody wants to open a month
 * picker to say "Monday" — so the next nine days are buttons, with the picker
 * behind a link for the athlete who really does mean the 4th of next month.
 */
export default function IntakeStart({
  startDate, raceDate, onStart,
}: {
  startDate: string | null;
  /** used only to say how long the block would be — no date is required */
  raceDate: string | null;
  onStart: (d: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trips, setTrips] = useState(0);

  const now = today();
  const chosen = startDate || now;
  const options = Array.from({ length: HORIZON }, (_, i) => addDays(now, i));

  /*
   * How long the block would be, from the Monday the plan is laid from.
   *
   * The same arithmetic the generator uses, so the number here cannot promise a
   * length the plan will not have.
   */
  const anchor = mondayOf(chosen);
  const weeks = raceDate
    ? Math.max(2, Math.min(24, Math.round(
        (Date.parse(`${raceDate}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 604_800_000)))
    : null;

  const day = (d: string) =>
    fmt(d, { weekday: "long" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* "First week starts" was wrong: the week it lands in starts on its
            Monday. What is being chosen is the first day of training. */}
        <span style={caps}>First day of training</span>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {options.map((d, i) => {
            const on = chosen === d;
            return (
              <button key={d} onClick={() => onStart(d)} style={{
                flex: "1 1 96px", minWidth: 96, display: "flex",
                flexDirection: "column", gap: 2, alignItems: "flex-start",
                padding: "11px 13px", borderRadius: "var(--r-card)", color: INK,
                background: on ? TEAL_T : PAPER,
                border: `1px solid ${on ? TEAL : LINE}`,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  {i === 0 ? "Today" : i === 1 ? "Tomorrow" : day(d)}
                </span>
                <span style={{ fontSize: 10, color: INK40 }}>
                  {fmt(d, { day: "numeric", month: "short" })}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: TEAL }}>
            {weeks
              ? `${weeks} weeks to race day · starting ${fmt(chosen, {
                  weekday: "long", day: "numeric", month: "long" })}`
              : `Starting ${fmt(chosen, { weekday: "long", day: "numeric", month: "long" })}`}
          </span>
          <button onClick={() => setPickerOpen(!pickerOpen)} style={{
            fontSize: 11, fontWeight: 700, color: INK55, textDecoration: "underline",
          }}>{pickerOpen ? "Close" : "Pick another date"}</button>
        </div>

        {pickerOpen && (
          <input type="date" value={chosen} min={now}
            aria-label="First day of training"
            onChange={(e) => e.target.value && onStart(e.target.value)}
            style={{
              background: PAPER, border: `1px solid ${TEAL}`, borderRadius: 12,
              padding: "12px 13px", fontSize: 14, color: INK,
            }} />
        )}

        {/*
          * The one thing people get wrong about starting mid-week.
          *
          * Weeks run Monday to Sunday whatever day is picked; a Wednesday start
          * simply means week 1 is a short one. Saying so here stops the athlete
          * choosing a Monday they do not want in order to keep the maths tidy.
          */}
        <span style={{ fontSize: 11, lineHeight: 1.5, color: INK40 }}>
          {anchor === chosen
            ? "Weeks run Monday to Sunday."
            : `Weeks run Monday to Sunday, so week 1 is a short one — ${
                fmt(chosen, { weekday: "long" })} to Sunday. Nothing before ${
                fmt(chosen, { day: "numeric", month: "short" })} is scheduled.`}
        </span>
      </div>

      <Away onChange={setTrips} startFrom={chosen} />

      {trips > 0 && (
        <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
          Each trip is planned around: the weeks it touches are cut to what you can
          do, and a down week moves onto them.
        </span>
      )}
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

/** Exported for the tests: the same window the buttons offer. */
export const startOptions = (from: string): string[] =>
  Array.from({ length: HORIZON }, (_, i) => addDays(from, i));

export const isoOf = iso;
