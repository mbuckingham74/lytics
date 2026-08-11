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
  const directory = mkdtempSync(join(tmpdir(), "lytics-overview-csv-route-"));
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
  return new Request(`http://lytics.test/api/overview.csv${query}`);
}

function calendarDates(dayCount: number): string[] {
  const selection = createRecentCalendarSelection({
    nowAt: new Date(),
    timeZone: "UTC",
    dayCount,
  });
  const cursor = new Date(`${selection.startDate}T00:00:00.000Z`);
  const dates: string[] = [];

  while (cursor.toISOString().slice(0, 10) <= selection.endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function recordOnDate(
  database: RuntimeDatabase,
  input: { siteId: number; visitorId: string; date: string },
): void {
  recordPageview(database, {
    siteId: input.siteId,
    visitorId: input.visitorId,
    path: "/not-exported",
    referrer: "https://not-exported.example",
    occurredAt: new Date(`${input.date}T12:00:00.000Z`),
  });
}

function csvLines(body: string): string[] {
  assert.equal(body.endsWith("\n"), true);
  return body.trimEnd().split("\n");
}

async function assertCsvResponse(
  response: Response,
  expected: { siteId: number; dates: string[] },
): Promise<string[]> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="lytics-site-${expected.siteId}-${expected.dates[0]}-${expected.dates.at(-1)}.csv"`,
  );

  const lines = csvLines(await response.text());
  assert.equal(lines[0], "date,unique_visitors");
  assert.deepEqual(
    lines.slice(1).map((line) => line.split(",")[0]),
    expected.dates,
  );
  return lines;
}

test("exports the default site's seven-day trend with zero filling and isolation", async () => {
  await withRouteDatabase(async (database) => {
    const firstSite = registerSite(database, {
      name: "Apex",
      domain: "example.com",
    });
    const secondSite = registerSite(database, {
      name: "WWW",
      domain: "www.example.com",
    });
    const dates = calendarDates(7);
    recordOnDate(database, {
      siteId: firstSite.id,
      visitorId: "first-visitor",
      date: dates[0],
    });
    recordOnDate(database, {
      siteId: firstSite.id,
      visitorId: "first-visitor",
      date: dates[0],
    });
    recordOnDate(database, {
      siteId: firstSite.id,
      visitorId: "last-visitor",
      date: dates.at(-1)!,
    });
    recordOnDate(database, {
      siteId: secondSite.id,
      visitorId: "isolated-one",
      date: dates[0],
    });
    recordOnDate(database, {
      siteId: secondSite.id,
      visitorId: "isolated-two",
      date: dates[0],
    });

    const lines = await assertCsvResponse(GET(request()), {
      siteId: firstSite.id,
      dates,
    });

    assert.equal(lines.length, 8);
    assert.equal(lines[1], `${dates[0]},1`);
    assert.equal(lines[2], `${dates[1]},0`);
    assert.equal(lines.at(-1), `${dates.at(-1)},1`);
    const csv = lines.join("\n");
    assert.equal(csv.includes("first-visitor"), false);
    assert.equal(csv.includes("last-visitor"), false);
    assert.equal(csv.includes("not-exported"), false);
  });
});

test("exports the exact selected second site", async () => {
  await withRouteDatabase(async (database) => {
    const firstSite = registerSite(database, {
      name: "Apex",
      domain: "example.com",
    });
    const secondSite = registerSite(database, {
      name: "WWW",
      domain: "www.example.com",
    });
    const dates = calendarDates(7);
    recordOnDate(database, {
      siteId: firstSite.id,
      visitorId: "first-only",
      date: dates[0],
    });
    recordOnDate(database, {
      siteId: secondSite.id,
      visitorId: "second-one",
      date: dates[0],
    });
    recordOnDate(database, {
      siteId: secondSite.id,
      visitorId: "second-two",
      date: dates[0],
    });

    const lines = await assertCsvResponse(GET(request("?site=2")), {
      siteId: secondSite.id,
      dates,
    });

    assert.equal(lines[1], `${dates[0]},2`);
  });
});

test("exports one row per approved preset calendar date", async () => {
  await withRouteDatabase(async (database) => {
    const site = registerSite(database, {
      name: "Personal",
      domain: "personal.example",
    });

    for (const [preset, dayCount] of [
      ["today", 1],
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
    ] as const) {
      const query = preset === "7d" ? "" : `?range=${preset}`;
      const dates = calendarDates(dayCount);
      const lines = await assertCsvResponse(GET(request(query)), {
        siteId: site.id,
        dates,
      });
      assert.equal(lines.length, dayCount + 1);
      assert.equal(lines.every((line, index) => index === 0 || /,\d+$/.test(line)), true);
    }
  });
});

test("invalid and repeated values use the first-site seven-day fallback", async () => {
  await withRouteDatabase(async (database) => {
    const firstSite = registerSite(database, {
      name: "Apex",
      domain: "example.com",
    });
    registerSite(database, { name: "WWW", domain: "www.example.com" });
    const dates = calendarDates(7);

    for (const query of [
      "?site=unknown&range=invalid",
      "?site=2&site=1&range=today&range=90d",
    ]) {
      const lines = await assertCsvResponse(GET(request(query)), {
        siteId: firstSite.id,
        dates,
      });
      assert.equal(lines.length, 8);
    }
  });
});

test("exports inclusive custom dates with zero filling and site isolation", async () => {
  await withRouteDatabase(async (database) => {
    const firstSite = registerSite(database, {
      name: "First",
      domain: "first.example",
    });
    const secondSite = registerSite(database, {
      name: "Second",
      domain: "second.example",
    });
    const dates = ["2026-08-08", "2026-08-09", "2026-08-10"];

    for (const [siteId, visitorId, occurredAt] of [
      [firstSite.id, "first-start", "2026-08-08T00:00:00.000Z"],
      [firstSite.id, "first-end", "2026-08-10T23:59:59.999Z"],
      [firstSite.id, "first-excluded", "2026-08-11T00:00:00.000Z"],
      [secondSite.id, "second-start", "2026-08-08T00:00:00.000Z"],
      [secondSite.id, "second-start-two", "2026-08-08T12:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/custom",
        occurredAt: new Date(occurredAt),
      });
    }

    const customQuery = "range=custom&start=2026-08-08&end=2026-08-10";
    const firstLines = await assertCsvResponse(
      GET(request(`?${customQuery}`)),
      { siteId: firstSite.id, dates },
    );
    const secondLines = await assertCsvResponse(
      GET(request(`?site=2&${customQuery}`)),
      { siteId: secondSite.id, dates },
    );

    assert.deepEqual(firstLines.slice(1), [
      "2026-08-08,1",
      "2026-08-09,0",
      "2026-08-10,1",
    ]);
    assert.deepEqual(secondLines.slice(1), [
      "2026-08-08,2",
      "2026-08-09,0",
      "2026-08-10,0",
    ]);
  });
});

test("uses Los Angeles custom calendar boundaries across spring-forward", async () => {
  await withRouteDatabase(async (database) => {
    process.env.LYTICS_TIME_ZONE = "America/Los_Angeles";
    const site = registerSite(database, {
      name: "DST",
      domain: "dst.example",
    });
    const dates = ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"];

    for (const [visitorId, occurredAt] of [
      ["included-start", "2026-03-07T08:00:00.000Z"],
      ["included-end", "2026-03-11T06:59:59.999Z"],
      ["excluded-next-day", "2026-03-11T07:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: site.id,
        visitorId,
        path: "/dst",
        occurredAt: new Date(occurredAt),
      });
    }

    const lines = await assertCsvResponse(
      GET(request("?range=custom&start=2026-03-07&end=2026-03-10")),
      { siteId: site.id, dates },
    );

    assert.deepEqual(lines.slice(1), [
      "2026-03-07,1",
      "2026-03-08,0",
      "2026-03-09,0",
      "2026-03-10,1",
    ]);
  });
});

test("invalid custom inputs fall back exactly and presets ignore stray dates", async () => {
  await withRouteDatabase(async (database) => {
    registerSite(database, { name: "First", domain: "first.example" });
    registerSite(database, { name: "Second", domain: "second.example" });

    const baseline = GET(request());
    const baselineDisposition = baseline.headers.get("content-disposition");
    const baselineBody = await baseline.text();

    for (const query of [
      "?range=custom",
      "?range=custom&start=2026-08-01",
      "?range=custom&start=bad&end=2026-08-10",
      "?range=custom&start=2026-02-29&end=2026-03-01",
      "?range=custom&start=2026-08-10&end=2026-08-09",
      "?range=custom&range=custom&start=2026-08-01&end=2026-08-10",
      "?range=custom&start=2026-08-01&start=2026-08-02&end=2026-08-10",
      "?range=custom&start=2026-08-01&end=2026-08-10&end=2026-08-11",
    ]) {
      const response = GET(request(query));
      assert.equal(response.headers.get("content-disposition"), baselineDisposition);
      assert.equal(await response.text(), baselineBody);
    }

    const todayBaseline = GET(request("?range=today"));
    const todayDisposition = todayBaseline.headers.get("content-disposition");
    const todayBody = await todayBaseline.text();
    const todayWithStrayDates = GET(request(
      "?range=today&start=bad&start=2026-08-01&end=2026-02-29",
    ));

    assert.equal(
      todayWithStrayDates.headers.get("content-disposition"),
      todayDisposition,
    );
    assert.equal(await todayWithStrayDates.text(), todayBody);
  });
});

test("returns a safe no-store 404 when no site is registered", async () => {
  await withRouteDatabase(async () => {
    delete process.env.LYTICS_TIME_ZONE;
    const response = GET(request());

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "No registered site is available\n");
  });
});

test("contains configuration and database failures behind a stable response", async () => {
  await withRouteDatabase(async (database) => {
    registerSite(database, { name: "Personal", domain: "personal.example" });
    delete process.env.LYTICS_TIME_ZONE;

    let response = GET(request());
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Unable to export overview CSV\n");

    process.env.LYTICS_TIME_ZONE = "UTC";
    database.close();
    response = GET(request());
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "Unable to export overview CSV\n");
  });
});
