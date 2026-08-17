import type { PhaseName } from "./skeleton";

/**
 * What a session is called, as opposed to what it contains.
 *
 * "3 × 8 min" is an accurate name and a useless one. It tells an athlete what they are
 * about to do and nothing about why, which means the only sessions with meaning are the
 * ones they already understand — and the whole point of a plan is that it knows things
 * the athlete does not.
 *
 * So the prescription becomes the subline and the headline says what the session is
 * *for*: raising a threshold, making race pace cheap, learning to run on wrecked legs.
 * The title itself is left exactly as it was, because it is parsed — `prescribedPace`
 * reads the pace out of it and the calibration engine reads that — so this is a second
 * name rather than a replacement.
 *
 * Named by what the session buys, not by the physiology it buys it with. "Lactate
 * threshold development" is a textbook heading; "raising the pace you can hold for an
 * hour" is the same thing said to the person who has to go and do it.
 */

/** The ladder each quality session came from, which is what decides its purpose. */
type Ladder = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | string;

const QUALITY: Record<string, Partial<Record<PhaseName, string>>> = {
  // Run/walk and continuous aerobic work: a beginner's first block.
  L1: { base: "Learning to run for longer" },
  L2: { base: "Building the habit" },
  // Threshold. The engine's ceiling, and what a sixty-minute event is mostly decided by.
  L3: {
    base: "Raising your ceiling",
    build: "Raising your threshold",
    specific: "Holding your threshold",
    taper: "Keeping your edge",
  },
  // Critical velocity and race pace: making the pace on the card feel ordinary.
  L4: {
    base: "Meeting your race pace",
    build: "Making race pace cheap",
    specific: "Owning your race pace",
    taper: "Rehearsing race pace",
  },
  // Above it. Rare by design.
  L5: { base: "Finding your top end", build: "Sharpening your top end" },
};

const KIND: Record<string, Partial<Record<PhaseName, string>>> = {
  long_run: {
    base: "Building your durability",
    build: "Running tired, on purpose",
    specific: "Race-day durability",
    taper: "Keeping the legs long",
  },
  easy_run: {
    base: "Earning your hard days",
    build: "Earning your hard days",
    specific: "Earning your hard days",
    taper: "Staying loose",
  },
  easy_hyrox: {
    base: "Free aerobic work",
    build: "Free aerobic work",
    specific: "Machine fitness, no impact",
    taper: "Turning the legs over",
  },
  strength: {
    base: "Building the strength the stations need",
    build: "Your heaviest lifting of the block",
    specific: "Holding the strength you built",
    taper: "Keeping the pattern",
  },
  benchmark: { base: "Measuring where you are", build: "Measuring where you are" },
  race: { specific: "Race day", taper: "Race day" },
};

/** Race-specific work is named for the skill, which the label already states. */
const HYROX: Record<string, string> = {
  compromised: "Running on wrecked legs",
  transitions: "Winning the roxzone",
  half: "Race rehearsal",
  full: "The full dress rehearsal",
};

function hyroxPurpose(label: string): string {
  const l = label.toLowerCase();
  if (/full simulation/.test(l)) return HYROX.full;
  if (/simulation/.test(l)) return HYROX.half;
  if (/transition/.test(l)) return HYROX.transitions;
  return HYROX.compromised;
}

/**
 * The headline for one session, or null where the plan has nothing to add.
 *
 * Null for a commitment: the athlete's own kickboxing class does not need the plan to
 * name its purpose, and inventing one would be the app explaining somebody's hobby to
 * them.
 */
export function purposeFor(
  kind: string, phase: PhaseName | string, opts: { ladder?: Ladder; label?: string } = {},
): string | null {
  const ph = String(phase) as PhaseName;

  if (kind === "hyrox") return hyroxPurpose(opts.label ?? "");
  if (kind === "quality_run") {
    const byLadder = QUALITY[String(opts.ladder ?? "L4")];
    // Falls through the phases rather than to a generic string: a threshold session in
    // an unnamed phase is still a threshold session.
    return byLadder?.[ph] ?? byLadder?.build ?? byLadder?.base ?? "Raising your threshold";
  }
  const byKind = KIND[kind];
  return byKind?.[ph] ?? byKind?.base ?? null;
}
