import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksLikeEmail, normaliseEmail } from "../lib/auth";
import { PROVIDERS, callbackUrl, configured } from "../lib/oauth";

test("email is one spelling, compared case-insensitively", () => {
  // two accounts each holding half a training history is the failure here
  assert.equal(normaliseEmail("  Sarah@Example.COM "), "sarah@example.com");
  // dots and plus-tags are left alone: only some providers treat them as equal
  assert.equal(normaliseEmail("a.b+run@gmail.com"), "a.b+run@gmail.com");
});

test("obvious non-addresses are refused", () => {
  for (const ok of ["a@b.co", "sarah.rodrigues@example.com"]) assert.ok(looksLikeEmail(ok), ok);
  for (const bad of ["", "sarah", "sarah@", "@example.com", "a b@example.com", "a@b"]) {
    assert.ok(!looksLikeEmail(bad), bad);
  }
});

test("a provider is only offered once its own credentials are present", () => {
  // a sign-in button that cannot work is worse than one that is not there
  const before = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  assert.equal(configured("google"), false, "no client id, not offered");
  if (before) process.env.GOOGLE_CLIENT_ID = before;
});

test("only Google and Strava can sign anyone in", () => {
  // Apple was written and removed: an auth module is the wrong place for a path
  // that has never met a real server
  assert.deepEqual([...PROVIDERS], ["google", "strava"]);
});

test("every provider redirects back to its own callback", () => {
  // one shared callback would let a token minted for one provider be presented
  // as another's
  const seen = new Set(PROVIDERS.map(callbackUrl));
  assert.equal(seen.size, PROVIDERS.length, "no two providers share a callback");
  for (const p of PROVIDERS) assert.match(callbackUrl(p), new RegExp(`/api/auth/oauth/${p}/callback$`));
});

test("a provider fills gaps and is never allowed to overwrite an edit", () => {
  // The SQL is the assertion here: each column coalesces the STORED value first,
  // so a provider only ever writes where there is nothing. The other order would
  // undo someone's corrected weight or chosen name on every sign-in — a bug
  // nobody reports and everybody notices.
  const sqlText = readFileSync(new URL("../lib/oauth.ts", import.meta.url), "utf8");
  const fn = sqlText.slice(sqlText.indexOf("export async function fillProfileGaps"));
  assert.match(fn, /avatar_url = coalesce\(avatar_url, /, "stored avatar wins");
  assert.match(fn, /weight_kg\s+= coalesce\(weight_kg, /, "stored weight wins");
  assert.match(fn, /email\s+= coalesce\(email, /, "stored email wins");
  // the display name is only replaced when it is a placeholder nobody chose
  assert.match(fn, /display_name in \('', 'Athlete'\)/);
});

test("an implausible weight from a provider is dropped rather than stored", () => {
  const src = readFileSync(new URL("../lib/oauth.ts", import.meta.url), "utf8");
  assert.match(src, /a\.weight > 20 && a\.weight < 300/,
    "a Strava profile with weight 0 must not become someone's body weight");
});

test("sex is never read from a provider", () => {
  // division is asked; nothing derives a training load from someone's sex
  const src = readFileSync(new URL("../lib/oauth.ts", import.meta.url), "utf8");
  assert.ok(!/a\.sex|\bsex:/.test(src), "no sex field is captured");
});
