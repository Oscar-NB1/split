import type { PhaseName } from "./skeleton";

/**
 * What a session is called, as opposed to what it contains.
 *
 * "3 × 8 min" is an accurate name and a useless one. It tells an athlete what they are
 * about to do and nothing about why, which means the only sessions with meaning are the
 * ones they already understand — and the whole point of a plan is that it knows things
 * the athlete does not.
 *
 * So the prescription becomes the subline and the headline says what the session is:
 * threshold intervals, race-pace intervals, compromised running. The title itself is
 * untouched because it is parsed — `prescribedPace` reads the pace out of it and the
 * calibration engine reads that — so this is a second name rather than a replacement.
 *
 * Plainly named, and only where the plain name adds something. An earlier version of
 * this file called a threshold session "Raising your ceiling" and a race-pace session
 * "Meeting your race pace", which put the ceiling above the slower of the two paces and
 * read as nonsense — correctly. A name that needs a paragraph of physiology to stop being
 * confusing is worse than the plain one. And a long run is called a long run.
 */

/** The ladder each quality session came from, which is what decides its purpose. */
type Ladder = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | string;

const QUALITY: Record<string, Partial<Record<PhaseName, string>>> = {
  // Run/walk and continuous aerobic work: a beginner's first block.
  L1: { base: "Learning to run for longer" },
  L2: { base: "Building the habit" },
  // Threshold. The engine's ceiling, and what a sixty-minute event is mostly decided by.
  /*
   * Threshold, named as threshold.
   *
   * "Raising your ceiling" sat above 4:26/km while "Meeting your race pace" sat above
   * 4:11 — and he was right that this reads as nonsense. Both labels are defensible
   * physiologically (threshold pace is slower than a 1 km rep, and raising it does raise
   * the ceiling) and together they are incoherent: the session named for a ceiling is
   * the slower one. A name that needs a paragraph of physiology to stop being confusing
   * is a worse name than the plain one.
   */
  L3: {
    base: "Threshold intervals",
    build: "Threshold intervals",
    specific: "Threshold intervals",
    taper: "Threshold intervals",
  },
  // Critical velocity and race pace: making the pace on the card feel ordinary.
  L4: {
    base: "Race-pace intervals",
    build: "Race-pace intervals",
    specific: "Race-pace intervals",
    taper: "Race-pace intervals",
  },
  // Above it. Rare by design.
  L5: { base: "Speed intervals", build: "Speed intervals" },
};

/*
 * Nothing here, and that is the point.
 *
 * A long run is called a long run. An easy run is called an easy run. Renaming them
 * "Building your durability" and "Earning your hard days" replaced two words everybody
 * understands with a slogan — and the reason those sessions exist belongs in the coach's
 * note underneath, which is where it already is, in full sentences.
 *
 * A purpose name earns its place only where the prescription is opaque: "3 × 8 min" says
 * nothing about what it is for, "Threshold intervals" says exactly what it is. "Long run"
 * is not opaque, so it gets no second name and the card shows its title.
 */
const KIND: Record<string, Partial<Record<PhaseName, string>>> = {
};

/** Race-specific work is named for the skill, which the label already states. */
const HYROX: Record<string, string> = {
  compromised: "Compromised running",
  transitions: "Transitions",
  half: "Half simulation",
  full: "Full simulation",
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
    return byLadder?.[ph] ?? byLadder?.build ?? byLadder?.base ?? "Threshold intervals";
  }
  const byKind = KIND[kind];
  return byKind?.[ph] ?? byKind?.base ?? null;
}
