import Anthropic from "@anthropic-ai/sdk";
import type { Pattern } from "./exercises";
import type { ConstraintReading, TrainingConstraint } from "./constraints";

/**
 * Reading "anything to train around?" into constraints the plan can act on.
 *
 * This is the free text the app has always admitted it never read. A model is the right tool
 * for it in a way it is not for most of this codebase: the answers are one or two sentences
 * of ordinary language about a body, they are different every time, and there is no
 * enumeration of them to write down. "Left knee is fine straight but hates deep lunging",
 * "dodgy shoulder, overhead is a no", "achilles has been grumbling since April".
 *
 * Three things bound what it is allowed to conclude, and they are what make it safe:
 *
 *   The vocabulary only removes and substitutes (see ./constraints). There is no output that
 *   adds a session, changes a volume, sets a pace or suggests a rehab protocol.
 *
 *   Nothing is applied until the athlete confirms it. This returns a proposal, quoted back
 *   in their own words, and the confirm step is a separate call.
 *
 *   Anything it understands but cannot act on comes back as unactionable rather than being
 *   dropped, because a note about chest pain that produces a silent no-op is worse than no
 *   feature at all — it reads, to the person who wrote it, like the plan took it in.
 *
 * With no key it falls back to a keyword reader. That reader is deliberately narrow and
 * deliberately tested: it catches the common phrasings and leaves the rest to the athlete,
 * which is the same standard the app held before any of this existed.
 */

const MODEL = "claude-opus-5";

const PATTERNS: Pattern[] = ["hinge", "squat", "single_leg", "press", "pull", "carry",
  "core", "calf", "grip"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    constraints: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          avoid_pattern: { type: "string", enum: PATTERNS },
          avoid_movement: { type: "string" },
          quote: { type: "string", description: "the athlete's own words, verbatim" },
          because: { type: "string", description: "one plain line: why this follows" },
        },
        required: ["quote", "because"],
      },
    },
    unactionable: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          quote: { type: "string" },
          why: { type: "string" },
        },
        required: ["quote", "why"],
      },
    },
  },
  required: ["constraints", "unactionable"],
} as const;

const SYSTEM = `You read one athlete's note about what they are managing physically, and return only what a training plan can act on. You are not diagnosing anything and you never suggest treatment, rehab or exercises to do.

The plan can do exactly two things: keep a movement pattern out of the gym session, or keep one named movement out. That is the whole vocabulary. It cannot prescribe rehab, change volume, set paces or refer anybody anywhere.

Patterns available: hinge, squat, single_leg, press, pull, carry, core, calf, grip.

How to decide:
- Prefer a pattern over a named movement. A knee that hates lunging hates every single-leg lift, not only the one prescribed this week.
- Use avoid_movement only when they named something specific ("no burpees", "box jumps are out").
- Be conservative in COUNT, not in caution: two well-chosen constraints beat five that gut the session. Never return more than is clearly supported.
- quote must be the athlete's own words, verbatim and short.
- because is one plain line an athlete would recognise as fair — "you said deep lunging hurts, and every single-leg lift is a lunge".

Put in unactionable anything you understood that this vocabulary cannot express — pain that sounds acute or medical, anything about breathing, chest, dizziness, numbness, a recent operation, or a request to change volume or paces. Say plainly in "why" that the plan cannot act on it and that it needs a person, not that it was ignored. Never state or imply a diagnosis, and never tell them what to do about it beyond speaking to someone qualified.

An empty note, or a note that says nothing is wrong, returns two empty arrays. Do not invent a constraint to be helpful — an unnecessary one takes real training away.`;

/** Guards the shape, and drops any constraint that says nothing the plan can use. */
function clean(v: unknown): ConstraintReading | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { constraints?: unknown; unactionable?: unknown };
  if (!Array.isArray(o.constraints) || !Array.isArray(o.unactionable)) return null;

  const constraints = (o.constraints as TrainingConstraint[])
    .filter((c) => c && typeof c.quote === "string" && typeof c.because === "string")
    /* A constraint naming neither a pattern nor a movement is not a constraint. */
    .filter((c) => (c.avoid_pattern && PATTERNS.includes(c.avoid_pattern))
      || (typeof c.avoid_movement === "string" && c.avoid_movement.trim().length > 1))
    .map((c) => ({
      ...(c.avoid_pattern && PATTERNS.includes(c.avoid_pattern)
        ? { avoid_pattern: c.avoid_pattern } : {}),
      ...(c.avoid_movement?.trim() ? { avoid_movement: c.avoid_movement.trim() } : {}),
      quote: c.quote.slice(0, 160),
      because: c.because.slice(0, 200),
    }))
    /* Four is already a heavily reduced session. More than that is a conversation. */
    .slice(0, 4);

  const unactionable = (o.unactionable as { quote?: unknown; why?: unknown }[])
    .filter((u) => u && typeof u.quote === "string" && typeof u.why === "string")
    .map((u) => ({ quote: String(u.quote).slice(0, 160), why: String(u.why).slice(0, 240) }))
    .slice(0, 3);

  return { constraints, unactionable, by: "model" };
}

