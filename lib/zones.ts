/**
 * Heart-rate zones, and the rules that keep a table legible.
 *
 * Zones are derived from a measured maximum, and then editable — the design lets
 * a max be nudged, which recalculates all five, and lets any single ceiling be
 * nudged directly. Both routes go through here, because the invariant is the
 * same either way and it is easy to break: adjacent zones must not cross, the
 * table must have no gaps and no overlaps, and every label has to agree with the
 * number beside it.
 *
 * A zone table with a gap in it is worse than no zone table. Somebody's easy run
 * falls into the hole and the app reports nothing for it.
 */

export type Zone = { tag: string; label: string; min: number; max: number; colour: string };

export const DEFAULT_HR_MAX = 189;

/**
 * Zone ceilings as a fraction of maximum heart rate.
 *
 * Taken from the boundaries the plan states for a measured max of 189 — 140,
 * 152, 168, 181 — which are 74.1%, 80.4%, 88.9% and 95.8%. Percentages rather
 * than fixed numbers is what makes the table correct for a second athlete: her
 * max is not his, and applying his zones to her heart rate would report her easy
 * runs as threshold work.
 */
export const ZONE_PCT = [0.741, 0.804, 0.889, 0.958];
export const ZONE_COLOUR = ["#9CCFDE", "#0A8FB0", "#E8C051", "#C07A3E", "#12314D"];
export const TAGS = ["Z1", "Z2", "Z3", "Z4", "Z5"];

/** The top of the last zone. Not a real heart rate — a sentinel for "no ceiling". */
export const OPEN_TOP = 9999;

/** At least this many beats wide, so a zone cannot be squeezed out of existence. */
export const MIN_WIDTH = 3;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Label a table from its ceilings, so the words always match the numbers. */
export function label(ceilings: number[]): Zone[] {
  return ceilings.concat(OPEN_TOP).slice(0, 5).map((max, i) => {
    const min = i === 0 ? 0 : ceilings[i - 1] + 1;
    return {
      tag: TAGS[i],
      label: i === 0 ? `≤ ${max} bpm` : i === 4 ? `${min}+` : `${min}–${max}`,
      min, max, colour: ZONE_COLOUR[i],
    };
  });
}

/** The table a maximum implies. */
export function fromMax(hrMax: number | null | undefined): Zone[] {
  const max = hrMax && hrMax > 100 ? hrMax : DEFAULT_HR_MAX;
  return label(ZONE_PCT.map((p) => Math.round(max * p)));
}

/**
 * A stored table, made safe to use.
 *
 * Anything that is not four ascending ceilings falls back to what the maximum
 * implies rather than being repaired into something nobody chose — a zone table
 * is read by every HR chart in the app, and a half-corrected one is harder to
 * notice than an obviously default one.
 */
export function sanitise(stored: unknown, hrMax: number | null | undefined): Zone[] {
  const rows = Array.isArray(stored) ? stored : null;
  if (!rows || rows.length < 4) return fromMax(hrMax);
  const ceilings = rows.slice(0, 4).map((z) => Number((z as { max?: unknown })?.max));
  if (ceilings.some((n) => !Number.isFinite(n) || n < 1 || n >= OPEN_TOP)) return fromMax(hrMax);
  for (let i = 1; i < 4; i++) if (ceilings[i] <= ceilings[i - 1]) return fromMax(hrMax);
  return label(ceilings);
}

/**
 * Move one ceiling, keeping the table legal.
 *
 * The moved zone is clamped between its neighbours rather than pushing them
 * along: nudging Z2 up by one should not silently drag Z3 and Z4 with it, and an
 * athlete who has set Z4 deliberately should not lose it to a Z2 adjustment.
 */
export function nudge(zones: Zone[], index: number, delta: number, hrMax: number | null): Zone[] {
  if (index < 0 || index > 3) return zones;
  const ceilings = zones.slice(0, 4).map((z) => z.max);
  const floor = index === 0 ? MIN_WIDTH : ceilings[index - 1] + MIN_WIDTH;
  const roof = index === 3
    ? Math.max(hrMax ?? DEFAULT_HR_MAX, ceilings[3] + MIN_WIDTH)
    : ceilings[index + 1] - MIN_WIDTH;
  ceilings[index] = clamp(ceilings[index] + delta, floor, Math.max(floor, roof));
  return label(ceilings);
}

/** Is this table sane? Used to refuse a write rather than to repair one. */
export function problems(zones: Zone[]): string[] {
  const out: string[] = [];
  if (zones.length !== 5) out.push("A zone table has five zones.");
  const c = zones.slice(0, 4).map((z) => z.max);
  for (let i = 1; i < c.length; i++) {
    if (c[i] <= c[i - 1]) out.push(`${TAGS[i]} has to sit above ${TAGS[i - 1]}.`);
  }
  for (let i = 1; i < zones.length; i++) {
    if (zones[i].min !== zones[i - 1].max + 1) {
      out.push(`There is a gap between ${TAGS[i - 1]} and ${TAGS[i]}.`);
    }
  }
  return out;
}
