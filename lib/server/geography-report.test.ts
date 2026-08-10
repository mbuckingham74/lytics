import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { Geography } from "./geolocation";
import { getGeographyReport } from "./geography-report";
import { initializePageviews, recordPageview } from "./pageviews";
import { initializeSites, registerSite } from "./sites";

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
    geography: Geography;
  },
): void {
  recordPageview(database, {
    ...input,
    path: "/",
    occurredAt: new Date(input.occurredAt),
  });
}

test("composes complete country, region, and city rankings for one range", () => {
  withDatabase(({ database, siteId, otherSiteId }) => {
    for (const [
      pageviewSiteId,
      visitorId,
      countryCode,
      countryName,
      regionCode,
      regionName,
      cityName,
      occurredAt,
    ] of [
      [siteId, "seattle-a", "US", "United States", "WA", "Washington", "Seattle", "2026-08-10T10:00:00.000Z"],
      [siteId, "seattle-a", "US", "United States of America", "WA", "Washington State", "Seattle", "2026-08-10T10:05:00.000Z"],
      [siteId, "seattle-b", "US", "United States", "WA", "Washington", "Seattle", "2026-08-10T11:00:00.000Z"],
      [siteId, "seattle-a", "US", "United States", "OR", "Oregon", "Portland", "2026-08-10T12:00:00.000Z"],
      [siteId, "unknown-city", "US", "United States", "WA", "Washington", null, "2026-08-10T13:00:00.000Z"],
      [siteId, "canada", "CA", "Canada", "BC", "British Columbia", "Vancouver", "2026-08-10T14:00:00.000Z"],
      [siteId, "unknown", null, "Mystery", null, "Mystery", null, "2026-08-10T15:00:00.000Z"],
      [siteId, "start-boundary", "GB", "United Kingdom", "ENG", "England", "London", "2026-08-10T00:00:00.000Z"],
      [siteId, "end-boundary", "FR", "France", "IDF", "Ile-de-France", "Paris", "2026-08-11T00:00:00.000Z"],
      [siteId, "before-range", "DE", "Germany", "BE", "Berlin", "Berlin", "2026-08-09T23:59:59.999Z"],
      [otherSiteId, "other-a", "US", "United States", "WA", "Washington", "Seattle", "2026-08-10T10:00:00.000Z"],
      [otherSiteId, "other-b", "US", "United States", "WA", "Washington", "Seattle", "2026-08-10T11:00:00.000Z"],
    ] as const) {
      addPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        occurredAt,
        geography: {
          countryCode,
          countryName,
          regionCode,
          regionName,
          cityName,
        },
      });
    }

    const report = getGeographyReport(database, {
      siteId,
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      timeZone: "  UTC  ",
    });

    assert.equal(report.startDate, "2026-08-10");
    assert.equal(report.endDate, "2026-08-10");
    assert.equal(report.timeZone, "UTC");
    assert.deepEqual(report.startAt, new Date("2026-08-10T00:00:00.000Z"));
    assert.deepEqual(report.endAt, new Date("2026-08-11T00:00:00.000Z"));
    assert.deepEqual(report.rankedCountries, [
      { countryCode: "US", countryName: "United States", visitors: 3 },
      { countryCode: null, countryName: null, visitors: 1 },
      { countryCode: "CA", countryName: "Canada", visitors: 1 },
      { countryCode: "GB", countryName: "United Kingdom", visitors: 1 },
    ]);
    assert.deepEqual(report.rankedRegions, [
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        visitors: 3,
      },
      {
        countryCode: null,
        countryName: null,
        regionCode: null,
        regionName: null,
        visitors: 1,
      },
      {
        countryCode: "CA",
        countryName: "Canada",
        regionCode: "BC",
        regionName: "British Columbia",
        visitors: 1,
      },
      {
        countryCode: "GB",
        countryName: "United Kingdom",
        regionCode: "ENG",
        regionName: "England",
        visitors: 1,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "OR",
        regionName: "Oregon",
        visitors: 1,
      },
    ]);
    assert.deepEqual(report.rankedCities, [
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        cityName: "Seattle",
        visitors: 2,
      },
      {
        countryCode: null,
        countryName: null,
        regionCode: null,
        regionName: null,
        cityName: null,
        visitors: 1,
      },
      {
        countryCode: "CA",
        countryName: "Canada",
        regionCode: "BC",
        regionName: "British Columbia",
        cityName: "Vancouver",
        visitors: 1,
      },
      {
        countryCode: "GB",
        countryName: "United Kingdom",
        regionCode: "ENG",
        regionName: "England",
        cityName: "London",
        visitors: 1,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "OR",
        regionName: "Oregon",
        cityName: "Portland",
        visitors: 1,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        cityName: null,
        visitors: 1,
      },
    ]);
  });
});

test("propagates established range and timezone validation errors", () => {
  withDatabase(({ database, siteId }) => {
    assert.throws(
      () =>
        getGeographyReport(database, {
          siteId,
          startDate: "2026-02-29",
          endDate: "2026-03-01",
          timeZone: "UTC",
        }),
      { message: "startDate must be a valid YYYY-MM-DD calendar date" },
    );
    assert.throws(
      () =>
        getGeographyReport(database, {
          siteId,
          startDate: "2026-03-02",
          endDate: "2026-03-01",
          timeZone: "UTC",
        }),
      { message: "startDate must not be after endDate" },
    );
    assert.throws(
      () =>
        getGeographyReport(database, {
          siteId,
          startDate: "2026-03-01",
          endDate: "2026-03-01",
          timeZone: "Not/A_Time_Zone",
        }),
      { message: "LYTICS_TIME_ZONE must be a valid IANA time zone" },
    );
  });
});
