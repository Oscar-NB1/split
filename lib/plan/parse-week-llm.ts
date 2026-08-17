import Anthropic from "@anthropic-ai/sdk";
import { parseWeek, type Parsed } from "./parse-week";
import type { WeekSession } from "./rebuild";

/**
 * Reading a sentence about a week with a model, and falling back to rules.
 *
 * The rule-based parser handles the sentences people write when they are being clear. A model
 * handles the ones they write when they are not — "was meant to be away Thursday but it got
 * moved so actually it's Wednesday now, and the gym's shut" is one clause to a person and
 * three contradictions to a regex.
 *
 * The division that keeps this safe is unchanged, and it is the reason a model is allowed
 * anywhere near this: it returns constraints and nothing else. It never writes a session,
 * sets a volume or picks a pace, so a week rebuilt from its output passes exactly the same
 * assertions as a generated one. If it hallucinates, the worst it can produce is a week the
 * athlete looks at and discards — which is why the preview exists.
 *
 * Falls back to the rules on a missing key, a refusal, a timeout, malformed output, or output
 * that fails the shape check. A parser that fails closed to a worse parser is better than one
 * that fails open to nothing, and the athlete never sees which one ran.
 */

const MODEL = "claude-opus-5";

/** The shape the model must return. Validated on the way out, never trusted. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    day_availability: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { type: "integer", minimum: 0, maximum: 6, description: "0 = Monday" },
          available: { type: "string", enum: ["full", "am", "pm", "none"] },
        },
        required: ["day", "available"],
      },
    },
    session_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { type: "integer", minimum: 0, maximum: 6 },
          session_type: {
            type: "string",
            enum: ["quality_run", "easy_run", "long_run", "hyrox", "easy_hyrox", "strength"],
          },
          action: { type: "string", enum: ["skip", "move", "shorten"] },
          to_day: { type: "integer", minimum: 0, maximum: 6 },
          to_slot: { type: "string", enum: ["AM", "PM"] },
        },
        required: ["day", "action"],
      },
    },
    week_intent: {
      type: "object",
      additionalProperties: false,
      properties: {
        no_long_run: { type: "boolean" },
        reduce_volume: { type: "boolean" },
        protect: { type: "array", items: { type: "string" } },
      },
    },
    ambiguities: {
      type: "array",
      maxItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          quote: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
        },
        required: ["quote", "question", "options"],
      },
    },
    confidence: { type: "string", enum: ["high", "low"] },
  },
  required: ["day_availability", "session_actions", "week_intent", "ambiguities", "confidence"],
} as const;

const SYSTEM = `You convert an athlete's sentence about their training week into structured constraints. You never write, schedule or size a session — a deterministic generator does that from what you return.

Rules, in order of how often they are got wrong:

1. LATER STATEMENTS OVERRIDE EARLIER ONES. People self-correct mid-sentence. "Out Wednesday to Friday, but Friday night I can run" means Wednesday none, Thursday none, Friday pm. Resolve the contradiction rather than reporting both.
2. An absence names what is GONE. "Away Tuesday morning" leaves the afternoon: Tuesday am is unavailable, so report available: "pm".
3. Only mention days the athlete mentioned. Silence about Monday is not a statement about Monday.
4. A range ("Wed to Fri") is every day inclusive. A list ("Tue and Thu") is only those days.
5. Return AT MOST ONE ambiguity, and only when genuinely unresolvable — a named session with two candidates in the week and no day given. If two things are unclear, resolve the bigger one and leave the smaller. Never ask about something you can infer.
6. "I need to keep X" is week_intent.protect, not an action. "Shorter week", "take it easy" is reduce_volume.
7. confidence is "low" when much of the sentence was not understood. It is not a veto — the athlete approves everything anyway.

Days are 0 = Monday through 6 = Sunday.`;

/**
 * Cheap shape check: anything the generator would choke on falls back to the rules.
 *
 * The schema is meant to make this unnecessary and this checks anyway, because the schema is
 * enforced somewhere else. A day index of 9 or an availability of "maybe" reaching
 * `rebuildWeek` is a week silently built around a constraint that does not exist.
 */
export function usable(v: unknown): v is Parsed {
  if (!v || typeof v !== "object") return false;
  const p = v as Parsed;
  if (!Array.isArray(p.day_availability) || !Array.isArray(p.session_actions)) return false;
  if (!Array.isArray(p.ambiguities)) return false;
  return p.day_availability.every((d) =>
    Number.isInteger(d.day) && d.day >= 0 && d.day <= 6
    && ["full", "am", "pm", "none"].includes(d.available));
}

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function parseWeekWith(
  raw: string, week: WeekSession[] = [],
): Promise<Parsed & { by: "model" | "rules" }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...parseWeek(raw), by: "rules" };

  /*
   * The week itself goes in as context.
   *
   * "Skipping the class" is unresolvable in the abstract and obvious when there is exactly
   * one Hyrox session in the week — so giving the model the sessions removes most of the
   * questions it would otherwise have to ask.
   */
  const context = week.length
    ? `This week's sessions:\n${week.map((s) =>
      `- ${DAY[s.day]}${s.slot ? ` ${s.slot}` : ""}: ${s.label} (${s.kind})${
        s.logged ? " — already done, cannot be changed" : ""}`).join("\n")}`
    : "The week's sessions were not provided.";

  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      /*
       * A schema rather than "reply with JSON".
       *
       * The route hands whatever comes back to the generator, so the failure mode of a prose
       * preamble around the JSON is a rebuild that silently does nothing. Constraining the
       * format removes that class of failure instead of parsing around it.
       */
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: `${context}\n\nThe athlete says: "${raw}"` }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text).join("");
    const parsed = JSON.parse(text) as unknown;
    if (!usable(parsed)) return { ...parseWeek(raw), by: "rules" };
    return { ...parsed, by: "model" };
  } catch (e) {
    /*
     * A refusal, a timeout, a rate limit or malformed output all land here, and all mean the
     * same thing: use the parser that cannot fail. The athlete never sees which one ran.
     */
    console.error("[rebuild] model parse failed, using rules:", (e as Error).message);
    return { ...parseWeek(raw), by: "rules" };
  }
}
