import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS, MIN_PASSWORD, type Account, hashPassword, isLocked, looksLikeEmail,
  normaliseEmail, passwordProblems, verifyPassword,
} from "../lib/auth";

test("a hash is salted, so the same password stores differently every time", () => {
  return Promise.all([hashPassword("correct horse battery"), hashPassword("correct horse battery")])
    .then(([a, b]) => {
      assert.notEqual(a, b, "two hashes of one password must not match");
      assert.match(a, /^scrypt\$16384\$8\$1\$/, "the cost is stored, so it can be raised later");
    });
});

test("the right password verifies and a near miss does not", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batterY", stored), false);
  assert.equal(await verifyPassword("correct horse batter", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("a password with no hash to check against never verifies", async () => {
  // an account created by a Strava sign-in has no password; it must not be
  // possible to sign into it by sending an empty one
  assert.equal(await verifyPassword("anything", null), false);
  assert.equal(await verifyPassword("", null), false);
});

test("a stored value we cannot parse fails closed", async () => {
  for (const bad of ["", "not-a-hash", "bcrypt$2b$10$abc", "scrypt$x$y$z$q$w"]) {
    assert.equal(await verifyPassword("anything", bad), false, bad);
  }
});

test("unicode passwords normalise, so the same keystrokes always work", async () => {
  // e + combining acute, versus the single precomposed character
  const combining = "café running club";
  const precomposed = "café running club";
  assert.notEqual(combining, precomposed, "different bytes");
  assert.equal(await verifyPassword(precomposed, await hashPassword(combining)), true);
});

test("email is one spelling, compared case-insensitively", () => {
  // two accounts holding half a training history each is the failure here
  assert.equal(normaliseEmail("  Sarah@Example.COM "), "sarah@example.com");
  // dots and plus-tags are left alone: only some providers treat them as equal
  assert.equal(normaliseEmail("a.b+run@gmail.com"), "a.b+run@gmail.com");
});

test("obvious non-addresses are refused", () => {
  for (const ok of ["a@b.co", "sarah.rodrigues@example.com"]) {
    assert.ok(looksLikeEmail(ok), ok);
  }
  for (const bad of ["", "sarah", "sarah@", "@example.com", "a b@example.com", "a@b"]) {
    assert.ok(!looksLikeEmail(bad), bad);
  }
});

test("password rules are about length, not about symbols", () => {
  // composition rules push people to "Password1!" and buy nothing
  assert.deepEqual(passwordProblems("a".repeat(MIN_PASSWORD)), []);
  assert.ok(passwordProblems("short").some((p) => /At least 10/.test(p)));
  assert.ok(passwordProblems("password123").some((p) => /most guessed/.test(p)));
});

test("a password cannot be the name or the email in front of it", () => {
  const problems = passwordProblems("sarahrodrigues", ["Sarah Rodrigues", "sarah"]);
  assert.ok(problems.some((p) => /name or email/.test(p)));
  assert.deepEqual(passwordProblems("unrelated passphrase", ["Sarah Rodrigues", "sarah"]), []);
});

test("a short context word cannot lock everyone out", () => {
  // a two-letter name appearing inside a passphrase is a coincidence, not a leak
  assert.deepEqual(passwordProblems("the quick brown fox", ["Al", "al"]), []);
});

const account = (over: Partial<Account> = {}): Account => ({
  id: "u", email: "a@b.co", display_name: "A", password_hash: null,
  failed_logins: 0, locked_until: null, ...over,
});

test("a lock expires rather than being permanent", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  assert.equal(isLocked(account(), now), false);
  assert.equal(isLocked(account({ locked_until: "2026-08-15T12:05:00Z" }), now), true);
  assert.equal(isLocked(account({ locked_until: "2026-08-15T11:55:00Z" }), now), false,
    "a past lock is not a lock");
});

test("the attempt ceiling is low enough to matter", () => {
  assert.ok(MAX_ATTEMPTS <= 10, "an eight-guess budget is not a brute-force budget");
});
