import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializePageviews, recordPageview } from "./pageviews";
import { initializeSites, registerSite } from "./sites";
import { getDailyUniqueVisitorTrend } from "./visitor-trend";

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

function insertPageview(
  database: DatabaseSync,
  input: { siteId: number; visitorId: string; occurredAt: string },
): void {
  recordPageview(database, {
    siteId: input.siteId,
    visitorId: input.visitorId,
    path: "/",
    occurredAt: new Date(input.occurredAt),
  });
}

test("returns every UTC day with per-day distinct visitors and exact boundaries", () => {
  withDatabase(({ database, siteId, otherSiteId }) => {
    insertPageview(database, {
      siteId,
      visitorId: "repeated",
      occurredAt: "2026-08-09T00:00:00.000Z",
    });
    insertPageview(database, {
      siteId,
      visitorId: "repeated",
      occurredAt: "2026-08-09T12:00:00.000Z",
    });
    insertPageview(database, {
      siteId,
      visitorId: "repeated",
      occurredAt: "2026-08-10T00:00:00.000Z",
    });
    insertPageview(database, {
      siteId,
      visitorId: "second",
      occurredAt: "2026-08-10T23:59:59.999Z",
    });
    insertPageview(database, {
      siteId: otherSiteId,
      visitorId: "other-site",
      occurredAt: "2026-08-10T12:00:00.000Z",
    });
    insertPageview(database, {
      siteId,
      visitorId: "final-boundary",
      occurredAt: "2026-08-12T00:00:00.000Z",
    });

    assert.deepEqual(
      getDailyUniqueVisitorTrend(database, {
        siteId,
        startDate: "2026-08-09",
        endDate: "2026-08-11",
        timeZone: "UTC",
      }),
      [
        { date: "2026-08-09", uniqueVisitors: 1 },
        { date: "2026-08-10", uniqueVisitors: 2 },
        { date: "2026-08-11", uniqueVisitors: 0 },
      ],
    );
  });
});

test("uses Los Angeles local-day boundaries across spring-forward", () => {
  withDatabase(({ database, siteId }) => {
    insertPageview(database, {
      siteId,
      visitorId: "day-eight-start",
      occurredAt: "2026-03-08T08:00:00.000Z",
    });
    insertPageview(database, {
      siteId,
      visitorId: "day-eight-end",
      occurredAt: "2026-03-09T06:59:59.999Z",
    });
    insertPageview(database, {
      siteId,
      visitorId: "day-nine-start",
      occurredAt: "2026-03-09T07:00:00.000Z",
    });

    assert.deepEqual(
      getDailyUniqueVisitorTrend(database, {
        siteId,
        startDate: "2026-03-08",
        endDate: "2026-03-09",
        timeZone: "America/Los_Angeles",
      }),
      [
        { date: "2026-03-08", uniqueVisitors: 2 },
        { date: "2026-03-09", uniqueVisitors: 1 },
      ],
    );
  });
});

test("executes one parameterized aggregation statement for the series", () => {
  withDatabase(({ database, siteId }) => {
    const originalPrepare = database.prepare.bind(database);
    let prepareCount = 0;
    let preparedSql = "";

    database.prepare = ((sql: string) => {
      prepareCount += 1;
      preparedSql = sql;
      return originalPrepare(sql);
    }) as DatabaseSync["prepare"];

    const trend = getDailyUniqueVisitorTrend(database, {
      siteId,
      startDate: "2026-08-09",
      endDate: "2026-08-11",
      timeZone: "UTC",
    });

    assert.equal(prepareCount, 1);
    assert.match(preparedSql, /json_each\(\?\)/);
    assert.match(preparedSql, /pageviews\.site_id = \?/);
    assert.equal(trend.length, 3);
  });
});

test("propagates reporting-range validation errors and validates site IDs", () => {
  withDatabase(({ database, siteId }) => {
    assert.throws(
      () => getDailyUniqueVisitorTrend(database, {
        siteId,
        startDate: "2026-02-29",
        endDate: "2026-03-01",
        timeZone: "UTC",
      }),
      { message: "startDate must be a valid YYYY-MM-DD calendar date" },
    );
    assert.throws(
      () => getDailyUniqueVisitorTrend(database, {
        siteId,
        startDate: "2026-03-01",
        endDate: "2026-03-01",
        timeZone: "Not/A_Time_Zone",
      }),
      { message: "timeZone must be a valid IANA time zone" },
    );
    assert.throws(
      () => getDailyUniqueVisitorTrend(database, {
        siteId: 0,
        startDate: "2026-03-01",
        endDate: "2026-03-01",
        timeZone: "UTC",
      }),
      { message: "siteId must be a positive integer" },
    );
  });
});

test("contains SQLite failures behind a stable trend error", () => {
  const database = new DatabaseSync(":memory:");

  try {
    assert.throws(
      () => getDailyUniqueVisitorTrend(database, {
        siteId: 1,
        startDate: "2026-08-09",
        endDate: "2026-08-09",
        timeZone: "UTC",
      }),
      { message: "Daily unique visitor trend could not be calculated" },
    );
  } finally {
    database.close();
  }
});
