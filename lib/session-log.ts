import Anthropic from "@anthropic-ai/sdk";

/**
 * Reading a sentence about a session into a shape the screens can render.
 *
 * "Hyrox class, about an hour and a half, we did sled push and pull, fifty wall balls, a couple
 * of kilometres of running between stations, felt like an eight" is a complete account of a
 * session to a person and nothing at all to a database. Strava, meanwhile, offers
 * "WeightTraining, 111 minutes".
 *
 * The same division that lets a model near the week rebuild applies here, and more easily: this
 * writes a log. It sets no pace, prescribes no load, and moves no session. Where it reads
 * something worth acting on — lifts that could be saved as sets, a kind that plainly disagrees
 * with what Strava called it — that is returned as a suggestion for somebody to tap, never as
 * a change. It does not have to be right. It has to be roughly right and never authoritative.
 */

const MODEL = "claude-opus-5";

/** The kinds a session can be read as, matching the app's own vocabulary. */
export const LOG_KINDS = [
  "hyrox", "strength", "easy_run", "long_run", "quality_run", "spin", "class", "other",
] as const;

export type Structured = {
  summary: string;
  kind: (typeof LOG_KINDS)[number] | null;
  duration_min: number | null;
  rpe: number | null;
  stations: { name: string; detail: string | null }[];
  lifts: { name: string; sets: number | null; reps: number | null; load_kg: number | null }[];
  running_km: number | null;
  notes: string | null;
};

/** The shape the model must return. Validated on the way out, never trusted. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "kind", "duration_min", "rpe", "stations", "lifts", "running_km", "notes"],
  properties: {
    summary: {
      type: "string",
      description: "One or two sentences, in the athlete's own terms, saying what the session was.",
    },
    kind: {
      type: ["string", "null"], enum: [...LOG_KINDS, null],
      description: "What kind of session this was. Null if genuinely unclear.",
    },
    duration_min: { type: ["integer", "null"], description: "Total minutes, if stated." },
    rpe: {
      type: ["integer", "null"], minimum: 1, maximum: 10,
      description: "Effort out of ten, only if the athlete gave one or clearly implied one.",
    },
    stations: {
      type: "array",
      description: "Hyrox stations or circuit movements, in the order mentioned.",
      items: {
        type: "object", additionalProperties: false, required: ["name", "detail"],
        properties: {
          name: { type: "string" },
          detail: {
            type: ["string", "null"],
            description: "Reps, load, distance or time as said — '50 at 6kg', '2 × 25 m'.",
          },
        },
      },
    },
    lifts: {
      type: "array",
      description: "Only barbell/dumbbell/kettlebell work with a nameable movement.",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "sets", "reps", "load_kg"],
        properties: {
          name: { type: "string" },
          sets: { type: ["integer", "null"] },
          reps: { type: ["integer", "null"] },
          load_kg: { type: ["number", "null"], description: "Never guess. Null unless stated." },
        },
      },
    },
    running_km: {
      type: ["number", "null"],
      description: "Kilometres run inside the session, if mentioned.",
    },
    notes: {
      type: ["string", "null"],
      description: "Anything worth remembering that is not covered above — a niggle, "
        + "a technique note, who they trained with.",
    },
  },
} as const;

const SYSTEM = `You turn an athlete's spoken account of a training session into structured data.

Rules that matter more than completeness:
- Record only what was said. Never infer a load, a rep count or a duration that was not stated —
  null is a correct answer and a plausible invention is not.
- Keep their words in the summary. This is their training diary, not a coaching report.
- A number you are unsure of belongs in the summary as prose, not in a numeric field.
- Speech-to-text mangles gym vocabulary. "Sled pull" may arrive as "slide pull", "wall balls" as
  "war balls", "burpee broad jumps" as "burpee broad drums", RPE as "R P E" or "our PE". Read
  through obvious mis-hearings; do not invent movements that are not plausibly there.
- Hyrox stations are: SkiErg, sled push, sled pull, burpee broad jumps, rowing, farmers carry,
  sandbag lunges, wall balls. A session naming several of these is a Hyrox session.`;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Everything the model returned that survives inspection.
 *
 * Written as a filter rather than a check: one implausible load should cost that lift, not the
 * whole log. The transcript is stored either way, so the worst case is a log with fewer fields
 * and the words intact — which is still the thing the athlete asked for.
 */
