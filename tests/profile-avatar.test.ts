import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarFrom, AVATAR_MAX } from "../lib/avatar";

const png = (bytes: number) => `data:image/png;base64,${"A".repeat(bytes)}`;

test("a chosen photo is only ever a data URI of an image", () => {
  assert.equal(avatarFrom(png(100)), png(100));
  assert.equal(avatarFrom("data:image/jpeg;base64,AAAA"), "data:image/jpeg;base64,AAAA");
  assert.equal(avatarFrom("data:image/webp;base64,AAAA"), "data:image/webp;base64,AAAA");
});

test("anything that is not an image is refused rather than stored", () => {
  // A data URI is the only local form accepted: an SVG carries script, and a
  // text/html one would be served back to a browser as whatever it says it is.
  assert.equal(avatarFrom("data:image/svg+xml;base64,AAAA"), "not_an_image");
  assert.equal(avatarFrom("data:text/html;base64,AAAA"), "not_an_image");
  assert.equal(avatarFrom("javascript:alert(1)"), "not_an_image");
  assert.equal(avatarFrom("http://example.com/a.png"), "not_an_image",
    "http, not https");
  assert.equal(avatarFrom(42), "not_an_image");
});

test("the provider's own URL still passes, because that is where ours come from", () => {
  const url = "https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/large.jpg";
  assert.equal(avatarFrom(url), url);
});

test("size is capped, because this row is read by every query about a user", () => {
  assert.equal(avatarFrom(png(AVATAR_MAX + 1)), "too_big");
  assert.notEqual(avatarFrom(png(1000)), "too_big");
});

test("absent leaves the photo alone; null clears it", () => {
  // The rest of the form has to be savable without touching the picture, and
  // removing it has to be possible — those are different requests.
  assert.equal(avatarFrom(undefined), "unchanged");
  assert.equal(avatarFrom(null), null);
  assert.equal(avatarFrom(""), null);
});
