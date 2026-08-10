import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializePageviews, recordPageview } from "./pageviews";
import { initializeSites, registerSite } from "./sites";
import { getTechnologyReport } from "./technology-report";
import type { Technology } from "./technology";

type TestContext = {
  database: DatabaseSync;
  siteId: number;
  otherSiteId: number;
};

function withDatabase(run: (context: TestContext) => void): void {
  const database = new DatabaseSync(":memory:");

  try {
    database.exec("PRAGMA foreign_keys = ON");
    initializeSites(database);
    initializePageviews(database);
    const siteId = registerSite(database, {
      name: "Personal Site",
      domain: "personal.example",
    }).id;
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    run({ database, siteId, otherSiteId });
  } finally {
    database.close();
  }
}

function addPageview(
  database: DatabaseSync,
  input: {
    siteId: number;
    visitorId: string;
    occurredAt: string;
    technology: Technology;
  },
): void {
  recordPageview(database, {
    ...input,
    path: "/",
    occurredAt: new Date(input.occurredAt),
  });
}

test("composes complete technology rankings for one canonical site and range", () => {
  withDatabase(({ database, siteId, otherSiteId }) => {
    for (const [
      pageviewSiteId,
      visitorId,
      browserName,
      deviceType,
      operatingSystemName,
      occurredAt,
    ] of [
      [siteId, "start-boundary", "Edge", "console", "FreeBSD", "2026-08-10T07:00:00.000Z"],
      [siteId, "repeat", "Chrome", "mobile", "Windows", "2026-08-10T10:00:00.000Z"],
      [siteId, "repeat", "Chrome", "mobile", "Windows", "2026-08-10T10:05:00.000Z"],
      [siteId, "shared", "Chrome", "mobile", "Windows", "2026-08-10T11:00:00.000Z"],
      [siteId, "shared", "Safari", "tablet", "macOS", "2026-08-10T12:00:00.000Z"],
      [siteId, "chrome-only", "Chrome", "desktop", "Linux", "2026-08-10T13:00:00.000Z"],
      [siteId, "safari-only", "Safari", "tablet", "macOS", "2026-08-10T14:00:00.000Z"],
      [siteId, "firefox-one", "Firefox", "desktop", "Linux", "2026-08-10T15:00:00.000Z"],
      [siteId, "firefox-two", "Firefox", "mobile", "Windows", "2026-08-10T16:00:00.000Z"],
      [siteId, "unknown-repeat", null, null, null, "2026-08-10T17:00:00.000Z"],
      [siteId, "unknown-repeat", null, null, null, "2026-08-10T17:05:00.000Z"],
      [siteId, "unknown-two", null, null, null, "2026-08-10T18:00:00.000Z"],
      [siteId, "before-range", "Brave", "wearable", "Chrome OS", "2026-08-10T06:59:59.999Z"],
      [siteId, "end-boundary", "Opera", "television", "iOS", "2026-08-11T07:00:00.000Z"],
      [otherSiteId, "other-a", "Chrome", "mobile", "Windows", "2026-08-10T10:00:00.000Z"],
      [otherSiteId, "other-b", "Chrome", "mobile", "Windows", "2026-08-10T11:00:00.000Z"],
    ] as const) {
      addPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        occurredAt,
        technology: {
          browserName,
          deviceType,
          operatingSystemName,
        },
      });
    }

    const report = getTechnologyReport(database, {
      siteId,
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      timeZone: "  US/Pacific  ",
    });

    assert.equal(report.startDate, "2026-08-10");
    assert.equal(report.endDate, "2026-08-10");
    assert.equal(report.timeZone, "America/Los_Angeles");
    assert.deepEqual(report.startAt, new Date("2026-08-10T07:00:00.000Z"));
    assert.deepEqual(report.endAt, new Date("2026-08-11T07:00:00.000Z"));
    assert.deepEqual(report.rankedBrowsers, [
      { browserName: "Chrome", visitors: 3 },
      { browserName: null, visitors: 2 },
      { browserName: "Firefox", visitors: 2 },
      { browserName: "Safari", visitors: 2 },
      { browserName: "Edge", visitors: 1 },
    ]);
    assert.deepEqual(report.rankedDeviceTypes, [
      { deviceType: "mobile", visitors: 3 },
      { deviceType: null, visitors: 2 },
      { deviceType: "desktop", visitors: 2 },
      { deviceType: "tablet", visitors: 2 },
      { deviceType: "console", visitors: 1 },
    ]);
    assert.deepEqual(report.rankedOperatingSystems, [
      { operatingSystemName: "Windows", visitors: 3 },
      { operatingSystemName: null, visitors: 2 },
      { operatingSystemName: "Linux", visitors: 2 },
      { operatingSystemName: "macOS", visitors: 2 },
      { operatingSystemName: "FreeBSD", visitors: 1 },
    ]);
  });
});

test("propagates established range and timezone validation errors", () => {
  withDatabase(({ database, siteId }) => {
    assert.throws(
      () =>
        getTechnologyReport(database, {
          siteId,
          startDate: "2026-02-29",
          endDate: "2026-03-01",
          timeZone: "UTC",
        }),
      { message: "startDate must be a valid YYYY-MM-DD calendar date" },
    );
    assert.throws(
      () =>
        getTechnologyReport(database, {
          siteId,
          startDate: "2026-03-02",
          endDate: "2026-03-01",
          timeZone: "UTC",
        }),
      { message: "startDate must not be after endDate" },
    );
    assert.throws(
      () =>
        getTechnologyReport(database, {
          siteId,
          startDate: "2026-03-01",
          endDate: "2026-03-01",
          timeZone: "Not/A_Time_Zone",
        }),
      { message: "LYTICS_TIME_ZONE must be a valid IANA time zone" },
    );
  });
});
