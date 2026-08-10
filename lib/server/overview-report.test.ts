import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { getOverviewReport } from "./overview-report";
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
    path: string;
    referrer?: string;
    occurredAt: string;
  },
): void {
  recordPageview(database, {
    ...input,
    occurredAt: new Date(input.occurredAt),
  });
}

test("composes the complete Overview report from the approved primitives", () => {
  withDatabase(({ database, siteId, otherSiteId }) => {
    addPageview(database, {
      siteId,
      visitorId: "visitor-a",
      path: "/landing",
      referrer: "search",
      occurredAt: "2026-08-09T10:00:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-a",
      path: "/about",
      referrer: "ignored-later-referrer",
      occurredAt: "2026-08-09T10:10:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-a",
      path: "/pricing",
      referrer: "newsletter",
      occurredAt: "2026-08-09T10:40:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-b",
      path: "/landing",
      occurredAt: "2026-08-10T12:00:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-b",
      path: "/pricing",
      referrer: "ignored-later-referrer",
      occurredAt: "2026-08-10T12:04:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-c",
      path: "/landing",
      referrer: "search",
      occurredAt: "2026-08-10T12:05:00.000Z",
    });
    addPageview(database, {
      siteId: otherSiteId,
      visitorId: "other-site-visitor",
      path: "/landing",
      referrer: "search",
      occurredAt: "2026-08-10T12:03:00.000Z",
    });

    const report = getOverviewReport(database, {
      siteId,
      startDate: "2026-08-09",
      endDate: "2026-08-10",
      timeZone: "  UTC  ",
      nowAt: new Date("2026-08-10T12:05:00.000Z"),
    });

    assert.equal(report.startDate, "2026-08-09");
    assert.equal(report.endDate, "2026-08-10");
    assert.equal(report.timeZone, "UTC");
    assert.deepEqual(report.startAt, new Date("2026-08-09T00:00:00.000Z"));
    assert.deepEqual(report.endAt, new Date("2026-08-11T00:00:00.000Z"));
    assert.equal(report.pageviews, 6);
    assert.equal(report.uniqueVisitors, 3);
    assert.equal(report.sessions, 4);
    assert.equal(report.pagesPerSession, 1.5);
    assert.equal(report.bounceRate, 50);
    assert.equal(report.averageSessionDurationSeconds, 210);
    assert.equal(report.realtimeVisitors, 2);
    assert.deepEqual(report.dailyUniqueVisitorTrend, [
      { date: "2026-08-09", uniqueVisitors: 1 },
      { date: "2026-08-10", uniqueVisitors: 2 },
    ]);
    assert.deepEqual(report.sessionRankedPages, [
      { path: "/landing", sessions: 3 },
      { path: "/pricing", sessions: 2 },
      { path: "/about", sessions: 1 },
    ]);
    assert.deepEqual(report.sessionRankedReferrers, [
      { referrer: "search", sessions: 2 },
      { referrer: null, sessions: 1 },
      { referrer: "newsletter", sessions: 1 },
    ]);
  });
});

test("propagates established range, timezone, and active-time errors", () => {
  withDatabase(({ database, siteId }) => {
    assert.throws(
      () => getOverviewReport(database, {
        siteId,
        startDate: "2026-02-29",
        endDate: "2026-03-01",
        timeZone: "UTC",
        nowAt: new Date("2026-03-01T12:00:00.000Z"),
      }),
      { message: "startDate must be a valid YYYY-MM-DD calendar date" },
    );
    assert.throws(
      () => getOverviewReport(database, {
        siteId,
        startDate: "2026-03-01",
        endDate: "2026-03-01",
        timeZone: "Not/A_Time_Zone",
        nowAt: new Date("2026-03-01T12:00:00.000Z"),
      }),
      { message: "LYTICS_TIME_ZONE must be a valid IANA time zone" },
    );
    assert.throws(
      () => getOverviewReport(database, {
        siteId,
        startDate: "2026-03-01",
        endDate: "2026-03-01",
        timeZone: "UTC",
        nowAt: new Date(Number.NaN),
      }),
      { message: "Active-visitor time must be a valid date" },
    );
  });
});