export function clean(raw: unknown): Structured | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return null;

  const kind = typeof o.kind === "string"
    && (LOG_KINDS as readonly string[]).includes(o.kind) ? o.kind as Structured["kind"] : null;
  const dur = num(o.duration_min);
  const rpe = num(o.rpe);

  return {
    summary: summary.slice(0, 800),
    kind,
    /* A session is minutes long, not seconds and not days. */
    duration_min: dur != null && dur >= 1 && dur <= 600 ? Math.round(dur) : null,
    rpe: rpe != null && rpe >= 1 && rpe <= 10 ? Math.round(rpe) : null,
    stations: (Array.isArray(o.stations) ? o.stations : []).slice(0, 20).flatMap((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      const name = typeof x.name === "string" ? x.name.trim().slice(0, 60) : "";
      return name ? [{
        name, detail: typeof x.detail === "string" ? x.detail.trim().slice(0, 120) : null,
      }] : [];
    }),
    lifts: (Array.isArray(o.lifts) ? o.lifts : []).slice(0, 20).flatMap((l) => {
      const x = (l ?? {}) as Record<string, unknown>;
      const name = typeof x.name === "string" ? x.name.trim().slice(0, 60) : "";
      if (!name) return [];
      const load = num(x.load_kg);
      const sets = num(x.sets);
      const reps = num(x.reps);
      return [{
        name,
        sets: sets != null && sets >= 1 && sets <= 20 ? Math.round(sets) : null,
        reps: reps != null && reps >= 1 && reps <= 200 ? Math.round(reps) : null,
        /*
         * A load nobody could lift is a transcription artefact, not a personal best. Anything
         * outside this range is dropped rather than corrected: it would otherwise be offered
         * as a set to save, and a hallucinated 800 kg squat that somebody taps through would
         * re-prescribe their next block.
         */
        load_kg: load != null && load > 0 && load <= 400 ? Math.round(load * 10) / 10 : null,
      }];
    }),
    running_km: (() => {
      const km = num(o.running_km);
      return km != null && km > 0 && km <= 100 ? Math.round(km * 100) / 100 : null;
    })(),
    notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim().slice(0, 800) : null,
  };
}

/**
 * What this session looks like to somebody who was not there, or null when the model is
 * unavailable or unusable.
 *
 * There is no rule-based fallback, unlike the week rebuild: a sentence about a session has no
 * grammar to parse, and half-reading it would produce a worse log than the transcript on its
 * own. The caller stores the words regardless, which is the part that has to work.
 */
export async function readLog(transcript: string, context?: string): Promise<Structured | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 30_000 });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      /*
       * Effort low on purpose. This is extraction from a short sentence, the shape is already
       * constrained by the schema, and the athlete is standing in a car park waiting for it.
       */
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: `${context ? `${context}\n\n` : ""}The athlete said: "${transcript}"`,
      }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text).join("");
    return clean(JSON.parse(text));
  } catch (e) {
    console.error("[log] model read failed:", (e as Error).message);
    return null;
  }
}

/** The kind the app derived from Strava, in the same vocabulary the log uses. */
export function kindFromSport(sport: string | null | undefined): string | null {
  const s = (sport ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("run")) return "easy_run";
  if (/ride|cycl|spin|handcycle/.test(s)) return "spin";
  if (s.includes("weight")) return "strength";
  if (/crossfit|highintensity|hiit|workout|functional/.test(s)) return "other";
  return null;
}

export type Suggestion =
  | { type: "reclassify"; from: string; to: string; why: string }
  | { type: "save_lifts"; count: number };

/**
 * What the log noticed that somebody might want to act on.
 *
 * Suggestions, never actions. A Hyrox class that Strava filed as WeightTraining is scored at the
 * strength weighting (0.75) instead of the Hyrox one (1.7), which is worth fixing — and a
 * sentence rewriting scored data without being asked is not something this app should do.
 */
export function suggestionsFor(
  s: Structured | null, sportKind: string | null,
): Suggestion[] {
  if (!s) return [];
  const out: Suggestion[] = [];
  if (s.kind && sportKind && s.kind !== sportKind) {
    out.push({
      type: "reclassify", from: sportKind, to: s.kind,
      why: `Strava called this ${sportKind.replace("_", " ")}`,
    });
  }
  const named = s.lifts.filter((l) => l.load_kg != null && l.sets != null);
  if (named.length > 0) out.push({ type: "save_lifts", count: named.length });
  return out;
}
