/**
 * Connecting two athletes: the code, its life, and who may act on a connection.
 *
 * Pure, and separate from the endpoints, because these are the rules that must
 * hold identically on both sides of the exchange — the screen tells you a code
 * has expired using the same clock arithmetic the server refuses it with.
 *
 * There is no lookup by name. Usernames were dropped on instruction, and with
 * them the endpoint that would answer "does this person exist" — a single-use
 * code that expires is strictly less to defend than a rate-limited oracle.
 */

/**
 * The code alphabet, minus the characters people mistype.
 *
 * No O or 0, no I or 1, no letter that reads as another in a screenshot. A code
 * is read off one screen and typed into another, so the cost of an ambiguous
 * character is the whole exchange failing for no visible reason.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const GROUP_LEN = 4;
export const GROUPS = 2;
export const CODE_LEN = GROUP_LEN * GROUPS;

/** Seven days. Long enough to be sent and read; short enough to go stale. */
export const INVITE_TTL_DAYS = 7;

/**
 * A code from bytes.
 *
 * Randomness is passed in rather than taken, so this is testable and so the
 * caller is the one that has to reach for a cryptographic source.
 */
export function codeFrom(bytes: Uint8Array): string {
  if (bytes.length < CODE_LEN) {
    throw new Error(`need ${CODE_LEN} bytes, got ${bytes.length}`);
  }
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    if (i > 0 && i % GROUP_LEN === 0) out += "-";
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * What someone typed, as a code.
 *
 * Lower case, missing dash, a space in the middle, a pasted line with a stray
 * quote: all of them are the right code entered by hand. Only the characters
 * that carry meaning are kept, so anything else is dropped rather than rejected.
 */
export function normaliseCode(input: string): string | null {
  const kept = [...input.toUpperCase()]
    // O→0 and I→1 only to then reject them: neither is in the alphabet, so a
    // reader who saw one mis-read a real character, and which one is not knowable
    // — guessing would connect them to the wrong person. L is left alone; it is
    // in the alphabet, and uppercase L against a digit that never appears is not
    // a confusion.
    .map((c) => (c === "O" ? "0" : c === "I" ? "1" : c))
    .filter((c) => CODE_ALPHABET.includes(c))
    .join("");
  if (kept.length !== CODE_LEN) return null;
  return `${kept.slice(0, GROUP_LEN)}-${kept.slice(GROUP_LEN)}`;
}

export const expiresAt = (now: Date): Date =>
  new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);

/** The pair, ordered, so one connection cannot be stored twice. */
export const pairOf = (a: string, b: string): { low: string; high: string } =>
  a < b ? { low: a, high: b } : { low: b, high: a };

export type Invite = {
  code: string; inviter_id: string;
  expires_at: string; used_at: string | null;
};

export type Refusal =
  | "expired" | "used" | "own" | "unknown" | "already" | "pending" | "declined";

export const REFUSAL: Record<Refusal, string> = {
  unknown: "That code does not match an invite. Check the characters and try again.",
  expired: "That invite has expired. Ask them to send a new one.",
  used: "That invite has already been used. Codes work once.",
  own: "That is your own invite code. Send it to them instead.",
  already: "You are already connected to them.",
  pending: "There is already a request between you two waiting on an answer.",
  declined: "They declined a request from you. Ask them to send you their code.",
};

/**
 * Whether a code can be redeemed, and if not, which refusal.
 *
 * The existing connection matters as much as the invite: a code that is fine on
 * its own is still not a way to re-open a request that was declined, or to end
 * up with two connections between the same two people.
 */
export function canRedeem(
  invite: Invite | null,
  by: string,
  existing: { status: string; requester_id: string } | null,
  now: Date,
): { ok: true } | { ok: false; why: Refusal } {
  if (!invite) return { ok: false, why: "unknown" };
  if (invite.inviter_id === by) return { ok: false, why: "own" };
  if (invite.used_at) return { ok: false, why: "used" };
  if (Date.parse(invite.expires_at) <= now.getTime()) return { ok: false, why: "expired" };

  if (existing) {
    if (existing.status === "accepted") return { ok: false, why: "already" };
    if (existing.status === "pending") return { ok: false, why: "pending" };
    // A declined request is not re-sendable by the person who was declined —
    // otherwise "no" is only ever a delay. The other direction is allowed: the
    // one who declined can still ask, and holding their own code proves it.
    if (existing.status === "declined" && existing.requester_id === by) {
      return { ok: false, why: "declined" };
    }
  }
  return { ok: true };
}

/** Who may act on a connection, and how. Anything else is a 403. */
export function actionFor(
  c: { status: string; requester_id: string; addressee_id: string },
  by: string,
): "accept" | "decline" | "cancel" | "disconnect" | null {
  if (c.status === "pending" && c.addressee_id === by) return "accept";
  if (c.status === "pending" && c.requester_id === by) return "cancel";
  if (c.status === "accepted" && (c.requester_id === by || c.addressee_id === by)) {
    return "disconnect";
  }
  return null;
}

/** How long ago something happened, for the invite and request rows. */
export function since(when: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(when)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
}
