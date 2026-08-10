import assert from "node:assert/strict";
import test from "node:test";

import { getClientIp } from "./client-ip";

test("returns a valid IPv4 X-Real-IP value", () => {
  assert.equal(
    getClientIp(new Headers({ "X-Real-IP": "203.0.113.42" })),
    "203.0.113.42",
  );
});

test("returns a valid IPv6 X-Real-IP value", () => {
  assert.equal(
    getClientIp(new Headers({ "X-Real-IP": "2001:db8:85a3::8a2e:370:7334" })),
    "2001:db8:85a3::8a2e:370:7334",
  );
});

test("uses case-insensitive header lookup and trims outer whitespace", () => {
  assert.equal(
    getClientIp(new Headers({ "x-ReAl-Ip": "  198.51.100.7\t" })),
    "198.51.100.7",
  );
});

test("returns null for missing and blank X-Real-IP values", () => {
  assert.equal(getClientIp(new Headers()), null);
  assert.equal(getClientIp(new Headers({ "X-Real-IP": "   " })), null);
});

test("returns null for malformed X-Real-IP values", () => {
  for (const value of [
    "not-an-ip",
    "256.1.1.1",
    "203.0.113.42:443",
    "[2001:db8::1]",
    "2001:db8::g",
  ]) {
    assert.equal(getClientIp(new Headers({ "X-Real-IP": value })), null);
  }
});

test("returns null for comma-separated or duplicate X-Real-IP values", () => {
  assert.equal(
    getClientIp(
      new Headers({ "X-Real-IP": "203.0.113.42, 198.51.100.7" }),
    ),
    null,
  );

  const duplicateHeaders = new Headers();
  duplicateHeaders.append("X-Real-IP", "203.0.113.42");
  duplicateHeaders.append("X-Real-IP", "198.51.100.7");
  assert.equal(getClientIp(duplicateHeaders), null);
});

test("never uses alternative forwarding headers", () => {
  const alternativeHeaders = new Headers({
    Forwarded: "for=203.0.113.42",
    "X-Forwarded-For": "203.0.113.42",
    "CF-Connecting-IP": "203.0.113.42",
    "True-Client-IP": "203.0.113.42",
  });
  assert.equal(getClientIp(alternativeHeaders), null);

  alternativeHeaders.set("X-Real-IP", "invalid");
  assert.equal(getClientIp(alternativeHeaders), null);
});
