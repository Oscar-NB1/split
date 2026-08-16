/**
 * What may be stored as an athlete's picture.
 *
 * Its own file so the rule is testable without a request, and so both the route
 * and anything that imports it agree on what an avatar is.
 */

/** How big a stored picture may be, encoded. Roughly a 256 px JPEG at quality 8. */
export const AVATAR_MAX = 120_000;

/**
 * What arrived in `avatar_url`, as something safe to store.
 *
 * Only a data URI of an image, or null, or nothing. A remote URL is refused
 * deliberately: the ones we hold come from the sign-in providers, and accepting an
 * arbitrary one would make every profile render a request to a third party chosen
 * by whoever sent it.
 */
export function avatarFrom(v: unknown): string | null | "unchanged" | "too_big" | "not_an_image" {
  if (v === undefined) return "unchanged";
  if (v === null || v === "") return null;
  if (typeof v !== "string") return "not_an_image";
  if (v.startsWith("https://")) return v.slice(0, 500);
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(v)) return "not_an_image";
  if (v.length > AVATAR_MAX) return "too_big";
  return v;
}
