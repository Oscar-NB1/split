/**
 * Reading a HYROX race result off the official results site.
 *
 * Why this rather than an API: RoxFit has no public developer API — it reads
 * from Garmin and Strava, so it holds no race data of its own. The only place
 * the eight run splits and eight station times exist is results.hyrox.com
 * (mikatiming), which times every HYROX event, and a third-party paid API that
 * mirrors it. For a handful of races a year, parsing the page you can already
 * see in your browser is the proportionate answer.
 *
 * This is HTML parsing, so it is inherently fragile — if mikatiming redesign
 * their result page it breaks. That is an acceptable trade here because it
 * breaks *loudly*, on a manual action, a few times a year, and the fallback is
 * typing sixteen numbers. Everything below fails with a specific message rather
 * than silently storing a race with no splits.
 */

/** The only host we will ever fetch. */
const RESULTS_HOST = "results.hyrox.com";

export type SplitKind = "run" | "station" | "roxzone" | "total" | "other";

export type ParsedSplit = {
  order: number;
  label: string;
  kind: SplitKind;
  seconds: number;
  place: number | null;
};

export type ParsedRace = {
  source_url: string;
  external_id: string | null;
  athlete_name: string | null;
  bib: string | null;
  event_name: string | null;
  division: string | null;
  age_group: string | null;
  overall_seconds: number | null;
  rank_overall: number | null;
  rank_age_group: number | null;
  splits: ParsedSplit[];
};

/**
 * Whether a user-supplied URL is safe to fetch.
 *
 * This matters more than it looks: the server fetches whatever URL the browser
 * hands it, which is a server-side request forgery hole if the host isn't
 * pinned. Checked by parsing the URL and comparing the host exactly — a
 * `startsWith("https://results.hyrox.com")` test would happily accept
 * `https://results.hyrox.com.evil.test/`.
 */
export function isResultUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname.toLowerCase() === RESULTS_HOST;
}

/** `idp` is mikatiming's per-result id, and the natural dedupe key. */
export function resultIdOf(raw: string): string | null {
  try {
    return new URL(raw).searchParams.get("idp");
  } catch {
    return null;
  }
}

const strip = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&ndash;|&#8211;|–/g, "-").replace(/\s+/g, " ").trim();

/** "00:52:00" or "52:00" to seconds. Returns null for "-" and anything else. */
export function toSeconds(text: string): number | null {
  const m = strip(text).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, h, mm, ss] = m;
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
}

/** A `<th>Label</th><td>value</td>` pair from one of the detail panels. */
function field(html: string, label: string): string | null {
  const re = new RegExp(
    `<t[hd][^>]*>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</t[hd]>\\s*<t[dh][^>]*>([\\s\\S]{0,200}?)</t[dh]>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return null;
  const v = strip(m[1]);
  return v && v !== "-" ? v : null;
}

/** Which of the four things a split row is, decided by its label. */
export function classify(label: string): SplitKind {
  const l = label.toLowerCase();
  if (/^running\s*\d+$/.test(l)) return "run";
  if (/roxzone/.test(l)) return "roxzone";
  // aggregates the page computes for you; kept, but not part of the sequence
  if (/^run total$/.test(l) || /^best run lap$/.test(l) || /^total$/.test(l)) return "total";
  if (/skierg|sled push|sled pull|burpee|row|farmers|lunges|wall balls/.test(l)) return "station";
  return "other";
}

/**
 * Parse a results.hyrox.com athlete detail page.
 *
 * The page carries the station labels *twice*: once in "Workout summary" with
 * real times, and again in "Race replay", which is all dashes unless the athlete
 * wore a tracker. Parsing both would overwrite good times with nothing, so the
 * table with the most real times wins rather than the first one found.
 */
export function parseHyroxResult(html: string, sourceUrl: string): ParsedRace {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const TIME = /\d{1,2}:\d{2}:\d{2}/g;
  let best = "";
  let bestCount = 0;
  for (const t of tables) {
    if (!/running\s*1|skierg/i.test(t)) continue;
    const count = (t.match(TIME) ?? []).length;
    if (count > bestCount) { bestCount = count; best = t; }
  }

  const splits: ParsedSplit[] = [];
  let order = 0;
  // Row by row rather than one regex over the whole table: a pattern spanning
  // <tr> boundaries happily matched the header's <th>Split</th> and then ran on
  // to the next row's label, producing "Split Time Place Running 1" — which
  // silently failed the run test and lost the first kilometre.
  for (const row of best.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const label = strip((row.match(/<th[^>]*>([\s\S]*?)<\/th>/i) ?? [])[1] ?? "");
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
    const seconds = toSeconds(cells[0] ?? "");
    if (!label || seconds == null) continue; // the header row, and untimed rows
    const place = /^\d+$/.test(cells[1] ?? "") ? Number(cells[1]) : null;
    splits.push({ order: order++, label, kind: classify(label), seconds, place });
  }

  const rank = (label: string) => {
    const v = field(html, label);
    const n = v && v.match(/\d+/);
    return n ? Number(n[0]) : null;
  };

  return {
    source_url: sourceUrl,
    external_id: resultIdOf(sourceUrl),
    athlete_name: field(html, "Name"),
    bib: field(html, "Bib Number"),
    // mikatiming labels the event "City" on this page — it holds "Warsaw 2026"
    event_name: field(html, "City"),
    division: field(html, "Division"),
    age_group: field(html, "Age Group"),
    overall_seconds: toSeconds(field(html, "Overall Time") ?? ""),
    rank_overall: rank("Rank (M/W)"),
    rank_age_group: rank("Rank (AG)"),
    splits,
  };
}

/** A parsed race we would refuse to store, and why. */
export function validationError(race: ParsedRace): string | null {
  if (race.splits.length === 0) {
    return "No splits found on that page. Make sure the link is an athlete's " +
      "result detail page, not a results list.";
  }
  if (race.overall_seconds == null) {
    return "No overall time found on that page.";
  }
  const runs = race.splits.filter((s) => s.kind === "run").length;
  const stations = race.splits.filter((s) => s.kind === "station").length;
  // Not an error — a relay, an adaptive division or a future format may have a
  // different shape, and refusing it would be worse than storing it.
  if (runs === 0 && stations === 0) {
    return "That page has timings but no runs or stations we recognise.";
  }
  return null;
}
