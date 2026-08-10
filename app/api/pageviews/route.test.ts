import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resetGeolocationReaderForTests } from "../../../lib/server/geolocation";
import { closeRuntimeDatabase, getRuntimeDatabase } from "../../../lib/server/runtime-database";
import { registerSite } from "../../../lib/server/sites";
import { OPTIONS, POST } from "./route";

const registeredOrigin = "https://personal.example";
const originalDatabasePath = process.env.LYTICS_DATABASE_PATH;
const originalGeolocationPath = process.env.LYTICS_GEOLITE2_CITY_PATH;
const cityFixturePath = join(
  process.cwd(),
  "lib/server/fixtures/GeoIP2-City-Test.mmdb",
);

function restoreDatabasePath(): void {
  if (originalDatabasePath === undefined) {
    delete process.env.LYTICS_DATABASE_PATH;
  } else {
    process.env.LYTICS_DATABASE_PATH = originalDatabasePath;
  }
}

function restoreGeolocationPath(): void {
  if (originalGeolocationPath === undefined) {
    delete process.env.LYTICS_GEOLITE2_CITY_PATH;
  } else {
    process.env.LYTICS_GEOLITE2_CITY_PATH = originalGeolocationPath;
  }
}

async function withRouteDatabase(
  run: (database: ReturnType<typeof getRuntimeDatabase>, filePath: string) =>
    | void
    | Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "lytics-pageview-route-"));
  const filePath = join(directory, "analytics.sqlite");
  closeRuntimeDatabase();
  resetGeolocationReaderForTests();
  process.env.LYTICS_DATABASE_PATH = filePath;
  process.env.LYTICS_GEOLITE2_CITY_PATH = cityFixturePath;

  try {
    const database = getRuntimeDatabase();
    await run(database, filePath);
  } finally {
    closeRuntimeDatabase();
    resetGeolocationReaderForTests();
    restoreDatabasePath();
    restoreGeolocationPath();
    rmSync(directory, { force: true, recursive: true });
  }
}

function registerPersonalSite(
  database: ReturnType<typeof getRuntimeDatabase>,
): number {
  return registerSite(database, {
    name: "Personal Site",
    domain: "personal.example",
  }).id;
}

function pageviewCount(database: ReturnType<typeof getRuntimeDatabase>): number {
  return database.prepare("SELECT count(*) AS count FROM pageviews").get()
    ?.count as number;
}

function postRequest(input: {
  body?: BodyInit | null;
  contentType?: string | null;
  clientIp?: string | null;
  headers?: HeadersInit;
  origin?: string;
  url?: string;
} = {}): Request {
  const headers = new Headers(input.headers);
  const clientIp = input.clientIp === undefined
    ? "81.2.69.142"
    : input.clientIp;

  if (clientIp !== null) {
    headers.set("X-Real-IP", clientIp);
  }

  if (input.origin !== undefined) {
    headers.set("Origin", input.origin);
  }

  if (input.contentType !== null && input.contentType !== undefined) {
    headers.set("Content-Type", input.contentType);
  }

  return new Request(input.url ?? "http://lytics.test/api/pageviews", {
    method: "POST",
    headers,
    body: input.body,
  });
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function assertCors(response: Response, origin: string): void {
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "POST, OPTIONS",
  );
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "Content-Type",
  );
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
}

function assertUnresolvedCors(response: Response): void {
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-methods"), null);
  assert.equal(response.headers.get("access-control-allow-headers"), null);
}

async function assertJsonError(
  response: Response,
  status: number,
  message: string,
): Promise<void> {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: message });
}

test("registered-origin preflight returns CORS headers without recording", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);
    delete process.env.LYTICS_GEOLITE2_CITY_PATH;

    const response = OPTIONS(
      new Request("http://lytics.test/api/pageviews", {
        method: "OPTIONS",
        headers: { Origin: registeredOrigin },
      }),
    );

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assertCors(response, registeredOrigin);
    assert.equal(pageviewCount(database), 0);
  });
});

test("POST resolves the Origin hostname and persists normalized data at receipt time", async () => {
  await withRouteDatabase(async (database) => {
    const siteId = registerPersonalSite(database);
    const origin = "https://PERSONAL.EXAMPLE:8443";
    const before = Date.now();

    const response = await POST(
      postRequest({
        origin,
        contentType: "application/json; charset=utf-8",
        body: jsonBody({
          visitorId: "  opaque visitor value  ",
          path: "  /writing/hello  ",
          referrer: "  https://source.example/article  ",
        }),
      }),
    );
    const after = Date.now();

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assertCors(response, origin);

    const row = database
      .prepare(`
        SELECT
          site_id,
          visitor_id,
          path,
          referrer,
          occurred_at,
          country_code,
          country_name,
          region_code,
          region_name,
          city_name
        FROM pageviews
      `)
      .get();
    assert.deepEqual(
      {
        siteId: row?.site_id,
        visitorId: row?.visitor_id,
        path: row?.path,
        referrer: row?.referrer,
        geography: {
          countryCode: row?.country_code,
          countryName: row?.country_name,
          regionCode: row?.region_code,
          regionName: row?.region_name,
          cityName: row?.city_name,
        },
      },
      {
        siteId,
        visitorId: "opaque visitor value",
        path: "/writing/hello",
        referrer: "https://source.example/article",
        geography: {
          countryCode: "GB",
          countryName: "United Kingdom",
          regionCode: "ENG",
          regionName: "England",
          cityName: "London",
        },
      },
    );
    assert.ok((row?.occurred_at as number) >= before);
    assert.ok((row?.occurred_at as number) <= after);
    assert.equal(JSON.stringify(row).includes("81.2.69.142"), false);
  });
});

