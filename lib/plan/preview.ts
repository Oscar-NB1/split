import type { Intake } from "../intake";
import { paramsFrom, type Extra } from "./from-intake";
import { resolve } from "./resolve";
import { skeleton } from "./skeleton";
import { allocateSlots } from "./slots";
import { allocationFor, roleFrom } from "./allocate";

/**
 * What the two dials would do, before anything is built.
 *
 * Indicative by construction: it runs the real resolve and the real volume
 * skeleton, and stops there. It does not place sessions, does not read absences,
 * does not know about races — so it is the shape of the block, not the block. The
 * screen says so, and this file exists so that what it says is at least derived
 * from the same rules rather than drawn.
 *
 * Pure, and safe to call on every tap of a dial.
 */

export type PreviewWeek = { n: number; km: number; deload: boolean; phase: string };
export type PreviewRow = { label: string; value: string };

export type Preview = {
  weeks: PreviewWeek[];
  peak: number;
  start: number;
  ceiling: number | null;
  ramp: number;
  /** one sentence describing the curve above */
  curve: string;
  /** what the difficulty dial changes, as rows */
  rows: PreviewRow[];
};

const EMPTY: Extra = { recent: null, absences: [], max_hr: null, measured: false };

export function dialPreview(x: Intake, extra: Partial<Extra> = {}): Preview {
  const p = paramsFrom(x, { ...EMPTY, ...extra });
  const r = resolve({
    general_training_age: p.general_training_age,
    hyrox_experience: p.hyrox_experience,
    running_base: p.running_base,
    target_sessions: p.target_sessions,
    available_days: p.available_days,
    confidence: p.confidence,
    volume_dial: p.volume_dial,
    allow_doubles: p.allow_doubles,
    recent: p.recent,
  });
  const { weeks } = skeleton(r, p.length);

  const role = p.partner
    ? roleFrom(p.partner.run_delta, p.partner.station_delta)
    : "balanced";
  const slots = allocateSlots({
    target_sessions: r.sessions,
    // The build phase: the middle of the block, which is what the curve is mostly
    // made of. Quoting the taper's split here would describe a fortnight.
    allocation: allocationFor(role, p.goal, "build",
      p.discipline === "singles" ? "singles" : "doubles"),
    discipline: p.discipline, commitments: p.commitments,
    max_hard: r.max_hard, quality_target: p.quality_target,
  });

  const rows: PreviewRow[] = [
    ["Quality sessions", `${slots.counts.quality_run} a week`],
    ["Long run", p.long_run_pace ? "Finishes at effort" : "By effort, no pace target"],
    ["Hard days back to back", "Never"],
    ["Margin for a bad night", marginOf(p.volume_dial ?? 1, p.quality_target ?? 1)],
  ].map(([label, value]) => ({ label, value }));

  const peak = Math.max(...weeks.map((w) => w.km));
  const downs = weeks.map((w, i) => (w.deload ? i + 1 : 0)).filter(Boolean);
  const deloadEvery = deloadSpacing(weeks.map((w) => w.deload));
  const downNote = deloadEvery
    ? `, down week every ${ORDINAL[deloadEvery] ?? deloadEvery}`
    : downs.length === 1 ? `, with a down week at week ${downs[0]}`
    : "";

  return {
    weeks: weeks.map((w, i) => ({
      n: i + 1, km: Math.round(w.km), deload: w.deload, phase: String(w.phase),
    })),
    peak: Math.round(peak),
    start: Math.round(weeks[0]?.km ?? 0),
    /*
     * The block's peak cap, not the week-1 cap.
     *
     * r.ceiling is what the running base allows in week 1; quoting it beside a
     * peak read as "peaks at 70 km against your 32 km ceiling", which is not a
     * sentence anyone can act on. peak_ceiling is the one the curve is held under.
     */
    ceiling: Math.round(r.peak_ceiling),
    ramp: Math.round(r.ramp_rate * 1000) / 10,
    curve: `Starts at ${Math.round(weeks[0]?.km ?? 0)} km, climbs ${
      Math.round(r.ramp_rate * 1000) / 10}% a week${downNote}, peaks at ${
      Math.round(peak)} km${
      peak >= r.peak_ceiling - 0.5 ? ", which is the ceiling for a single block" : ""}.`,
    rows,
  };
}

const ORDINAL: Record<number, string> = { 2: "second", 3: "third", 4: "fourth", 5: "fifth" };

/** The gap between down weeks, or null when there is at most one. */
function deloadSpacing(flags: boolean[]): number | null {
  const at = flags.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  if (at.length < 2) return null;
  return at[1] - at[0];
}

/**
 * How much room a bad night of sleep leaves.
 *
 * Said as words rather than a number because it is not measured — it is the
 * combination of how fast the volume climbs and how many hard days are in the
 * week, and an athlete asking "can I take this on" wants that in one phrase.
 */
function marginOf(dial: number, quality: number): string {
  const load = dial + quality * 0.35;
  return load >= 1.9 ? "Small" : load >= 1.5 ? "Reasonable" : "Generous";
}
