import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRecentCalendarSelection } from "../../../lib/server/reporting-range";
import {
  closeRuntimeDatabase,
  getRuntimeDatabase,
} from "../../../lib/server/runtime-database";
import { recordPageview } from "../../../lib/server/pageviews";
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
  const directory = mkdtempSync(join(tmpdir(), "lytics-report-csv-route-"));
  closeRuntimeDatabase();
  process.env.LYTICS_DATABASE_PATH = join(directory, "analytics.sqlite");
  process.env.LYTICS_TIME_ZONE = "UTC";

  try {
    await run(getRuntimeDatabase());
  } finally {
    closeRuntimeDatabase();
    restoreEnvironment();
    rmSync(directory, { force: true, recursive: true });
  }
}

function request(query = ""): Request {
  return new Request(`http://lytics.test/api/report.csv${query}`);
}

function selection(dayCount: number): { startDate: string; endDate: string } {
  return createRecentCalendarSelection({
    nowAt: new Date(),
    timeZone: "UTC",
    dayCount,
  });
}

function parseCsv(csv: string): string[][] {
  assert.equal(csv.endsWith("\n"), true);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  assert.equal(quoted, false);
  assert.deepEqual(row, []);
  assert.equal(field, "");
  return rows;
}

async function readCsv(
  response: Response,
  input: {
    view: string;
    siteId: number;
    startDate: string;
    endDate: string;
  },
): Promise<{ body: string; rows: string[][] }> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="lytics-${input.view}-site-${input.siteId}-${input.startDate}-${input.endDate}.csv"`,
  );
  const body = await response.text();
  return { body, rows: parseCsv(body) };
}

function recordFixturePageview(
  database: RuntimeDatabase,
  input: {
    siteId: number;
    visitorId: string;
    occurredAt: Date;
    path: string;
    referrer?: string;
    geography?: {
      countryCode: string | null;
      countryName: string | null;
      regionCode: string | null;
      regionName: string | null;
      cityName: string | null;
    };
    technology?: {
      browserName: string | null;
      deviceType: string | null;
      operatingSystemName: string | null;
    };
  },
): void {
  recordPageview(database, input);
}

test("exports every pages, referrers, geography, and technology ranking category", async () => {
  await withRouteDatabase(async (database) => {
    const site = registerSite(database, {
      name: "Personal",
      domain: "personal.example",
    });
    const dates = selection(7);
    const occurredAt = new Date(`${dates.endDate}T12:00:00.000Z`);
    const specialPath = "/writing,\"quoted\"\nline";
    const specialReferrer = "https://source.example/a,\"quoted\"\r\nline";
    const specialCountry = "United, \"States\"\nNorth";
    const specialRegion = "Wash,\"ington\"\r\nWest";
    const specialCity = "Seat,\"tle\"\nCity";
    const specialBrowser = "Chrom,e\nBrowser";
    const specialDevice = "smart,\"tv\"\r\ndevice";
    const specialOperatingSystem = "Quote\"OS\nSystem";

    recordFixturePageview(database, {
      siteId: site.id,
      visitorId: "special",
      occurredAt,
      path: specialPath,
      referrer: specialReferrer,
      geography: {
        countryCode: "US",
        countryName: specialCountry,
        regionCode: "WA",
        regionName: specialRegion,
        cityName: specialCity,
      },
      technology: {
        browserName: specialBrowser,
        deviceType: specialDevice,
        operatingSystemName: specialOperatingSystem,
      },
    });
    recordFixturePageview(database, {
      siteId: site.id,
      visitorId: "special",
      occurredAt: new Date(occurredAt.getTime() + 5 * 60 * 1000),
      path: "/exit",
      referrer: "https://ignored.example",
      geography: {
        countryCode: "CA",
        countryName: "Canada",
        regionCode: "BC",
        regionName: "British Columbia",
        cityName: "Vancouver",
      },
      technology: {
        browserName: "Safari",
        deviceType: "mobile",
        operatingSystemName: "iOS",
      },
    });
    recordFixturePageview(database, {
      siteId: site.id,
      visitorId: "unknown",
      occurredAt: new Date(occurredAt.getTime() + 60 * 60 * 1000),
      path: "/unknown",
    });

    const expected = { siteId: site.id, ...dates };
    const pages = await readCsv(GET(request("?view=pages")), {
      view: "pages",
      ...expected,
    });
    assert.deepEqual(pages.rows[0], ["category", "path", "sessions"]);
    assert.deepEqual(new Set(pages.rows.slice(1).map((row) => row[0])), new Set([
      "page",
      "entry_page",
      "exit_page",
    ]));
    assert.equal(
      pages.rows.some((row) => row[0] === "entry_page" && row[1] === specialPath),
      true,
    );
    assert.equal(pages.body.includes('"/writing,""quoted""\nline"'), true);

    const referrers = await readCsv(GET(request("?view=referrers")), {
      view: "referrers",
      ...expected,
    });
    assert.deepEqual(referrers.rows[0], ["referrer", "sessions"]);
    assert.equal(
      referrers.rows.some((row) => row[0] === specialReferrer && row[1] === "1"),
      true,
    );
    assert.equal(
      referrers.rows.some((row) => row[0] === "Direct" && row[1] === "1"),
      true,
    );

    const geography = await readCsv(GET(request("?view=geography")), {
      view: "geography",
      ...expected,
    });
    assert.deepEqual(geography.rows[0], [
      "category",
      "country_code",
      "country_name",
      "region_code",
      "region_name",
      "city_name",
      "visitors",
    ]);
    assert.deepEqual(
      new Set(geography.rows.slice(1).map((row) => row[0])),
      new Set(["country", "region", "city"]),
    );
    assert.equal(
      geography.rows.some((row) =>
        row[0] === "city" &&
        row[2] === specialCountry &&
        row[4] === specialRegion &&
        row[5] === specialCity
      ),
      true,
    );
    assert.equal(
      geography.rows.some((row) =>
        row[0] === "country" && row.slice(1, 6).every((cell) => cell === "")
      ),
      true,
    );

    const technology = await readCsv(GET(request("?view=technology")), {
      view: "technology",
      ...expected,
    });
    assert.deepEqual(technology.rows[0], [
      "category",
      "browser_name",
      "device_type",
      "operating_system_name",
      "visitors",
    ]);
    assert.deepEqual(
      new Set(technology.rows.slice(1).map((row) => row[0])),
      new Set(["browser", "device", "operating_system"]),
    );
    assert.equal(
      technology.rows.some((row) =>
        row[0] === "browser" && row[1] === specialBrowser && row[4] === "1"
      ),
      true,
    );
    assert.equal(
      technology.rows.some((row) =>
        row[0] === "device" && row[2] === specialDevice && row[4] === "1"
      ),
      true,
    );
    assert.equal(
      technology.rows.some((row) =>
        row[0] === "operating_system" &&
        row[3] === specialOperatingSystem &&
        row[4] === "1"
      ),
      true,
    );
    assert.equal(
      technology.rows.some((row) =>
        row[0] === "browser" && row.slice(1, 4).every((cell) => cell === "")
      ),
      true,
    );
  });
});

test("isolates the selected site and range and preserves UI query fallbacks", async () => {
  await withRouteDatabase(async (database) => {
    const firstSite = registerSite(database, {
      name: "First",
      domain: "first.example",
    });
    const secondSite = registerSite(database, {
      name: "Second",
      domain: "second.example",
    });
    const today = selection(1);
    const sevenDays = selection(7);

    for (const [siteId, visitorId, marker, date] of [
      [secondSite.id, "selected", "selected-value", today.endDate],
      [firstSite.id, "other-site", "other-site-value", today.endDate],
      [secondSite.id, "outside", "outside-value", sevenDays.startDate],
      [firstSite.id, "fallback", "fallback-value", sevenDays.startDate],
    ] as const) {
      recordFixturePageview(database, {
        siteId,
        visitorId,
        path: `/${marker}`,
        referrer: `https://${marker}.example`,
        occurredAt: new Date(`${date}T12:00:00.000Z`),
        geography: {
          countryCode: marker,
          countryName: marker,
          regionCode: marker,
          regionName: marker,
          cityName: marker,
        },
        technology: {
          browserName: marker,
          deviceType: marker,
          operatingSystemName: marker,
        },
      });
    }

    for (const view of [
      "pages",
      "referrers",
      "geography",
      "technology",
    ]) {
      const selected = await readCsv(
        GET(request(`?view=${view}&site=2&range=today`)),
        { view, siteId: secondSite.id, ...today },
      );
      const selectedBody = selected.rows.flat().join("\n");
      assert.equal(selectedBody.includes("selected-value"), true);
      assert.equal(selectedBody.includes("other-site-value"), false);
      assert.equal(selectedBody.includes("outside-value"), false);
    }

    const fallback = await readCsv(
      GET(request(
        "?view=pages&site=2&site=1&range=today&range=90d",
      )),
      { view: "pages", siteId: firstSite.id, ...sevenDays },
    );
    const fallbackBody = fallback.rows.flat().join("\n");
    assert.equal(fallbackBody.includes("fallback-value"), true);
    assert.equal(fallbackBody.includes("selected-value"), false);
  });
});

test("returns safe no-store 400 responses for absent, invalid, and repeated views", async () => {
  for (const query of [
    "",
    "?view=overview",
    "?view=pages&view=technology",
  ]) {
    const response = GET(request(query));

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(
      await response.text(),
      "view must be one of pages, referrers, geography, or technology\n",
    );
  }
});

test("returns a safe no-store 404 before requiring timezone configuration", async () => {
  await withRouteDatabase(async () => {
    delete process.env.LYTICS_TIME_ZONE;
    const response = GET(request("?view=pages"));

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "No registered site is available\n");
  });
});

test("contains configuration and database failures behind a stable 500", async () => {
  await withRouteDatabase(async (database) => {
    registerSite(database, { name: "Personal", domain: "personal.example" });
    delete process.env.LYTICS_TIME_ZONE;

    let response = GET(request("?view=technology"));
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Unable to export report CSV\n");

    process.env.LYTICS_TIME_ZONE = "UTC";
    database.close();
    response = GET(request("?view=geography"));
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "Unable to export report CSV\n");
  });
});