test("persists all-null geography for private and unmapped client IPs", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);

    for (const [index, clientIp] of ["192.168.1.10", "1.1.1.1"].entries()) {
      const response = await POST(
        postRequest({
          origin: registeredOrigin,
          contentType: "application/json",
          clientIp,
          body: jsonBody({ visitorId: `visitor-${index}`, path: "/" }),
        }),
      );

      assert.equal(response.status, 204);
      assertCors(response, registeredOrigin);
    }

    assert.deepEqual(
      database
        .prepare(`
          SELECT
            country_code,
            country_name,
            region_code,
            region_name,
            city_name
          FROM pageviews
          ORDER BY id ASC
        `)
        .all()
        .map((row) => ({ ...row })),
      [
        {
          country_code: null,
          country_name: null,
          region_code: null,
          region_name: null,
          city_name: null,
        },
        {
          country_code: null,
          country_name: null,
          region_code: null,
          region_name: null,
          city_name: null,
        },
      ],
    );
  });
});

test("rejects missing, malformed, and ambiguous client IPs", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);

    for (const clientIp of [null, "not-an-ip", "203.0.113.4, 198.51.100.2"]) {
      const response = await POST(
        postRequest({
          origin: registeredOrigin,
          contentType: "application/json",
          clientIp,
          body: jsonBody({ visitorId: "visitor", path: "/" }),
        }),
      );

      await assertJsonError(response, 400, "Invalid client IP");
      assertCors(response, registeredOrigin);
    }

    assert.equal(pageviewCount(database), 0);
  });
});

test("never substitutes alternative forwarding headers for X-Real-IP", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);

    const response = await POST(
      postRequest({
        origin: registeredOrigin,
        contentType: "application/json",
        clientIp: null,
        headers: {
          Forwarded: "for=81.2.69.142",
          "X-Forwarded-For": "81.2.69.142",
          "CF-Connecting-IP": "81.2.69.142",
        },
        body: jsonBody({ visitorId: "visitor", path: "/" }),
      }),
    );

    await assertJsonError(response, 400, "Invalid client IP");
    assertCors(response, registeredOrigin);
    assert.equal(pageviewCount(database), 0);
  });
});

test("POST preserves blank-referrer normalization", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);

    const response = await POST(
      postRequest({
        origin: registeredOrigin,
        contentType: "application/json",
        body: jsonBody({ visitorId: "visitor", path: "/", referrer: "   " }),
      }),
    );

    assert.equal(response.status, 204);
    assert.equal(
      database.prepare("SELECT referrer FROM pageviews").get()?.referrer,
      null,
    );
  });
});

test("rejects missing and malformed Origins before site resolution", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);
    const invalidOrigins: Array<string | undefined> = [
      undefined,
      "",
      "null",
      "not-an-origin",
      "ftp://personal.example",
      "file://personal.example",
      "data:text/plain,opaque",
      "https://",
      "https://:443",
      "https://user@personal.example",
      "https://user:password@personal.example",
      "https://personal.example/",
      "https://personal.example/path",
      "https://personal.example?query=true",
      "https://personal.example#fragment",
      "https://personal.example, https://other.example",
      "https://personal.example:",
      "https://personal.example:08443",
      "https://0x7f000001",
    ];

    for (const origin of invalidOrigins) {
      const response = await POST(
        postRequest({
          origin,
          contentType: "application/json",
          body: jsonBody({ visitorId: "visitor", path: "/" }),
        }),
      );

      await assertJsonError(response, 400, "Invalid Origin");
      assertUnresolvedCors(response);
    }

    assert.equal(pageviewCount(database), 0);
  });
});

test("rejects unregistered and distinct apex or www Origins", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);

    for (const origin of [
      "https://unregistered.example",
      "https://www.personal.example",
    ]) {
      const response = await POST(
        postRequest({
          origin,
          contentType: "application/json",
          body: jsonBody({ visitorId: "visitor", path: "/" }),
        }),
      );

      await assertJsonError(response, 403, "Origin is not registered");
      assertUnresolvedCors(response);
    }

    assert.equal(pageviewCount(database), 0);
  });
});

test("registered Origins receive CORS content-type errors", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);

    for (const contentType of [null, "text/plain", "application/xml"]) {
      const response = await POST(
        postRequest({
          origin: registeredOrigin,
          contentType,
          body: contentType === null ? undefined : "{}",
        }),
      );

      await assertJsonError(
        response,
        415,
        "Content-Type must be application/json",
      );
      assertCors(response, registeredOrigin);
    }

    assert.equal(pageviewCount(database), 0);
  });
});

