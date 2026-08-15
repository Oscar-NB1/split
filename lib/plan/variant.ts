/**
 * The training variant, derived once at intake and stored.
 *
 * Not recomputed at generation: a plan has to stay explainable after the
 * athlete changes gyms, and a variant that silently re-derives makes last
 * month's plan unreadable.
 */

export const KIT = [
  "race_weight_sled", "light_sled", "ski", "row", "wall_balls", "sandbag",
  "farmers_handles", "burpee_space", "running_track", "treadmill",
  "kettlebells", "barbell", "pull_up_bar",
] as const;
export type Kit = (typeof KIT)[number];

export const ACCESS = ["open_floor", "queue", "classes_only"] as const;
export type Access = (typeof ACCESS)[number];

/** How far the running is from the stations. It gates compromised running. */
export const RUN_ATTACHMENT = ["attached", "short_walk", "separate"] as const;
export type RunAttachment = (typeof RUN_ATTACHMENT)[number];

export const VARIANT = ["full", "gym", "field", "class"] as const;
export type Variant = (typeof VARIANT)[number];

/** The stations a `full` variant requires. Note race weight, not any sled. */
const FULL_KIT: Kit[] = ["race_weight_sled", "ski", "row", "wall_balls"];

export type VariantInput = {
  kit: Kit[]; access: Access; run_attachment: RunAttachment;
};

export function deriveVariant(x: VariantInput): Variant {
  if (x.access === "classes_only") return "class";
  const has = (k: Kit) => x.kit.includes(k);
  if (x.kit.length === 0) return "field";
  const complete = FULL_KIT.every(has);
  if (complete && x.access === "open_floor" && x.run_attachment !== "separate") return "full";
  return "gym";
}

export type Flag = { code: string; message: string };

/**
 * What the equipment answers change about the plan, said out loud.
 *
 * The backend never silently corrects an athlete's answer — it accepts it and
 * flags the consequence, because the consequence is the thing they can act on.
 */
export function equipmentFlags(x: VariantInput): Flag[] {
  const out: Flag[] = [];
  const has = (k: Kit) => x.kit.includes(k);

  if (has("light_sled") && !has("race_weight_sled")) {
    out.push({
      code: "light_sled_only",
      message:
        "You train on a lighter sled, so race day would be the first time you meet race weight. That is a bigger deal than a variant downgrade: one session at a proper facility during the specific phase is scheduled for it.",
    });
  }
  if (x.run_attachment === "separate") {
    out.push({
      code: "runs_separate",
      message:
        "Your running and your stations are in different places, so transitions cannot be rehearsed in normal training. One or two dedicated facility visits go in the specific phase — not race week, which is for rehearsing the known.",
    });
  }
  if (x.access === "classes_only") {
    out.push({
      code: "classes_only",
      message:
        "You train in classes, so sessions are written to fit a class rather than prescribed set by set. Nothing here asks you to do something the class will not.",
    });
  }
  if (x.access === "queue") {
    out.push({
      code: "queued_stations",
      message:
        "Expecting to queue means continuous station work is not reliable, so sessions are written to survive an interruption.",
    });
  }
  return out;
}

/**
 * `access = classes_only` beats a stated preference for prescribed sessions.
 *
 * Resolved at intake and stored, rather than left to generation: the athlete is
 * told once, instead of being handed sessions every week that they cannot run.
 */
export function resolveSessionPreference(
  stated: "prescribed" | "flexible", access: Access,
): { resolved: "prescribed" | "flexible"; flag: Flag | null } {
  if (access === "classes_only" && stated === "prescribed") {
    return {
      resolved: "flexible",
      flag: {
        code: "preference_overridden",
        message:
          "You asked for prescribed sessions, but you train in classes. Sessions are written flexibly so you can actually execute them.",
      },
    };
  }
  return { resolved: stated, flag: null };
}
