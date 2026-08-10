import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const trackerSource = readFileSync(
  new URL("../../public/tracker.js", import.meta.url),
  "utf8",
);

const generatedVisitorId = "123e4567-e89b-42d3-a456-426614174000";

type TrackerScenario = {
  cookie?: string;
  generatedId?: string;
  pathname?: string;
  persistWrites?: boolean;
  protocol?: "http:" | "https:";
  referrer?: string;
  scriptSrc?: string;
};

function runTracker(input: TrackerScenario = {}) {
  let cookie = input.cookie ?? "";
  let randomUuidCalls = 0;
  const cookieWrites: string[] = [];
  const requests: Array<{ url: string; options: Record<string, unknown> }> = [];
  const document = {
    currentScript: {
      src: input.scriptSrc ?? "https://analytics.example/tracker.js",
    },
    referrer: input.referrer ?? "",
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookieWrites.push(value);

      if (input.persistWrites !== false) {
        cookie = value.split(";", 1)[0];
      }
    },
  };
  const context = {
    URL,
    crypto: {
      randomUUID() {
        randomUuidCalls += 1;
        return input.generatedId ?? generatedVisitorId;
      },
    },
    document,
    fetch(url: string, options: Record<string, unknown>) {
      requests.push({ url, options });
      return Promise.resolve();
    },
    location: {
      pathname: input.pathname ?? "/writing/hello",
      protocol: input.protocol ?? "https:",
    },
  };

  Object.defineProperty(context, "localStorage", {
    get() {
      throw new Error("tracker must not access localStorage");
    },
  });

  runInNewContext(trackerSource, context);

  return {
    cookieWrites,
    randomUuidCalls,
    requests,
  };
}

test("establishes the approved HTTPS visitor cookie and sends a pageview", () => {
  const result = runTracker({
    referrer: "https://source.example/article",
  });

  assert.equal(result.randomUuidCalls, 1);
  assert.deepEqual(result.cookieWrites, [
    `lytics_visitor_id=${generatedVisitorId}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`,
  ]);
  assert.equal(result.requests.length, 1);
  assert.equal(
    result.requests[0].url,
    "https://analytics.example/api/pageviews",
  );
  const options = result.requests[0].options;
  assert.equal(options.method, "POST");
  assert.equal(options.mode, "cors");
  assert.equal(options.credentials, "omit");
  assert.equal(options.keepalive, true);
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(
    (options.headers as Record<string, string>)["Content-Type"],
    "application/json",
  );
  assert.deepEqual(
    JSON.parse(options.body as string),
    {
      visitorId: generatedVisitorId,
      path: "/writing/hello",
      referrer: "https://source.example/article",
    },
  );
});

test("reuses and renews a valid visitor cookie without localStorage", () => {
  const result = runTracker({
    cookie: `other=value; lytics_visitor_id=${generatedVisitorId}`,
    pathname: "/archive",
    protocol: "http:",
  });

  assert.equal(result.randomUuidCalls, 0);
  assert.deepEqual(result.cookieWrites, [
    `lytics_visitor_id=${generatedVisitorId}; Max-Age=31536000; Path=/; SameSite=Lax`,
  ]);
  assert.deepEqual(
    JSON.parse(result.requests[0].options.body as string),
    { visitorId: generatedVisitorId, path: "/archive" },
  );
});

test("rotates a malformed visitor cookie", () => {
  const result = runTracker({
    cookie: "lytics_visitor_id=NOT-A-LOWERCASE-UUID-V4",
    generatedId: generatedVisitorId.toUpperCase(),
  });

  assert.equal(result.randomUuidCalls, 1);
  assert.equal(
    result.cookieWrites[0],
    `lytics_visitor_id=${generatedVisitorId}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`,
  );
  assert.equal(
    JSON.parse(result.requests[0].options.body as string).visitorId,
    generatedVisitorId,
  );
});

test("skips ingestion when a valid cookie cannot be established and read back", () => {
  const result = runTracker({ persistWrites: false });

  assert.equal(result.randomUuidCalls, 1);
  assert.equal(result.cookieWrites.length, 1);
  assert.equal(result.requests.length, 0);
});