test("rejects malformed, non-object, incomplete, unknown, and mistyped JSON bodies", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);
    const bodies = [
      "{",
      jsonBody(null),
      jsonBody([]),
      jsonBody("text"),
      jsonBody(1),
      jsonBody({}),
      jsonBody({ visitorId: "visitor" }),
      jsonBody({ path: "/" }),
      jsonBody({ visitorId: "visitor", path: "/", unknown: true }),
      jsonBody({ visitorId: 42, path: "/" }),
      jsonBody({ visitorId: "visitor", path: 42 }),
      jsonBody({ visitorId: "   ", path: "/" }),
      jsonBody({ visitorId: "visitor", path: "   " }),
      jsonBody({ visitorId: "visitor", path: "/", referrer: null }),
      jsonBody({ visitorId: "visitor", path: "/", referrer: 42 }),
    ];

    for (const body of bodies) {
      const response = await POST(
        postRequest({
          origin: registeredOrigin,
          contentType: "application/json",
          body,
        }),
      );

      await assertJsonError(response, 400, "Invalid request body");
      assertCors(response, registeredOrigin);
    }

    assert.equal(pageviewCount(database), 0);
  });
});

test("rejects body and query attempts to select a site or timestamp", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);
    const selectorBodies = [
      { visitorId: "visitor", path: "/", domain: "other.example" },
      { visitorId: "visitor", path: "/", siteId: 999 },
      { visitorId: "visitor", path: "/", trackingKey: "secret" },
      { visitorId: "visitor", path: "/", occurredAt: "2000-01-01" },
    ];

    for (const body of selectorBodies) {
      const response = await POST(
        postRequest({
          origin: registeredOrigin,
          contentType: "application/json",
          body: jsonBody(body),
        }),
      );

      await assertJsonError(response, 400, "Invalid request body");
      assertCors(response, registeredOrigin);
    }

    for (const query of [
      "domain=other.example",
      "siteId=999",
      "trackingKey=secret",
      "occurredAt=2000-01-01",
    ]) {
      const response = await POST(
        postRequest({
          origin: registeredOrigin,
          contentType: "application/json",
          body: jsonBody({ visitorId: "visitor", path: "/" }),
          url: `http://lytics.test/api/pageviews?${query}`,
        }),
      );

      await assertJsonError(response, 400, "Invalid request body");
      assertCors(response, registeredOrigin);
    }

    assert.equal(pageviewCount(database), 0);
  });
});

test("geography failures return only the generic error without recording", async () => {
  await withRouteDatabase(async (database, filePath) => {
    registerPersonalSite(database);

    for (const geolocationPath of [undefined, filePath]) {
      resetGeolocationReaderForTests();

      if (geolocationPath === undefined) {
        delete process.env.LYTICS_GEOLITE2_CITY_PATH;
      } else {
        process.env.LYTICS_GEOLITE2_CITY_PATH = geolocationPath;
      }

      const response = await POST(
        postRequest({
          origin: registeredOrigin,
          contentType: "application/json",
          body: jsonBody({ visitorId: "visitor", path: "/" }),
        }),
      );
      const responseText = await response.text();

      assert.equal(response.status, 500);
      assert.equal(responseText, '{"error":"Unable to record pageview"}');
      assert.equal(responseText.includes("81.2.69.142"), false);
      assert.equal(responseText.includes(filePath), false);
      assert.equal(responseText.includes("LYTICS_GEOLITE2_CITY_PATH"), false);
      assertCors(response, registeredOrigin);
      assert.equal(pageviewCount(database), 0);
    }
  });
});

test("unexpected persistence failures return only the generic safe error", async () => {
  await withRouteDatabase(async (database, filePath) => {
    registerPersonalSite(database);
    database.exec(`
      CREATE TRIGGER reject_pageview
      BEFORE INSERT ON pageviews
      BEGIN
        SELECT RAISE(ABORT, 'secret internal persistence detail');
      END
    `);

    const response = await POST(
      postRequest({
        origin: registeredOrigin,
        contentType: "application/json",
        body: jsonBody({ visitorId: "visitor", path: "/" }),
      }),
    );
    const responseText = await response.text();

    assert.equal(response.status, 500);
    assert.equal(responseText, '{"error":"Unable to record pageview"}');
    assert.equal(responseText.includes("secret internal"), false);
    assert.equal(responseText.includes(filePath), false);
    assertCors(response, registeredOrigin);
    assert.equal(pageviewCount(database), 0);
  });
});

test("runtime failures before registration resolution return generic non-CORS errors", async () => {
  await withRouteDatabase(async (database) => {
    registerPersonalSite(database);
    closeRuntimeDatabase();
    delete process.env.LYTICS_DATABASE_PATH;

    const response = await POST(
      postRequest({
        origin: registeredOrigin,
        contentType: "application/json",
        body: jsonBody({ visitorId: "visitor", path: "/" }),
      }),
    );

    await assertJsonError(response, 500, "Unable to record pageview");
    assertUnresolvedCors(response);
  });
});
