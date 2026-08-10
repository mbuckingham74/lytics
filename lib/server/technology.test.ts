import assert from "node:assert/strict";
import test from "node:test";

import { resolveTechnology } from "./technology";

test("resolves a desktop browser, operating system, and device type", () => {
  const result = resolveTechnology(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/136.0.0.0 Safari/537.36",
  );

  assert.deepEqual(result, {
    browserName: "Chrome",
    deviceType: "desktop",
    operatingSystemName: "Windows",
  });
});

test("preserves explicit mobile and tablet device types", () => {
  assert.deepEqual(
    resolveTechnology(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 " +
        "Mobile/15E148 Safari/604.1",
    ),
    {
      browserName: "Mobile Safari",
      deviceType: "mobile",
      operatingSystemName: "iOS",
    },
  );

  assert.deepEqual(
    resolveTechnology(
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 " +
        "Mobile/15E148 Safari/604.1",
    ),
    {
      browserName: "Mobile Safari",
      deviceType: "tablet",
      operatingSystemName: "iOS",
    },
  );
});

test("returns null technology for missing, blank, and unrecognized values", () => {
  for (const userAgent of [null, "", "   ", "not-a-user-agent"]) {
    assert.deepEqual(resolveTechnology(userAgent), {
      browserName: null,
      deviceType: null,
      operatingSystemName: null,
    });
  }
});

test("trims the input without exposing raw or high-cardinality parser fields", () => {
  const result = resolveTechnology(
    "  Mozilla/5.0 (Linux; Android 14; SM-S921B) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/123.0.0.0 Mobile Safari/537.36  ",
  );

  assert.deepEqual(result, {
    browserName: "Chrome",
    deviceType: "mobile",
    operatingSystemName: "Android",
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "browserName",
    "deviceType",
    "operatingSystemName",
  ]);
  assert.equal("userAgent" in result, false);
  assert.equal("browserVersion" in result, false);
  assert.equal("operatingSystemVersion" in result, false);
  assert.equal("deviceModel" in result, false);
  assert.equal("deviceVendor" in result, false);
});
