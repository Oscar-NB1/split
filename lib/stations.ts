/**
 * Recognising Hyrox stations in lap names.
 *
 * A Garmin lap is usually called "Lap 7", but when a station is named — either
 * by the athlete on the watch or by the race timing system — it can be matched
 * to the eight stations and compared against a race result. That comparison is
 * the point: training station times only mean something next to the ones you
 * actually raced.
 *
 * Deliberately conservative. An unrecognised lap gets no station_key rather than
 * a guess, because a wrongly-labelled sled push would silently corrupt the
 * comparison it exists to serve.
 */

export const STATIONS = [
  { key: "ski", label: "SkiErg", distance: "1000 m", match: /ski/i },
  { key: "sled_push", label: "Sled Push", distance: "50 m", match: /sled\s*push|push\s*sled/i },
  { key: "sled_pull", label: "Sled Pull", distance: "50 m", match: /sled\s*pull|pull\s*sled/i },
  { key: "burpee", label: "Burpee Broad Jump", distance: "80 m", match: /burpee/i },
  { key: "row", label: "Row", distance: "1000 m", match: /\brow(ing)?\b/i },
  { key: "carry", label: "Farmers Carry", distance: "200 m", match: /farmer|carry/i },
  { key: "lunges", label: "Sandbag Lunges", distance: "100 m", match: /lunge|sandbag/i },
  { key: "wallballs", label: "Wall Balls", distance: "100", match: /wall\s*ball/i },
] as const;

export type StationKey = (typeof STATIONS)[number]["key"];

/** The station a lap name refers to, or null. */
export function stationOf(name: string | null | undefined): StationKey | null {
  if (!name) return null;
  for (const s of STATIONS) if (s.match.test(name)) return s.key;
  return null;
}

/** The same, for a race result's split label ("50m Sled Push"). */
export const stationOfSplit = stationOf;

export const stationLabel = (key: string) =>
  STATIONS.find((s) => s.key === key)?.label ?? key;
