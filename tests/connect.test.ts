import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunnable } from "../lib/session-kinds";
import {
  CODE_ALPHABET, CODE_LEN, INVITE_TTL_DAYS, actionFor, canRedeem, codeFrom,
  expiresAt, normaliseCode, pairOf, since, type Invite,
} from "../lib/connect";

const bytes = (...n: number[]) => new Uint8Array(n);
const invite = (over: Partial<Invite> = {}): Invite => ({
  code: "7K2M-P4XQ", inviter_id: "her",
  expires_at: "2026-08-20T00:00:00Z", used_at: null, ...over,
});
const NOW = new Date("2026-08-16T12:00:00Z");

test("a code is two groups of four, from the unambiguous alphabet", () => {
  const code = codeFrom(bytes(0, 1, 2, 3, 4, 5, 6, 7));
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  for (const c of code.replace("-", "")) {
    assert.ok(CODE_ALPHABET.includes(c), `${c} is in the alphabet`);
  }
  // No character a reader could confuse for another: a code is read off one
  // screen and typed into a different one.
  for (const c of "O0I1") assert.ok(!CODE_ALPHABET.includes(c), `${c} is out`);
});

test("too few bytes is an error rather than a short code", () => {
  assert.throws(() => codeFrom(bytes(1, 2, 3)), /need 8 bytes/);
  assert.equal(codeFrom(bytes(...Array(8).fill(0))).replace("-", "").length, CODE_LEN);
});

test("a code typed by hand is read the way it was meant", () => {
  for (const typed of ["7k2m-p4xq", "7K2MP4XQ", " 7K2M P4XQ ", "7K2M–P4XQ", '"7K2M-P4XQ"']) {
    assert.equal(normaliseCode(typed), "7K2M-P4XQ", typed);
  }
});

test("a mis-read character is refused rather than guessed", () => {
  // O for 0 and I for 1 are the classic confusions, and the alphabet contains
  // neither — so a code with one in it was read wrong, and which character was
  // meant is not knowable. Guessing would connect them to the wrong person.
  assert.equal(normaliseCode("7K2M-P4XO"), null);
  assert.equal(normaliseCode("7K2M-P4XI"), null);
  // But every character the generator can emit survives being typed back in —
  // rejecting one of its own codes is the failure nobody would be able to see.
  for (const c of CODE_ALPHABET) {
    const code = `7K2M-P4X${c}`;
    assert.equal(normaliseCode(code), code, code);
  }
  assert.equal(normaliseCode("7K2M"), null);
  assert.equal(normaliseCode(""), null);
});

test("the pair is ordered, so one connection cannot be stored twice", () => {
  assert.deepEqual(pairOf("a", "b"), pairOf("b", "a"));
  assert.deepEqual(pairOf("b", "a"), { low: "a", high: "b" });
});

test("an invite lasts a week", () => {
  const out = expiresAt(NOW);
  assert.equal((out.getTime() - NOW.getTime()) / 86_400_000, INVITE_TTL_DAYS);
});

test("what stops a code being redeemed", () => {
  const cases: [string, ReturnType<typeof canRedeem>][] = [
    ["unknown", canRedeem(null, "me", null, NOW)],
    ["own", canRedeem(invite({ inviter_id: "me" }), "me", null, NOW)],
    ["used", canRedeem(invite({ used_at: "2026-08-15T00:00:00Z" }), "me", null, NOW)],
    ["expired", canRedeem(invite({ expires_at: "2026-08-16T11:00:00Z" }), "me", null, NOW)],
  ];
  for (const [why, got] of cases) {
    assert.equal(got.ok, false, why);
    assert.equal(got.ok === false && got.why, why);
  }
  assert.deepEqual(canRedeem(invite(), "me", null, NOW), { ok: true });
});

test("an existing connection decides as much as the invite does", () => {
  const on = (status: string, requester_id: string) =>
    canRedeem(invite(), "me", { status, requester_id }, NOW);

  assert.equal(on("accepted", "me").ok, false, "already connected");
  assert.equal(on("pending", "her").ok, false, "an answer is already owed");
  // Declined is not re-sendable by the one who was declined, or "no" is only a
  // delay. The other direction stands: holding their code proves they asked.
  assert.equal(on("declined", "me").ok, false);
  assert.equal(on("declined", "her").ok, true);
  // Disconnected is not a refusal — the design keeps the weeks won for exactly
  // this case.
  assert.equal(on("disconnected", "me").ok, true);
});

test("only the side that can act on a connection is offered the action", () => {
  const c = { requester_id: "her", addressee_id: "me" };
  assert.equal(actionFor({ ...c, status: "pending" }, "me"), "accept");
  assert.equal(actionFor({ ...c, status: "pending" }, "her"), "cancel");
  assert.equal(actionFor({ ...c, status: "accepted" }, "me"), "disconnect");
  assert.equal(actionFor({ ...c, status: "accepted" }, "her"), "disconnect");
  assert.equal(actionFor({ ...c, status: "declined" }, "me"), null);
  assert.equal(actionFor({ ...c, status: "pending" }, "someone"), null,
    "a stranger can do nothing");
});

test("how long ago reads as a person would say it", () => {
  const ago = (days: number) =>
    since(new Date(NOW.getTime() - days * 86_400_000).toISOString(), NOW);
  assert.equal(ago(0), "today");
  assert.equal(ago(1), "yesterday");
  assert.equal(ago(3), "3 days ago");
  assert.equal(ago(8), "a week ago");
  assert.equal(ago(21), "3 weeks ago");
});

test("the sessions a watch can take", () => {
  /*
   * This guard was `kind.startsWith("run")`, which was true when the kinds were `run_easy`,
   * `run_long` and `run_intervals`. They are `easy_run`, `long_run` and `quality_run` now — the
   * word moved to the end — so it had been false for every session in the app since the rename.
   * The button answered "only structured runs can be sent to the watch" for all of them and the
   * hourly cron pushed nothing. Nothing failed; it quietly did no work, which is why it survived.
   */
  for (const k of ["easy_run", "long_run", "quality_run", "benchmark"]) {
    assert.equal(isRunnable(k), true, k);
  }
  /* The old names are still in old plans. */
  for (const k of ["run_easy", "run_long", "run_intervals"]) {
    assert.equal(isRunnable(k), true, k);
  }
  /* And a class, a lift, a commitment and the race are not structured runs. */
  for (const k of ["hyrox", "easy_hyrox", "strength", "kickboxing", "race"]) {
    assert.equal(isRunnable(k), false, k);
  }
});
