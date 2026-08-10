import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordPageview } from "../../../lib/server/pageviews";
import {
  closeRuntimeDatabase,
  getRuntimeDatabase,
} from "../../../lib/server/runtime-database";
import { registerSite } from "../../../lib/server/sites";
import { GET } from "./route";

const originalDatabasePath = process.env.LYTICS_DATABASE_PATH;
const originalTimeZone = process.env.LYTICS_TIME_ZONE;

type RuntimeDatabase = ReturnType<typeof getRuntimeDatabase>;

function restoreEnvironment(): void {
  if (originalDatabasePath === undefined) {
    delete process.env.LYTICS_DATABASE_PATH;
  } else {
    process.env.LYTICS_DATABASE_PATH = originalDatabasePath;
  }

  if (originalTimeZone === undefined) {
    delete process.env.LYTICS_TIME_ZONE;
  } else {
    process.env.LYTICS_TIME_ZONE = originalTimeZone;
  }
}

async function withRouteDatabase(
  run: (database: RuntimeDatabase) => void | Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "lytics-realtime-route-"));
  closeRuntimeDatabase();
  process.env.LYTICS_DATABASE_PATH = join(directory, "analytics.sqlite");
  delete process.env.LYTICS_TIME_ZONE;

  try {
    await run(getRuntimeDatabase());
  } finally {
    closeRuntimeDatabase();
    restoreEnvironment();
    rmSync(directory, { force: true, recursive: true });
  }
}

function request(query = ""): Request {
  return new Request(`http://lytics.test/api/realtime${query}`);
}

function recordAt(
  database: RuntimeDatabase,
  input: {
    siteId: number;
    visitorId: string;
    occurredAt: Date;
  },
): void {
  recordPageview(database, {
    ...input,
    path: "/realtime-test",
  });
}

function withFixedNow<T>(nowAt: Date, run: () => T): T {
  const NativeDate = Date;
  const now = nowAt.getTime();

  class FixedDate extends NativeDate {
    constructor(value?: string | number) {
      super(value ?? now);
    }

    static now(): number {
      return now;
    }
  }

  globalThis.Date = FixedDate as DateConstructor;

  try {
    return run();
  } finally {
    globalThis.Date = NativeDate;
  }
}

async function assertJsonResponse(
  response: Response,
  expected: { status: number; body: unknown },
): Promise<void> {
  assert.equal(response.status, expected.status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), expected.body);
}

test("counts exact inclusive five-minute boundaries for only the selected site", async () => {
  await withRouteDatabase(async (database) => {
    const firstSite = registerSite(database, {
      name: "Apex",
      domain: "example.com",
    });
    const secondSite = registerSite(database, {
      name: "WWW",
      domain: "www.example.com",
    });
    const nowAt = new Date("2026-08-10T20:00:00.000Z");
    const fiveMinutes = 5 * 60 * 1000;

    recordAt(database, {
      siteId: firstSite.id,
      visitorId: "at-start",
      occurredAt: new Date(nowAt.getTime() - fiveMinutes),
    });
    recordAt(database, {
      siteId: firstSite.id,
      visitorId: "at-end",
      occurredAt: nowAt,
    });
    recordAt(database, {
      siteId: firstSite.id,
      visitorId: "before-window",
      occurredAt: new Date(nowAt.getTime() - fiveMinutes - 1),
    });
    recordAt(database, {
      siteId: firstSite.id,
      visitorId: "after-window",
      occurredAt: new Date(nowAt.getTime() + 1),
    });
    recordAt(database, {
      siteId: secondSite.id,
      visitorId: "other-site",
      occurredAt: nowAt,
    });

    const firstResponse = withFixedNow(nowAt, () => GET(request()));
    const secondResponse = withFixedNow(nowAt, () => GET(request("?site=2")));

    await assertJsonResponse(firstResponse, {
      status: 200,
      body: { visitors: 2 },
    });
    await assertJsonResponse(secondResponse, {
      status: 200,
      body: { visitors: 1 },
    });
  });
});

test("invalid and repeated site values fall back to the first site", async () => {
  await withRouteDatabase(async (database) => {
    const firstSite = registerSite(database, {
      name: "Apex",
      domain: "example.com",
    });
    const secondSite = registerSite(database, {
      name: "WWW",
      domain: "www.example.com",
    });
    const nowAt = new Date("2026-08-10T20:00:00.000Z");

    recordAt(database, {
      siteId: firstSite.id,
      visitorId: "first-site",
      occurredAt: nowAt,
    });
    recordAt(database, {
      siteId: secondSite.id,
      visitorId: "second-one",
      occurredAt: nowAt,
    });
    recordAt(database, {
      siteId: secondSite.id,
      visitorId: "second-two",
      occurredAt: nowAt,
    });

    for (const query of [
      "?site=malformed",
      "?site=0",
      `?site=${Number.MAX_SAFE_INTEGER + 1}`,
      "?site=999",
      "?site=2&site=1",
    ]) {
      const response = withFixedNow(nowAt, () => GET(request(query)));
      await assertJsonResponse(response, {
        status: 200,
        body: { visitors: 1 },
      });
    }
  });
});

test("does not require the reporting timezone", async () => {
  await withRouteDatabase(async (database) => {
    const site = registerSite(database, {
      name: "Personal",
      domain: "personal.example",
    });
    const nowAt = new Date("2026-08-10T20:00:00.000Z");
    recordAt(database, {
      siteId: site.id,
      visitorId: "active",
      occurredAt: nowAt,
    });

    assert.equal(process.env.LYTICS_TIME_ZONE, undefined);
    await assertJsonResponse(withFixedNow(nowAt, () => GET(request())), {
      status: 200,
      body: { visitors: 1 },
    });
  });
});

test("returns a safe no-store 404 when no site is registered", async () => {
  await withRouteDatabase(async () => {
    await assertJsonResponse(GET(request()), {
      status: 404,
      body: { error: "No registered site is available" },
    });
  });
});

test("contains database failures behind a stable no-store response", async () => {
  await withRouteDatabase(async (database) => {
    registerSite(database, { name: "Personal", domain: "personal.example" });
    database.close();

    await assertJsonResponse(GET(request()), {
      status: 500,
      body: { error: "Unable to load realtime visitors" },
    });
  });
});