/**
 * The keyword reader: what runs with no key, and what the tests hold.
 *
 * It reads the phrasings that come up again and again and nothing clever. Where it is unsure
 * it says nothing, because a wrong constraint removes training the athlete needs — the cost
 * of missing one is that the plan behaves exactly as it did before this existed.
 */
const RULES: { where: RegExp; pattern: Pattern; because: string }[] = [
  {
    where: /\b(knee|knees|patella|acl|mcl|meniscus)\b/i, pattern: "single_leg",
    because: "you mentioned your knee, and single-leg work is where a knee gets loaded hardest",
  },
  {
    where: /\b(shoulder|shoulders|rotator|ac joint|impingement)\b/i, pattern: "press",
    because: "you mentioned your shoulder, so nothing goes overhead",
  },
  {
    where: /\b(lower back|low back|back|lumbar|disc|sciatica)\b/i, pattern: "hinge",
    because: "you mentioned your back, and the hinge is what loads it",
  },
  {
    where: /\b(achilles|calf|calves|heel|plantar)\b/i, pattern: "calf",
    because: "you mentioned your achilles or calf, so the calf work comes out",
  },
  {
    where: /\b(wrist|elbow|hand|grip|forearm)\b/i, pattern: "grip",
    because: "you mentioned your grip or forearm, so the hanging and carrying work comes out",
  },
  {
    where: /\b(hip|hips|groin|adductor|glute)\b/i, pattern: "squat",
    because: "you mentioned your hip, so the heavy double-leg work comes out",
  },
];

/** Things no vocabulary of substitutions has any business answering. */
const MEDICAL = /\b(chest|breath|breathing|dizzy|dizziness|faint|numb|numbness|tingling|palpitation|surgery|operation|fracture|broken|stress fracture|blood|heart)\b/i;

/** A note saying nothing is wrong. Read, so it does not get pattern-matched into a rule. */
const NOTHING = /^\s*(no|none|nothing|n\/?a|all good|nope|nada|-|\.)\s*\.?\s*$/i;

export function readByWords(text: string): ConstraintReading {
  const raw = (text ?? "").trim();
  if (!raw || NOTHING.test(raw)) return { constraints: [], unactionable: [], by: "words" };

  const unactionable: ConstraintReading["unactionable"] = [];
  if (MEDICAL.test(raw)) {
    unactionable.push({
      quote: raw.slice(0, 160),
      why: "Some of that is not something a training plan can work around. Nothing here is "
        + "medical advice — worth saying to someone qualified before the next hard session.",
    });
  }

  /*
   * Read a sentence at a time, and quote the sentence.
   *
   * A character window around the match produced quotes like "aight but hates deep lunging" —
   * which is the app putting words in somebody's mouth on a screen whose entire job is
   * showing them their own. A sentence is also the right unit for the next judgement.
   */
  const sentences = raw.split(/(?<=[.!?;\n])\s+|\n+/).map((t) => t.trim()).filter(Boolean);

  const constraints: TrainingConstraint[] = [];
  for (const sentence of sentences.length ? sentences : [raw]) {
    for (const r of RULES) {
      if (!r.where.test(sentence)) continue;
      if (constraints.some((c) => c.avoid_pattern === r.pattern)) continue;
      /*
       * "Fine on X" says what does NOT hurt, and reading it as a complaint removes the one
       * thing the athlete can still do — so a clean all-clear is skipped.
       *
       * But only a clean one. "Left knee is fine straight but hates deep lunging" was being
       * thrown away by a bare search for "fine", which is the exact sentence this feature
       * exists for: the reassurance is about one range of motion and the complaint is about
       * another. A contrast word means the all-clear was qualified, and the complaint stands.
       */
      const clear = /\b(fine|ok|okay|no problem|good|healed|sorted|no issues?)\b/i.test(sentence);
      const contrast = /\b(but|except|unless|although|though|hates?|hurts?|painful|niggl|sore|grumbl|dodgy|struggl)\b/i
        .test(sentence);
      if (clear && !contrast) continue;
      constraints.push({ avoid_pattern: r.pattern, quote: sentence, because: r.because });
      break;
    }
    /* Two is already a heavily reduced session. Beyond that a person should be involved. */
    if (constraints.length >= 2) break;
  }

  return { constraints, unactionable, by: "words" };
}

export async function readInjuries(text: string): Promise<ConstraintReading> {
  const raw = (text ?? "").trim();
  if (!raw || NOTHING.test(raw)) return { constraints: [], unactionable: [], by: "words" };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return readByWords(raw);

  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: `The athlete's note:\n\n"${raw.slice(0, 1200)}"` }],
    });
    const out = clean(JSON.parse(res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text).join("")) as unknown);
    return out ?? readByWords(raw);
  } catch (e) {
    /*
     * A refusal lands here too, and falling back is right for it: a model declining to read
     * a health note is not a reason to show the athlete an error about their own body.
     */
    console.error("[constraints] model read failed, using words:", (e as Error).message);
    return readByWords(raw);
  }
}
