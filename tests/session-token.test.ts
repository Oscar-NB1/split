import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SESSION_SECRET ||= "test-secret-not-used-anywhere-real";
import { REFRESH_AFTER, reissue, secondsSinceIssue, sign } from "../lib/session-token";

test("a fresh token is not refreshed", async () => {
  const age = await secondsSinceIssue(await sign("u1"));
  assert.ok(age !== null && age < REFRESH_AFTER, "nothing to do on the same day");
});

test("a token that does not verify is left alone rather than reissued", async () => {
  // the failure mode to avoid is minting a valid session from a forged one
  assert.equal(await secondsSinceIssue("not.a.token"), null);
  assert.equal(await reissue("not.a.token"), null);
  const tampered = (await sign("u1")).slice(0, -3) + "aaa";
  assert.equal(await reissue(tampered), null);
});

test("reissue keeps the same subject and moves the clock forward", async () => {
  const old = await sign("u1");
  const fresh = await reissue(old);
  assert.ok(fresh);
  const claims = JSON.parse(Buffer.from(fresh!.split(".")[1], "base64url").toString());
  assert.equal(claims.sub, "u1");
  const before = JSON.parse(Buffer.from(old.split(".")[1], "base64url").toString());
  assert.ok(claims.exp >= before.exp, "the window slides forward, never back");
});

test("a week-old token is past the refresh line", async () => {
  // the whole point: the cookie used to count down whether or not it was used
  assert.ok(REFRESH_AFTER < 60 * 60 * 24 * 180, "refresh well inside the expiry");
  assert.equal(REFRESH_AFTER, 60 * 60 * 24 * 7);
});
