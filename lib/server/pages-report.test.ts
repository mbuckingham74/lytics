import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { getPagesReport } from "./pages-report";
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
    occurredAt: string;
  },
): void {
  recordPageview(database, {
    ...input,
    occurredAt: new Date(input.occurredAt),
  });
}

test("composes session-ranked, entry, and exit pages for the selected range", () => {
  withDatabase(({ database, siteId, otherSiteId }) => {
    addPageview(database, {
      siteId,
      visitorId: "starts-before-range",
      path: "/pre-entry",
      occurredAt: "2026-08-09T23:50:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "starts-before-range",
      path: "/inside-but-excluded",
      occurredAt: "2026-08-10T00:05:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-a",
      path: "/landing",
      occurredAt: "2026-08-10T10:00:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-a",
      path: "/pricing",
      occurredAt: "2026-08-10T10:10:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "visitor-b",
      path: "/landing",
      occurredAt: "2026-08-10T12:00:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "spans-range-end",
      path: "/late-entry",
      occurredAt: "2026-08-10T23:50:00.000Z",
    });
    addPageview(database, {
      siteId,
      visitorId: "spans-range-end",
      path: "/after-range-exit",
      occurredAt: "2026-08-11T00:05:00.000Z",
    });
    addPageview(database, {
      siteId: otherSiteId,
      visitorId: "other-site-a",
      path: "/landing",
      occurredAt: "2026-08-10T11:00:00.000Z",
    });
    addPageview(database, {
      siteId: otherSiteId,
      visitorId: "other-site-b",
      path: "/other-only",
      occurredAt: "2026-08-10T12:00:00.000Z",
    });

    const report = getPagesReport(database, {
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
    assert.deepEqual(report.sessionRankedPages, [
      { path: "/landing", sessions: 2 },
      { path: "/after-range-exit", sessions: 1 },
      { path: "/late-entry", sessions: 1 },
      { path: "/pricing", sessions: 1 },
    ]);
    assert.deepEqual(report.rankedEntryPages, [
      { path: "/landing", sessions: 2 },
      { path: "/late-entry", sessions: 1 },
    ]);
    assert.deepEqual(report.rankedExitPages, [
      { path: "/after-range-exit", sessions: 1 },
      { path: "/landing", sessions: 1 },
      { path: "/pricing", sessions: 1 },
    ]);
  });
});

test("propagates established range and timezone validation errors", () => {
  withDatabase(({ database, siteId }) => {
    assert.throws(
      () => getPagesReport(database, {
        siteId,
        startDate: "2026-02-29",
        endDate: "2026-03-01",
        timeZone: "UTC",
      }),
      { message: "startDate must be a valid YYYY-MM-DD calendar date" },
    );
    assert.throws(
      () => getPagesReport(database, {
        siteId,
        startDate: "2026-03-02",
        endDate: "2026-03-01",
        timeZone: "UTC",
      }),
      { message: "startDate must not be after endDate" },
    );
    assert.throws(
      () => getPagesReport(database, {
        siteId,
        startDate: "2026-03-01",
        endDate: "2026-03-01",
        timeZone: "Not/A_Time_Zone",
      }),
      { message: "LYTICS_TIME_ZONE must be a valid IANA time zone" },
    );
  });
});
