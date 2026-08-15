import { mmss } from "./prescription";

/**
 * The race plan: sixteen segments, eight transitions, one finish time.
 *
 * This lives outside the component because three things need the same numbers —
 * the screen that edits them, the route that stores them, and the workout text
 * that reaches the watch. It was previously a constant inside the component,
 * which meant the plan you built was thrown away on navigation and the export
 * button had nothing to export.
 */
export type Segment = {
  name: string;
  sec: number;
  kind: "Run" | "Station";
  /** The doubles handover — the part you have to agree with your partner. */
  note: string;
};

/**
 * The starting plan, from the plan document's own numbers: runs at race pace,
 * stations at the Heerenveen distribution it says explicitly to leave alone
 * ("top 5.6% of the field, twice — that lever is spent").
 */
export const SEED: Segment[] = [
  { name: "Run 1", sec: 232, kind: "Run", note: "Hold back. Everyone goes out hot." },
  { name: "SkiErg 1000 m", sec: 165, kind: "Station", note: "Split 500/500. You start." },
  { name: "Run 2", sec: 236, kind: "Run", note: "" },
  { name: "Sled Push 50 m", sec: 130, kind: "Station", note: "Two pushes each, no rest between." },
  { name: "Run 3", sec: 238, kind: "Run", note: "" },
  { name: "Sled Pull 50 m", sec: 165, kind: "Station", note: "Your strongest station — take three pulls." },
  { name: "Run 4", sec: 238, kind: "Run", note: "" },
  { name: "Burpee Broad Jump 80 m", sec: 170, kind: "Station", note: "20 m blocks. Do not redline here." },
  { name: "Run 5", sec: 240, kind: "Run", note: "" },
  { name: "Row 1000 m", sec: 160, kind: "Station", note: "Split 500/500. Drop HR on the rest." },
  { name: "Run 6", sec: 240, kind: "Run", note: "" },
  { name: "Farmers Carry 200 m", sec: 85, kind: "Station", note: "One trip each. No set-downs." },
  { name: "Run 7", sec: 242, kind: "Run", note: "" },
  { name: "Sandbag Lunges 100 m", sec: 145, kind: "Station", note: "25 m blocks, swap every block." },
  { name: "Run 8", sec: 238, kind: "Run", note: "Empty the tank from 400 m out." },
  { name: "Wall Balls 100", sec: 180, kind: "Station", note: "Sets of 10. Never miss two in a row." },
];

export const DEFAULT_ROX = 30;
/** The slow end of the stated 55:00–56:30 target. */
export const TARGET = 56 * 60 + 30;
/** Eight stations, so eight transitions out of them. */
export const TRANSITIONS = 8;

export function totals(rows: Segment[], roxEach: number) {
  const runs = rows.filter((r) => r.kind === "Run").reduce((n, r) => n + r.sec, 0);
  const stations = rows.filter((r) => r.kind === "Station").reduce((n, r) => n + r.sec, 0);
  const rox = roxEach * TRANSITIONS;
  return { runs, stations, rox, finish: runs + stations + rox };
}

/**
 * Anything arriving from a client, made safe to store.
 *
 * The segment names and kinds are the race's structure and are not the
 * athlete's to change — only the times are. So the shape is taken from SEED and
 * only the seconds are read from the payload, which also means a stored plan
 * survives a correction to a station name.
 */
export function sanitise(input: unknown): Segment[] {
  const given = Array.isArray(input) ? input : [];
  return SEED.map((seed, i) => {
    const sec = Number((given[i] as { sec?: unknown } | undefined)?.sec);
    // 60 s is below every plausible station; 20 min is above every plausible one
    return Number.isFinite(sec) && sec >= 60 && sec <= 1200 ? { ...seed, sec: Math.round(sec) } : seed;
  });
}

export const sanitiseRox = (input: unknown) => {
  const n = Number(input);
  return Number.isFinite(n) && n >= 15 && n <= 120 ? Math.round(n) : DEFAULT_ROX;
};

/**
 * The plan as an intervals.icu workout, which is how it reaches the watch.
 *
 * Written as one step per segment with a duration target, so the watch buzzes at
 * each planned split rather than showing a single 56-minute block. The station
 * notes ride along as text: on race day the handover is the thing you forget.
 */
export function raceWorkoutText(rows: Segment[], roxEach: number): string {
  const lines: string[] = [];
  for (const r of rows) {
    lines.push(`- ${mmss(r.sec)} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
    if (r.kind === "Station") lines.push(`- ${mmss(roxEach)} Roxzone`);
  }
  return lines.join("\n");
}
