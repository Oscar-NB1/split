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

/**
 * The same race, built for whoever is looking at it.
 *
 * SEED is one athlete's plan: 56:30, "you start" on the ski, "your strongest station"
 * on the sled pull. Handed to anybody else it is a stranger's race with a stranger's
 * splits and advice about a station nobody said they were good at. Sarah opening this
 * screen with a ninety-minute goal was shown a fifty-six-minute plan.
 *
 * So the shape is SEED's — the proportions of a Hyrox are the event's, not the
 * athlete's — and everything else is derived:
 *
 *   the total      their goal time, from their own race target
 *   the split      tilted by which half limits them, because a run-limited athlete
 *                  spends relatively more of the race running and should plan for it
 *   the notes      only the ones that are true for their race. A doubles handover
 *                  note on a singles plan is advice for a partner who is not there.
 *
 * Nothing invented: an athlete with no goal time gets SEED's proportions at SEED's
 * total, and the screen says the numbers are the plan's rather than theirs.
 */
export type SeedInput = {
  /** their goal finish, in seconds */
  goal_seconds?: number | null;
  /** what the race is: a doubles plan has handovers, a singles plan has none */
  doubles?: boolean;
  /** which half of the race limits them, where it is known */
  role?: "run_limiter" | "station_carrier" | "balanced" | null;
  /** seconds per transition, if they have already set one */
  rox_seconds?: number;
};

/** The share of the race SEED spends on each part, which is the event's shape. */
const SHAPE = (() => {
  const runs = SEED.filter((r) => r.kind === "Run").reduce((n, r) => n + r.sec, 0);
  const stations = SEED.filter((r) => r.kind === "Station").reduce((n, r) => n + r.sec, 0);
  const rox = 30 * 8;
  const total = runs + stations + rox;
  return { runs: runs / total, stations: stations / total, rox: rox / total, total };
})();

export function seedFor(x: SeedInput = {}): { segments: Segment[]; rox_seconds: number } {
  const goal = x.goal_seconds && x.goal_seconds >= 30 * 60 && x.goal_seconds <= 180 * 60
    ? x.goal_seconds : SHAPE.total;

  /*
   * The tilt, and why it is small.
   *
   * A run-limited athlete does not get a slower plan — they get an honest one: more
   * of their finish time is in the eight runs, so planning them at everyone else's
   * split guarantees eight missed splits and a panic by run four. Five percent each
   * way, because the event's shape dominates and a Hyrox is a Hyrox.
   */
  const tilt = x.role === "run_limiter" ? 0.05 : x.role === "station_carrier" ? -0.05 : 0;
  const runShare = SHAPE.runs * (1 + tilt);
  const stationShare = SHAPE.stations * (1 - tilt * (SHAPE.runs / SHAPE.stations));

  const rox = x.rox_seconds ?? Math.max(
    15, Math.min(120, Math.round((goal * SHAPE.rox) / TRANSITIONS)));
  const forRuns = goal * runShare;
  const forStations = goal * stationShare;

  const seedRuns = SEED.filter((r) => r.kind === "Run").reduce((n, r) => n + r.sec, 0);
  const seedStations = SEED.filter((r) => r.kind === "Station").reduce((n, r) => n + r.sec, 0);

  const segments = SEED.map((seg) => ({
    ...seg,
    // each segment keeps its share of its own half, so a sled that is a fifth of
    // the station time stays a fifth of it
    sec: Math.round(seg.kind === "Run"
      ? (seg.sec / seedRuns) * forRuns
      : (seg.sec / seedStations) * forStations),
    note: noteFor(seg, x.doubles !== false),
  }));

  return { segments, rox_seconds: rox };
}

/**
 * The note, kept only where it is true.
 *
 * Two kinds were in SEED: race craft that is true for everybody ("hold back,
 * everyone goes out hot") and things that were true for one athlete — a handover
 * order, a station somebody had already proved they were strong at. The second kind
 * is either rewritten for a partner nobody named, or dropped.
 */
function noteFor(seg: Segment, doubles: boolean): string {
  const solo: Record<string, string> = {
    "SkiErg 1000 m": "Settle into a rhythm rather than attacking it — it is the first station and the whole race is behind it.",
    "Sled Pull 50 m": "Sit back and use your legs. Rope hand over hand, feet planted.",
    "Row 1000 m": "The one place you can bring your heart rate down. Take it.",
    "Farmers Carry 200 m": "No set-downs. Every one costs you more than the walk saves.",
    "Sandbag Lunges 100 m": "Small steps, knee down light. This is where the race is usually lost.",
  };
  const pair: Record<string, string> = {
    "SkiErg 1000 m": "Split 500/500. Agree now who starts.",
    "Sled Push 50 m": "Two pushes each, no rest between.",
    "Sled Pull 50 m": "Three pulls each, straight over.",
    "Row 1000 m": "Split 500/500. Drop your heart rate on the rest.",
    "Farmers Carry 200 m": "One trip each. No set-downs.",
    "Sandbag Lunges 100 m": "25 m blocks, swap every block.",
    "Wall Balls 100": "Sets of 10. Never miss two in a row.",
  };
  const shared: Record<string, string> = {
    "Run 1": "Hold back. Everyone goes out hot.",
    "Burpee Broad Jump 80 m": "20 m blocks. Do not redline here.",
    "Run 8": "Empty the tank from 400 m out.",
  };
  return shared[seg.name] ?? (doubles ? pair[seg.name] : solo[seg.name]) ?? "";
}

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
