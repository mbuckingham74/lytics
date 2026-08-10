import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "./database";
import {
  getActiveVisitorCount,
  getAverageSessionDuration,
  getBounceRate,
  getPagesPerSession,
  getPageviewSummary,
  getRankedBrowsersByVisitors,
  getRankedCitiesByVisitors,
  getRankedCountriesByVisitors,
  getRankedDeviceTypesByVisitors,
  getRankedEntryPages,
  getRankedExitPages,
  getRankedOperatingSystemsByVisitors,
  getRankedPages,
  getRankedPagesBySessions,
  getRankedRegionsByVisitors,
  getRankedReferrers,
  getRankedReferrersBySessions,
  getSessionCount,
  initializePageviews,
  recordPageview,
} from "./pageviews";
import type {
  RankedBrowserByVisitors,
  RankedCityByVisitors,
  RankedCountryByVisitors,
  RankedDeviceTypeByVisitors,
  RankedOperatingSystemByVisitors,
  RankedRegionByVisitors,
  RankedReferrerBySessions,
} from "./pageviews";
import { initializeSites, registerSite } from "./sites";

function withTemporaryDatabase(
  run: (database: ReturnType<typeof openDatabase>, filePath: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "lytics-pageviews-"));
  const filePath = join(directory, "analytics.sqlite");
  let database: ReturnType<typeof openDatabase> | undefined;

  try {
    database = openDatabase(filePath);
    run(database, filePath);
  } finally {
    try {
      if (database?.isOpen) {
        database.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }
}

function initializeRegisteredSite(
  database: ReturnType<typeof openDatabase>,
): number {
  initializeSites(database);
  initializePageviews(database);

  return registerSite(database, {
    name: "Personal Site",
    domain: "personal.example",
  }).id;
}

test("creates exactly the approved nullable geography and technology columns", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);

    const columns = database
      .prepare("PRAGMA table_info(pageviews)")
      .all()
      .map((row) => ({
        name: row.name as string,
        type: row.type as string,
        notNull: row.notnull as number,
      }));

    assert.deepEqual(
      columns.map((column) => column.name),
      [
        "id",
        "site_id",
        "visitor_id",
        "path",
        "referrer",
        "occurred_at",
        "country_code",
        "country_name",
        "region_code",
        "region_name",
        "city_name",
        "browser_name",
        "device_type",
        "operating_system_name",
      ],
    );
    assert.deepEqual(
      columns.slice(6, 11),
      [
        { name: "country_code", type: "TEXT", notNull: 0 },
        { name: "country_name", type: "TEXT", notNull: 0 },
        { name: "region_code", type: "TEXT", notNull: 0 },
        { name: "region_name", type: "TEXT", notNull: 0 },
        { name: "city_name", type: "TEXT", notNull: 0 },
      ],
    );
    assert.deepEqual(
      columns.slice(-3),
      [
        { name: "browser_name", type: "TEXT", notNull: 0 },
        { name: "device_type", type: "TEXT", notNull: 0 },
        { name: "operating_system_name", type: "TEXT", notNull: 0 },
      ],
    );
    assert.equal(columns.some((column) => /ip/i.test(column.name)), false);
    assert.equal(
      columns.some((column) => /user.agent|user_agent|ua$/i.test(column.name)),
      false,
    );
  });
});

test("initializes the pageviews table idempotently without losing rows", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    initializePageviews(database);

    recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/",
      occurredAt: new Date("2026-08-09T12:00:00.000Z"),
    });

    initializePageviews(database);

    assert.equal(
      database.prepare("SELECT count(*) AS count FROM pageviews").get()?.count,
      1,
    );
    assert.equal(
      database
        .prepare("PRAGMA table_info(pageviews)")
        .all()
        .filter((row) =>
          [
            "country_code",
            "country_name",
            "region_code",
            "region_name",
            "city_name",
            "browser_name",
            "device_type",
            "operating_system_name",
          ].includes(row.name as string),
        ).length,
      8,
    );
  });
});

test("upgrades a pre-enrichment schema without changing rows or indexes", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    const siteId = registerSite(database, {
      name: "Existing Site",
      domain: "existing.example",
    }).id;
    const occurredAt = new Date("2026-08-09T11:00:00.000Z");

    database.exec(`
      CREATE TABLE pageviews (
        id INTEGER PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES sites(id),
        visitor_id TEXT NOT NULL CHECK (length(trim(visitor_id)) > 0),
        path TEXT NOT NULL CHECK (length(trim(path)) > 0),
        referrer TEXT,
        occurred_at INTEGER NOT NULL
      );
      CREATE INDEX pageviews_existing_index
        ON pageviews (site_id, occurred_at);
    `);
    database
      .prepare(`
        INSERT INTO pageviews (
          site_id,
          visitor_id,
          path,
          referrer,
          occurred_at
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        siteId,
        "existing-visitor",
        "/existing",
        "https://source.example",
        occurredAt.getTime(),
      );

    initializePageviews(database);
    initializePageviews(database);

    assert.deepEqual(
      database
        .prepare("PRAGMA table_info(pageviews)")
        .all()
        .map((row) => row.name),
      [
        "id",
        "site_id",
        "visitor_id",
        "path",
        "referrer",
        "occurred_at",
        "country_code",
        "country_name",
        "region_code",
        "region_name",
        "city_name",
        "browser_name",
        "device_type",
        "operating_system_name",
      ],
    );
    assert.deepEqual(
      {
        ...database.prepare("SELECT * FROM pageviews").get(),
      },
      {
        id: 1,
        site_id: siteId,
        visitor_id: "existing-visitor",
        path: "/existing",
        referrer: "https://source.example",
        occurred_at: occurredAt.getTime(),
        country_code: null,
        country_name: null,
        region_code: null,
        region_name: null,
        city_name: null,
        browser_name: null,
        device_type: null,
        operating_system_name: null,
      },
    );
    assert.equal(
      database
        .prepare(`
          SELECT count(*) AS count
          FROM sqlite_schema
          WHERE type = 'index' AND name = 'pageviews_existing_index'
        `)
        .get()?.count,
      1,
    );
  });
});

test("records normalized pageview data and returns the persisted row", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T12:34:56.789Z");

    const pageview = recordPageview(database, {
      siteId,
      visitorId: "  visitor-1  ",
      path: "  /writing/hello  ",
      referrer: "  https://example.com/source  ",
      occurredAt,
      geography: {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        cityName: "Seattle",
      },
      technology: {
        browserName: "Chrome",
        deviceType: "desktop",
        operatingSystemName: "Windows",
      },
    });

    assert.deepEqual(pageview, {
      id: 1,
      siteId,
      visitorId: "visitor-1",
      path: "/writing/hello",
      referrer: "https://example.com/source",
      occurredAt,
      geography: {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        cityName: "Seattle",
      },
      technology: {
        browserName: "Chrome",
        deviceType: "desktop",
        operatingSystemName: "Windows",
      },
    });
    assert.deepEqual(
      {
        ...database
          .prepare(
            `
              SELECT
                id,
                site_id,
                visitor_id,
                path,
                referrer,
                occurred_at,
                country_code,
                country_name,
                region_code,
                region_name,
                city_name,
                browser_name,
                device_type,
                operating_system_name
              FROM pageviews
            `,
          )
          .get(),
      },
      {
        id: 1,
        site_id: siteId,
        visitor_id: "visitor-1",
        path: "/writing/hello",
        referrer: "https://example.com/source",
        occurred_at: occurredAt.getTime(),
        country_code: "US",
        country_name: "United States",
        region_code: "WA",
        region_name: "Washington",
        city_name: "Seattle",
        browser_name: "Chrome",
        device_type: "desktop",
        operating_system_name: "Windows",
      },
    );
  });
});

test("persists pageviews after the database is closed and reopened", () => {
  withTemporaryDatabase((database, filePath) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T13:00:00.000Z");

    recordPageview(database, {
      siteId,
      visitorId: "visitor-2",
      path: "/archive",
      occurredAt,
      geography: {
        countryCode: "GB",
        countryName: "United Kingdom",
        regionCode: "ENG",
        regionName: "England",
        cityName: "London",
      },
      technology: {
        browserName: "Mobile Safari",
        deviceType: "mobile",
        operatingSystemName: "iOS",
      },
    });

    database.close();
    const reopenedDatabase = openDatabase(filePath);

    try {
      assert.deepEqual(
        {
          ...reopenedDatabase
            .prepare(
              `
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
                  city_name,
                  browser_name,
                  device_type,
                  operating_system_name
                FROM pageviews
              `,
            )
            .get(),
        },
        {
          site_id: siteId,
          visitor_id: "visitor-2",
          path: "/archive",
          referrer: null,
          occurred_at: occurredAt.getTime(),
          country_code: "GB",
          country_name: "United Kingdom",
          region_code: "ENG",
          region_name: "England",
          city_name: "London",
          browser_name: "Mobile Safari",
          device_type: "mobile",
          operating_system_name: "iOS",
        },
      );
    } finally {
      reopenedDatabase.close();
    }
  });
});

test("stores omitted and blank referrers as null", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T14:00:00.000Z");

    const omitted = recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/one",
      occurredAt,
    });
    const blank = recordPageview(database, {
      siteId,
      visitorId: "visitor-2",
      path: "/two",
      referrer: "   ",
      occurredAt,
    });

    assert.equal(omitted.referrer, null);
    assert.equal(blank.referrer, null);
    assert.deepEqual(
      database
        .prepare("SELECT referrer FROM pageviews ORDER BY id")
        .all()
        .map((row) => row.referrer),
      [null, null],
    );
  });
});

test("stores omitted and partially null geography without normalization", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T14:30:00.000Z");

    const omitted = recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/without-geography",
      occurredAt,
    });
    const partial = recordPageview(database, {
      siteId,
      visitorId: "visitor-2",
      path: "/partial-geography",
      occurredAt,
      geography: {
        countryCode: "US",
        countryName: null,
        regionCode: null,
        regionName: "  Washington  ",
        cityName: null,
      },
    });

    assert.deepEqual(omitted.geography, {
      countryCode: null,
      countryName: null,
      regionCode: null,
      regionName: null,
      cityName: null,
    });
    assert.deepEqual(partial.geography, {
      countryCode: "US",
      countryName: null,
      regionCode: null,
      regionName: "  Washington  ",
      cityName: null,
    });
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
          country_code: "US",
          country_name: null,
          region_code: null,
          region_name: "  Washington  ",
          city_name: null,
        },
      ],
    );
  });
});

test("stores omitted and partially null technology without a raw user agent", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T14:45:00.000Z");

    const omitted = recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/without-technology",
      occurredAt,
    });
    const partial = recordPageview(database, {
      siteId,
      visitorId: "visitor-2",
      path: "/partial-technology",
      occurredAt,
      technology: {
        browserName: "  Firefox  ",
        deviceType: null,
        operatingSystemName: "Linux",
      },
    });

    assert.deepEqual(omitted.technology, {
      browserName: null,
      deviceType: null,
      operatingSystemName: null,
    });
    assert.deepEqual(partial.technology, {
      browserName: "  Firefox  ",
      deviceType: null,
      operatingSystemName: "Linux",
    });
    assert.deepEqual(
      database
        .prepare(`
          SELECT
            browser_name,
            device_type,
            operating_system_name
          FROM pageviews
          ORDER BY id ASC
        `)
        .all()
        .map((row) => ({ ...row })),
      [
        {
          browser_name: null,
          device_type: null,
          operating_system_name: null,
        },
        {
          browser_name: "  Firefox  ",
          device_type: null,
          operating_system_name: "Linux",
        },
      ],
    );
    assert.equal(
      database
        .prepare("PRAGMA table_info(pageviews)")
        .all()
        .some((row) => /user.agent|user_agent|ua$/i.test(row.name as string)),
      false,
    );
  });
});

test("rejects blank visitor IDs, blank paths, and invalid dates", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T15:00:00.000Z");

    assert.throws(
      () =>
        recordPageview(database, {
          siteId,
          visitorId: "   ",
          path: "/",
          occurredAt,
        }),
      /visitor ID cannot be blank/i,
    );
    assert.throws(
      () =>
        recordPageview(database, {
          siteId,
          visitorId: "visitor-1",
          path: "   ",
          occurredAt,
        }),
      /path cannot be blank/i,
    );
    assert.throws(
      () =>
        recordPageview(database, {
          siteId,
          visitorId: "visitor-1",
          path: "/",
          occurredAt: new Date(Number.NaN),
        }),
      /valid date/i,
    );
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM pageviews").get()?.count,
      0,
    );
  });
});

test("rejects a pageview for an unknown site", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);

    assert.throws(() =>
      recordPageview(database, {
        siteId: 999,
        visitorId: "visitor-1",
        path: "/",
        occurredAt: new Date("2026-08-09T16:00:00.000Z"),
      }),
    );
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM pageviews").get()?.count,
      0,
    );
  });
});

test("summarizes pageviews and distinct visitors for only the requested site", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const pageview of [
      { siteId, visitorId: "visitor-1", occurredAt: "2026-08-09T12:00:00.000Z" },
      { siteId, visitorId: "visitor-1", occurredAt: "2026-08-09T12:30:00.000Z" },
      { siteId, visitorId: "visitor-2", occurredAt: "2026-08-09T13:00:00.000Z" },
      {
        siteId: otherSiteId,
        visitorId: "visitor-3",
        occurredAt: "2026-08-09T13:30:00.000Z",
      },
    ]) {
      recordPageview(database, {
        siteId: pageview.siteId,
        visitorId: pageview.visitorId,
        path: "/",
        occurredAt: new Date(pageview.occurredAt),
      });
    }

    assert.deepEqual(
      getPageviewSummary(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T14:00:00.000Z"),
      }),
      { pageviews: 3, uniqueVisitors: 2 },
    );
  });
});

test("uses a start-inclusive and end-exclusive millisecond range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const occurredAt of [
      "2026-08-09T11:59:59.999Z",
      "2026-08-09T12:00:00.000Z",
      "2026-08-09T12:00:00.001Z",
      "2026-08-09T13:00:00.000Z",
    ]) {
      recordPageview(database, {
        siteId,
        visitorId: occurredAt,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getPageviewSummary(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      { pageviews: 2, uniqueVisitors: 2 },
    );
  });
});

test("returns zero counts for an empty matching range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getPageviewSummary(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      { pageviews: 0, uniqueVisitors: 0 },
    );
  });
});

test("rejects invalid summary dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getPageviewSummary(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      /start time must be a valid date/i,
    );
    assert.throws(
      () =>
        getPageviewSummary(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      /end time must be a valid date/i,
    );
    assert.throws(
      () =>
        getPageviewSummary(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      /start time must be earlier than end time/i,
    );
    assert.throws(
      () =>
        getPageviewSummary(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      /start time must be earlier than end time/i,
    );
  });
});

test("counts sessions independently by visitor and site using occurrence order", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, occurredAt] of [
      [siteId, "visitor-1", "2026-08-09T12:20:00.000Z"],
      [siteId, "visitor-1", "2026-08-09T12:00:00.000Z"],
      [siteId, "visitor-1", "2026-08-09T12:49:59.999Z"],
      [siteId, "visitor-2", "2026-08-09T12:05:00.000Z"],
      [siteId, "visitor-2", "2026-08-09T12:34:59.999Z"],
      [otherSiteId, "visitor-1", "2026-08-09T12:30:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getSessionCount(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      2,
    );
  });
});

test("starts a new session at an exact thirty-minute gap", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const occurredAt of [
      "2026-08-09T12:00:00.000Z",
      "2026-08-09T12:30:00.000Z",
      "2026-08-09T12:59:59.999Z",
    ]) {
      recordPageview(database, {
        siteId,
        visitorId: "visitor-1",
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getSessionCount(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      2,
    );
  });
});

test("attributes sessions to starts within the half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, occurredAt] of [
      ["crosses-start", "2026-08-09T11:50:00.000Z"],
      ["crosses-start", "2026-08-09T12:10:00.000Z"],
      ["starts-at-start", "2026-08-09T12:00:00.000Z"],
      ["crosses-end", "2026-08-09T12:50:00.000Z"],
      ["crosses-end", "2026-08-09T13:10:00.000Z"],
      ["starts-at-end", "2026-08-09T13:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getSessionCount(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      2,
    );
  });
});

test("returns zero sessions when the range has no session starts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.equal(
      getSessionCount(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      0,
    );
  });
});

test("rejects invalid session-count dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getSessionCount(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      /start time must be a valid date/i,
    );
    assert.throws(
      () =>
        getSessionCount(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      /end time must be a valid date/i,
    );
    assert.throws(
      () =>
        getSessionCount(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      /start time must be earlier than end time/i,
    );
    assert.throws(
      () =>
        getSessionCount(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      /start time must be earlier than end time/i,
    );
  });
});

test("averages sessions independently by visitor and site using occurrence order and raw pageviews", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, occurredAt] of [
      [siteId, "visitor-1", "2026-08-09T12:20:00.000Z"],
      [siteId, "visitor-2", "2026-08-09T12:10:00.000Z"],
      [siteId, "visitor-1", "2026-08-09T12:00:00.000Z"],
      [otherSiteId, "visitor-1", "2026-08-09T12:40:00.000Z"],
      [siteId, "visitor-1", "2026-08-09T12:49:59.999Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/repeated",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getPagesPerSession(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      2,
    );
  });
});

test("starts a new pages-per-session session at an exact thirty-minute gap", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const occurredAt of [
      "2026-08-09T12:00:00.000Z",
      "2026-08-09T12:29:59.999Z",
      "2026-08-09T12:59:59.999Z",
    ]) {
      recordPageview(database, {
        siteId,
        visitorId: "visitor-1",
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getPagesPerSession(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      1.5,
    );
  });
});

test("attributes complete pages-per-session sessions to starts within the half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, occurredAt] of [
      ["crosses-start", "2026-08-09T11:50:00.000Z"],
      ["crosses-start", "2026-08-09T12:10:00.000Z"],
      ["starts-at-start", "2026-08-09T12:00:00.000Z"],
      ["starts-at-start", "2026-08-09T12:20:00.000Z"],
      ["crosses-end", "2026-08-09T12:50:00.000Z"],
      ["crosses-end", "2026-08-09T13:10:00.000Z"],
      ["starts-at-end", "2026-08-09T13:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getPagesPerSession(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      2,
    );
  });
});

test("returns zero pages per session when the range has no session starts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.equal(
      getPagesPerSession(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      0,
    );
  });
});

test("rejects invalid pages-per-session dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getPagesPerSession(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      /pages per session start time must be a valid date/i,
    );
    assert.throws(
      () =>
        getPagesPerSession(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      /pages per session end time must be a valid date/i,
    );
    assert.throws(
      () =>
        getPagesPerSession(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      /pages per session start time must be earlier than end time/i,
    );
    assert.throws(
      () =>
        getPagesPerSession(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      /pages per session start time must be earlier than end time/i,
    );
  });
});

test("calculates bounce rate independently by visitor and site using occurrence order and raw pageviews", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, occurredAt] of [
      [siteId, "visitor-1", "2026-08-09T12:20:00.000Z"],
      [siteId, "visitor-2", "2026-08-09T12:10:00.000Z"],
      [siteId, "visitor-1", "2026-08-09T12:00:00.000Z"],
      [otherSiteId, "visitor-1", "2026-08-09T12:40:00.000Z"],
      [siteId, "visitor-1", "2026-08-09T12:49:59.999Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/repeated",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getBounceRate(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      50,
    );
  });
});

test("starts a new bounce-rate session at an exact thirty-minute gap without rounding", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, occurredAt] of [
      ["below-boundary", "2026-08-09T12:29:59.999Z"],
      ["exact-boundary", "2026-08-09T12:30:00.000Z"],
      ["below-boundary", "2026-08-09T12:00:00.000Z"],
      ["exact-boundary", "2026-08-09T12:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getBounceRate(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      200 / 3,
    );
  });
});

test("attributes complete bounce-rate sessions to starts within the half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, occurredAt] of [
      ["crosses-start", "2026-08-09T11:50:00.000Z"],
      ["crosses-start", "2026-08-09T12:10:00.000Z"],
      ["starts-at-start", "2026-08-09T12:00:00.000Z"],
      ["crosses-end", "2026-08-09T12:50:00.000Z"],
      ["starts-at-end", "2026-08-09T13:00:00.000Z"],
      ["crosses-end", "2026-08-09T13:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getBounceRate(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      50,
    );
  });
});

test("returns zero bounce rate when the range has no session starts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.equal(
      getBounceRate(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      0,
    );
  });
});

test("rejects invalid bounce-rate dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getBounceRate(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      /bounce rate start time must be a valid date/i,
    );
    assert.throws(
      () =>
        getBounceRate(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      /bounce rate end time must be a valid date/i,
    );
    assert.throws(
      () =>
        getBounceRate(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      /bounce rate start time must be earlier than end time/i,
    );
    assert.throws(
      () =>
        getBounceRate(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      /bounce rate start time must be earlier than end time/i,
    );
  });
});

test("averages session durations in seconds including one-page sessions", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, occurredAt] of [
      [siteId, "multi-page", "2026-08-09T12:00:10.000Z"],
      [siteId, "one-page-1", "2026-08-09T12:10:00.000Z"],
      [siteId, "multi-page", "2026-08-09T12:00:00.000Z"],
      [siteId, "one-page-2", "2026-08-09T12:20:00.000Z"],
      [otherSiteId, "other-site", "2026-08-09T12:00:00.000Z"],
      [otherSiteId, "other-site", "2026-08-09T12:20:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getAverageSessionDuration(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      10 / 3,
    );
  });
});

test("starts a new duration session at an exact thirty-minute gap without rounding", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const occurredAt of [
      "2026-08-09T12:00:00.000Z",
      "2026-08-09T12:29:59.999Z",
      "2026-08-09T12:59:59.999Z",
    ]) {
      recordPageview(database, {
        siteId,
        visitorId: "visitor-1",
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getAverageSessionDuration(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      899.9995,
    );
  });
});

test("attributes complete session durations to starts within the half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, occurredAt] of [
      ["crosses-start", "2026-08-09T11:50:00.000Z"],
      ["crosses-start", "2026-08-09T12:10:00.000Z"],
      ["starts-at-start", "2026-08-09T12:00:00.000Z"],
      ["starts-at-start", "2026-08-09T12:05:00.000Z"],
      ["crosses-end", "2026-08-09T12:50:00.000Z"],
      ["crosses-end", "2026-08-09T13:10:00.000Z"],
      ["starts-at-end", "2026-08-09T13:00:00.000Z"],
      ["starts-at-end", "2026-08-09T13:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(
      getAverageSessionDuration(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      750,
    );
  });
});

test("returns zero average session duration when the range has no session starts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.equal(
      getAverageSessionDuration(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      0,
    );
  });
});

test("rejects invalid average-duration dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getAverageSessionDuration(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      /average session duration start time must be a valid date/i,
    );
    assert.throws(
      () =>
        getAverageSessionDuration(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      /average session duration end time must be a valid date/i,
    );
    assert.throws(
      () =>
        getAverageSessionDuration(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      /average session duration start time must be earlier than end time/i,
    );
    assert.throws(
      () =>
        getAverageSessionDuration(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      /average session duration start time must be earlier than end time/i,
    );
  });
});

test("counts distinct active visitors for only the requested site in the inclusive five-minute window", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;
    const nowAt = new Date("2026-08-09T12:05:00.000Z");

    for (const [pageviewSiteId, visitorId, occurredAt] of [
      [siteId, "before-window", "2026-08-09T11:59:59.999Z"],
      [siteId, "boundary-visitor", "2026-08-09T12:00:00.000Z"],
      [siteId, "repeated-visitor", "2026-08-09T12:01:00.000Z"],
      [siteId, "repeated-visitor", "2026-08-09T12:02:00.000Z"],
      [siteId, "visitor-2", "2026-08-09T12:05:00.000Z"],
      [siteId, "after-now", "2026-08-09T12:05:00.001Z"],
      [siteId, "future", "2026-08-09T13:00:00.000Z"],
      [otherSiteId, "other-site", "2026-08-09T12:03:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
      });
    }

    assert.equal(getActiveVisitorCount(database, { siteId, nowAt }), 3);
  });
});

test("returns zero active visitors when no pageviews qualify", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.equal(
      getActiveVisitorCount(database, {
        siteId,
        nowAt: new Date("2026-08-09T12:05:00.000Z"),
      }),
      0,
    );
  });
});

test("rejects an invalid active-visitor time", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.throws(
      () =>
        getActiveVisitorCount(database, {
          siteId,
          nowAt: new Date(Number.NaN),
        }),
      /active-visitor time must be a valid date/i,
    );
  });
});

test("ranks paths by matching raw pageviews regardless of visitor", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, path] of [
      ["visitor-1", "/archive"],
      ["visitor-1", "/archive"],
      ["visitor-2", "/archive"],
      ["visitor-1", "/about"],
    ]) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/archive", pageviews: 3 },
        { path: "/about", pageviews: 1 },
      ],
    );
  });
});

test("ranks only the requested site's paths within a half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, path, occurredAt] of [
      [siteId, "/before", "2026-08-09T11:59:59.999Z"],
      [siteId, "/start", "2026-08-09T12:00:00.000Z"],
      [siteId, "/inside", "2026-08-09T12:00:00.001Z"],
      [siteId, "/end", "2026-08-09T13:00:00.000Z"],
      [otherSiteId, "/other-site", "2026-08-09T12:30:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId: `${pageviewSiteId}-${path}`,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/inside", pageviews: 1 },
        { path: "/start", pageviews: 1 },
      ],
    );
  });
});

test("orders tied ranked pages by stored path using binary ordering", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const path of ["/alpha", "/Alpha", "/beta"]) {
      recordPageview(database, {
        siteId,
        visitorId: path,
        path,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/Alpha", pageviews: 1 },
        { path: "/alpha", pageviews: 1 },
        { path: "/beta", pageviews: 1 },
      ],
    );
  });
});

test("returns no ranked pages when the range has no matches", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid ranked-page dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedPages(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      /start time must be a valid date/i,
    );
    assert.throws(
      () =>
        getRankedPages(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      /end time must be a valid date/i,
    );
    assert.throws(
      () =>
        getRankedPages(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      /start time must be earlier than end time/i,
    );
    assert.throws(
      () =>
        getRankedPages(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      /start time must be earlier than end time/i,
    );
  });
});

test("ranks pages by distinct sessions without changing raw pageview ranking", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, path, occurredAt] of [
      ["visitor-1", "/repeat", "2026-08-09T12:00:00.000Z"],
      ["visitor-1", "/repeat", "2026-08-09T12:05:00.000Z"],
      ["visitor-1", "/other", "2026-08-09T12:10:00.000Z"],
      ["visitor-1", "/repeat", "2026-08-09T12:15:00.000Z"],
      ["visitor-2", "/repeat", "2026-08-09T12:20:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    const range = {
      siteId,
      startAt: new Date("2026-08-09T12:00:00.000Z"),
      endAt: new Date("2026-08-09T13:00:00.000Z"),
    };

    assert.deepEqual(getRankedPages(database, range), [
      { path: "/repeat", pageviews: 4 },
      { path: "/other", pageviews: 1 },
    ]);
    assert.deepEqual(getRankedPagesBySessions(database, range), [
      { path: "/repeat", sessions: 2 },
      { path: "/other", sessions: 1 },
    ]);
  });
});

test("sessionizes ranked pages independently by visitor and site in occurrence and ID order", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, path, occurredAt] of [
      [siteId, "visitor-1", "/first-session", "2026-08-09T12:59:59.999Z"],
      [siteId, "visitor-1", "/first-session", "2026-08-09T12:00:00.000Z"],
      [otherSiteId, "visitor-1", "/other-site", "2026-08-09T12:45:00.000Z"],
      [siteId, "visitor-1", "/first-session", "2026-08-09T12:29:59.999Z"],
      [siteId, "visitor-2", "/first-session", "2026-08-09T12:10:00.000Z"],
      [siteId, "visitor-2", "/same-time-a", "2026-08-09T12:20:00.000Z"],
      [siteId, "visitor-2", "/same-time-b", "2026-08-09T12:20:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedPagesBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:30:00.000Z"),
      }),
      [
        { path: "/first-session", sessions: 3 },
        { path: "/same-time-a", sessions: 1 },
        { path: "/same-time-b", sessions: 1 },
      ],
    );
  });
});

test("selects ranked-page sessions by full-history starts in the half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, path, occurredAt] of [
      ["before-start", "/excluded-before", "2026-08-09T11:50:00.000Z"],
      ["before-start", "/excluded-inside", "2026-08-09T12:10:00.000Z"],
      ["at-start", "/at-start", "2026-08-09T12:00:00.000Z"],
      ["at-start", "/bridge-one", "2026-08-09T12:20:00.000Z"],
      ["at-start", "/bridge-two", "2026-08-09T12:49:00.000Z"],
      ["at-start", "/at-end-path", "2026-08-09T13:00:00.000Z"],
      ["crosses-end", "/before-end", "2026-08-09T12:50:00.000Z"],
      ["crosses-end", "/after-end", "2026-08-09T13:10:00.000Z"],
      ["starts-at-end", "/excluded-at-end", "2026-08-09T13:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedPagesBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/after-end", sessions: 1 },
        { path: "/at-end-path", sessions: 1 },
        { path: "/at-start", sessions: 1 },
        { path: "/before-end", sessions: 1 },
        { path: "/bridge-one", sessions: 1 },
        { path: "/bridge-two", sessions: 1 },
      ],
    );
  });
});

test("orders tied session-ranked pages by stored path using binary ordering", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const path of ["/alpha", "/Alpha", "/beta"]) {
      recordPageview(database, {
        siteId,
        visitorId: path,
        path,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedPagesBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/Alpha", sessions: 1 },
        { path: "/alpha", sessions: 1 },
        { path: "/beta", sessions: 1 },
      ],
    );
  });
});

test("returns no session-ranked pages when the range has no session starts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedPagesBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid session-ranked-page dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedPagesBySessions(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      { message: "Ranked pages by sessions start time must be a valid date" },
    );
    assert.throws(
      () =>
        getRankedPagesBySessions(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      { message: "Ranked pages by sessions end time must be a valid date" },
    );
    assert.throws(
      () =>
        getRankedPagesBySessions(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked pages by sessions start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedPagesBySessions(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked pages by sessions start time must be earlier than end time",
      },
    );
  });
});

test("ranks each session's entry path without counting later pageviews", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, path, occurredAt] of [
      ["visitor-1", "/landing", "2026-08-09T12:00:00.000Z"],
      ["visitor-1", "/later", "2026-08-09T12:10:00.000Z"],
      ["visitor-1", "/later", "2026-08-09T12:20:00.000Z"],
      ["visitor-2", "/landing", "2026-08-09T12:05:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedEntryPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [{ path: "/landing", sessions: 2 }],
    );
  });
});

test("ranks entry pages with independent visitor and site sessionization in occurrence order", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, path, occurredAt] of [
      [siteId, "visitor-1", "/second-entry", "2026-08-09T12:50:00.000Z"],
      [siteId, "visitor-1", "/first-entry", "2026-08-09T12:00:00.000Z"],
      [siteId, "visitor-1", "/later", "2026-08-09T12:10:00.000Z"],
      [siteId, "visitor-2", "/first-entry", "2026-08-09T12:05:00.000Z"],
      [otherSiteId, "visitor-1", "/other-site", "2026-08-09T12:30:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedEntryPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/first-entry", sessions: 2 },
        { path: "/second-entry", sessions: 1 },
      ],
    );
  });
});

test("starts a ranked entry-page session at the exact thirty-minute boundary", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [path, occurredAt] of [
      ["/first", "2026-08-09T12:00:00.000Z"],
      ["/within", "2026-08-09T12:29:59.999Z"],
      ["/exact", "2026-08-09T12:59:59.999Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId: "visitor-1",
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedEntryPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/exact", sessions: 1 },
        { path: "/first", sessions: 1 },
      ],
    );
  });
});

test("uses ascending pageview ID to choose an entry path at identical timestamps", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T12:30:00.000Z");

    recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/lower-id",
      occurredAt,
    });
    recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/higher-id",
      occurredAt,
    });

    assert.deepEqual(
      getRankedEntryPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [{ path: "/lower-id", sessions: 1 }],
    );
  });
});

test("attributes ranked entry pages by full-history session starts in the half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, path, occurredAt] of [
      ["crosses-start", "/before-start", "2026-08-09T11:50:00.000Z"],
      ["crosses-start", "/inside-not-entry", "2026-08-09T12:10:00.000Z"],
      ["starts-at-start", "/at-start", "2026-08-09T12:00:00.000Z"],
      ["crosses-end", "/before-end", "2026-08-09T12:50:00.000Z"],
      ["crosses-end", "/after-end-not-entry", "2026-08-09T13:10:00.000Z"],
      ["starts-at-end", "/at-end", "2026-08-09T13:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedEntryPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/at-start", sessions: 1 },
        { path: "/before-end", sessions: 1 },
      ],
    );
  });
});

test("orders tied ranked entry pages by stored path using binary ordering", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const path of ["/alpha", "/Alpha", "/beta"]) {
      recordPageview(database, {
        siteId,
        visitorId: path,
        path,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedEntryPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/Alpha", sessions: 1 },
        { path: "/alpha", sessions: 1 },
        { path: "/beta", sessions: 1 },
      ],
    );
  });
});

test("returns no ranked entry pages when the range has no session starts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedEntryPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid ranked entry-page dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedEntryPages(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      { message: "Ranked entry pages start time must be a valid date" },
    );
    assert.throws(
      () =>
        getRankedEntryPages(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      { message: "Ranked entry pages end time must be a valid date" },
    );
    assert.throws(
      () =>
        getRankedEntryPages(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      { message: "Ranked entry pages start time must be earlier than end time" },
    );
    assert.throws(
      () =>
        getRankedEntryPages(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      { message: "Ranked entry pages start time must be earlier than end time" },
    );
  });
});

test("ranks each session's final page without counting entry or intermediate pages", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, path, occurredAt] of [
      ["visitor-1", "/landing", "2026-08-09T12:00:00.000Z"],
      ["visitor-1", "/middle", "2026-08-09T12:10:00.000Z"],
      ["visitor-1", "/exit", "2026-08-09T12:20:00.000Z"],
      ["visitor-2", "/other-landing", "2026-08-09T12:05:00.000Z"],
      ["visitor-2", "/exit", "2026-08-09T12:15:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedExitPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [{ path: "/exit", sessions: 2 }],
    );
  });
});

test("sessionizes ranked exits by occurrence time independently per visitor and site", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, path, occurredAt] of [
      [siteId, "visitor-1", "/second-entry", "2026-08-09T12:50:00.000Z"],
      [siteId, "visitor-2", "/shared-exit", "2026-08-09T12:15:00.000Z"],
      [siteId, "visitor-1", "/first-entry", "2026-08-09T12:00:00.000Z"],
      [otherSiteId, "visitor-1", "/other-site", "2026-08-09T12:35:00.000Z"],
      [siteId, "visitor-1", "/shared-exit", "2026-08-09T13:00:00.000Z"],
      [siteId, "visitor-2", "/visitor-two-entry", "2026-08-09T12:05:00.000Z"],
      [siteId, "visitor-1", "/shared-exit", "2026-08-09T12:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedExitPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T14:00:00.000Z"),
      }),
      [{ path: "/shared-exit", sessions: 3 }],
    );
  });
});

test("starts a ranked exit-page session at the exact thirty-minute boundary", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [path, occurredAt] of [
      ["/first", "2026-08-09T12:00:00.000Z"],
      ["/within-exit", "2026-08-09T12:29:59.999Z"],
      ["/exact-exit", "2026-08-09T12:59:59.999Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId: "visitor-1",
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedExitPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/exact-exit", sessions: 1 },
        { path: "/within-exit", sessions: 1 },
      ],
    );
  });
});

test("uses the higher pageview ID as the exit at identical timestamps", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T12:30:00.000Z");

    recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/lower-id",
      occurredAt,
    });
    recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/higher-id",
      occurredAt,
    });

    assert.deepEqual(
      getRankedExitPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [{ path: "/higher-id", sessions: 1 }],
    );
  });
});

test("attributes complete ranked exits by session starts in the half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, path, occurredAt] of [
      ["crosses-start", "/before-start", "2026-08-09T11:50:00.000Z"],
      ["crosses-start", "/inside", "2026-08-09T12:10:00.000Z"],
      ["crosses-start", "/beyond-range", "2026-08-09T13:09:59.998Z"],
      ["crosses-start", "/through-range", "2026-08-09T12:39:59.999Z"],
      ["starts-at-start", "/at-start", "2026-08-09T12:00:00.000Z"],
      ["starts-at-start", "/at-start-exit", "2026-08-09T12:05:00.000Z"],
      ["crosses-end", "/before-end", "2026-08-09T12:50:00.000Z"],
      ["crosses-end", "/after-end-exit", "2026-08-09T13:10:00.000Z"],
      ["starts-at-end", "/at-end", "2026-08-09T13:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedExitPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/after-end-exit", sessions: 1 },
        { path: "/at-start-exit", sessions: 1 },
      ],
    );
  });
});

test("orders tied ranked exit pages by stored path using binary ordering", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const path of ["/alpha", "/Alpha", "/beta"]) {
      recordPageview(database, {
        siteId,
        visitorId: path,
        path,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedExitPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { path: "/Alpha", sessions: 1 },
        { path: "/alpha", sessions: 1 },
        { path: "/beta", sessions: 1 },
      ],
    );
  });
});

test("returns no ranked exit pages when the range has no session starts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedExitPages(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid ranked exit-page dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedExitPages(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      { message: "Ranked exit pages start time must be a valid date" },
    );
    assert.throws(
      () =>
        getRankedExitPages(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      { message: "Ranked exit pages end time must be a valid date" },
    );
    assert.throws(
      () =>
        getRankedExitPages(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      { message: "Ranked exit pages start time must be earlier than end time" },
    );
    assert.throws(
      () =>
        getRankedExitPages(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      { message: "Ranked exit pages start time must be earlier than end time" },
    );
  });
});

test("ranks stored referrers by raw pageviews regardless of visitor", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const referrer of [
      "https://source.example/article",
      "https://source.example/article",
      "https://source.example/article",
      "https://source.example/article/",
      undefined,
      undefined,
    ]) {
      recordPageview(database, {
        siteId,
        visitorId: "same-visitor",
        path: "/",
        referrer,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedReferrers(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { referrer: "https://source.example/article", pageviews: 3 },
        { referrer: null, pageviews: 2 },
        { referrer: "https://source.example/article/", pageviews: 1 },
      ],
    );
  });
});

test("ranks only the requested site's referrers within a half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, referrer, occurredAt] of [
      [siteId, "before", "2026-08-09T11:59:59.999Z"],
      [siteId, "start", "2026-08-09T12:00:00.000Z"],
      [siteId, "inside", "2026-08-09T12:00:00.001Z"],
      [siteId, "end", "2026-08-09T13:00:00.000Z"],
      [otherSiteId, "other-site", "2026-08-09T12:30:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId: `${pageviewSiteId}-${referrer}`,
        path: "/",
        referrer,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedReferrers(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { referrer: "inside", pageviews: 1 },
        { referrer: "start", pageviews: 1 },
      ],
    );
  });
});

test("orders tied ranked referrers with null first then binary strings", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const referrer of [
      undefined,
      "https://alpha.example",
      "https://Alpha.example",
      "https://beta.example",
    ]) {
      recordPageview(database, {
        siteId,
        visitorId: referrer ?? "direct",
        path: "/",
        referrer,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedReferrers(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { referrer: null, pageviews: 1 },
        { referrer: "https://Alpha.example", pageviews: 1 },
        { referrer: "https://alpha.example", pageviews: 1 },
        { referrer: "https://beta.example", pageviews: 1 },
      ],
    );
  });
});

test("returns no ranked referrers when the range has no matches", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedReferrers(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid ranked-referrer dates and non-increasing ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedReferrers(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      /start time must be a valid date/i,
    );
    assert.throws(
      () =>
        getRankedReferrers(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      /end time must be a valid date/i,
    );
    assert.throws(
      () =>
        getRankedReferrers(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      /start time must be earlier than end time/i,
    );
    assert.throws(
      () =>
        getRankedReferrers(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      /start time must be earlier than end time/i,
    );
  });
});

test("ranks session entry referrers once while preserving raw referrer counts", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, referrer, occurredAt] of [
      [siteId, "visitor-1", "newsletter", "2026-08-09T12:50:00.000Z"],
      [siteId, "visitor-1", "search", "2026-08-09T12:00:00.000Z"],
      [siteId, "visitor-1", "later-change", "2026-08-09T12:10:00.000Z"],
      [siteId, "visitor-2", "search", "2026-08-09T12:05:00.000Z"],
      [siteId, "visitor-2", "ignored-later", "2026-08-09T12:20:00.000Z"],
      [otherSiteId, "visitor-1", "other-site", "2026-08-09T12:30:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        referrer,
        occurredAt: new Date(occurredAt),
      });
    }

    const range = {
      siteId,
      startAt: new Date("2026-08-09T12:00:00.000Z"),
      endAt: new Date("2026-08-09T13:00:00.000Z"),
    };
    const rankedReferrers: RankedReferrerBySessions[] =
      getRankedReferrersBySessions(database, range);

    assert.deepEqual(rankedReferrers, [
      { referrer: "search", sessions: 2 },
      { referrer: "newsletter", sessions: 1 },
    ]);
    assert.deepEqual(getRankedReferrers(database, range), [
      { referrer: "search", pageviews: 2 },
      { referrer: "ignored-later", pageviews: 1 },
      { referrer: "later-change", pageviews: 1 },
      { referrer: "newsletter", pageviews: 1 },
    ]);
  });
});

test("matches chronological insertion when using per-visitor occurrence order and exact boundaries", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const baseTime = Date.parse("2026-08-09T12:00:00.000Z");

    for (const [visitorId, referrer, offset] of [
      ["chronological", "repeat", 0],
      ["chronological", "repeat", 1_799_999],
      ["chronological", "repeat", 3_599_999],
      ["out-of-order", "repeat", 3_599_999],
      ["out-of-order", "repeat", 0],
      ["visitor-2", "isolated", 900_000],
      ["out-of-order", "repeat", 1_799_999],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/",
        referrer,
        occurredAt: new Date(baseTime + offset),
      });
    }

    assert.deepEqual(
      getRankedReferrersBySessions(database, {
        siteId,
        startAt: new Date(baseTime),
        endAt: new Date(baseTime + 4_000_000),
      }),
      [
        { referrer: "repeat", sessions: 4 },
        { referrer: "isolated", sessions: 1 },
      ],
    );
  });
});

test("uses lower pageview ID for entry attribution at identical timestamps", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const occurredAt = new Date("2026-08-09T12:30:00.000Z");

    recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/",
      referrer: "lower-id",
      occurredAt,
    });
    recordPageview(database, {
      siteId,
      visitorId: "visitor-1",
      path: "/",
      referrer: "higher-id",
      occurredAt,
    });

    assert.deepEqual(
      getRankedReferrersBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [{ referrer: "lower-id", sessions: 1 }],
    );
  });
});

test("selects session entry referrers by full-history starts in a half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    for (const [visitorId, referrer, occurredAt] of [
      ["before", "excluded-before", "2026-08-09T11:50:00.000Z"],
      ["before", "excluded-continuation", "2026-08-09T12:10:00.000Z"],
      ["start", "included-start", "2026-08-09T12:00:00.000Z"],
      ["start", "ignored-later", "2026-08-09T12:20:00.000Z"],
      ["end", "excluded-end", "2026-08-09T13:00:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: "/",
        referrer,
        occurredAt: new Date(occurredAt),
      });
    }

    assert.deepEqual(
      getRankedReferrersBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [{ referrer: "included-start", sessions: 1 }],
    );
  });
});

test("returns every tied session referrer with null first and binary ordering", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const referrers = [
      undefined,
      "alpha",
      "Alpha",
      "beta",
      "delta",
      "epsilon",
      "eta",
      "gamma",
      "iota",
      "kappa",
      "theta",
      "zeta",
    ] as const;

    for (const [index, referrer] of referrers.entries()) {
      recordPageview(database, {
        siteId,
        visitorId: `visitor-${index}`,
        path: "/",
        referrer,
        occurredAt: new Date("2026-08-09T12:30:00.000Z"),
      });
    }

    assert.deepEqual(
      getRankedReferrersBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [
        { referrer: null, sessions: 1 },
        { referrer: "Alpha", sessions: 1 },
        { referrer: "alpha", sessions: 1 },
        { referrer: "beta", sessions: 1 },
        { referrer: "delta", sessions: 1 },
        { referrer: "epsilon", sessions: 1 },
        { referrer: "eta", sessions: 1 },
        { referrer: "gamma", sessions: 1 },
        { referrer: "iota", sessions: 1 },
        { referrer: "kappa", sessions: 1 },
        { referrer: "theta", sessions: 1 },
        { referrer: "zeta", sessions: 1 },
      ],
    );
  });
});

test("returns no session-ranked referrers when no session starts qualify", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedReferrersBySessions(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid session-ranked-referrer dates and ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedReferrersBySessions(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      {
        message:
          "Ranked referrers by sessions start time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedReferrersBySessions(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      {
        message: "Ranked referrers by sessions end time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedReferrersBySessions(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked referrers by sessions start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedReferrersBySessions(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked referrers by sessions start time must be earlier than end time",
      },
    );
  });
});

test("ranks countries by distinct visitors within one site and half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [
      pageviewSiteId,
      visitorId,
      countryCode,
      countryName,
      occurredAt,
    ] of [
      [siteId, "gb-repeat", "GB", "United Kingdom", "2026-08-09T12:05:00.000Z"],
      [siteId, "gb-repeat", "GB", "UK", "2026-08-09T12:10:00.000Z"],
      [siteId, "gb-repeat", "GB", null, "2026-08-09T12:12:00.000Z"],
      [siteId, "gb-second", "GB", "Britain", "2026-08-09T12:15:00.000Z"],
      [siteId, "shared", "GB", "United Kingdom", "2026-08-09T12:20:00.000Z"],
      [siteId, "us-only", "US", "United States", "2026-08-09T12:25:00.000Z"],
      [siteId, "shared", "US", "USA", "2026-08-09T12:30:00.000Z"],
      [siteId, "de-one", "DE", "Germany", "2026-08-09T12:35:00.000Z"],
      [siteId, "de-two", "DE", "Germany", "2026-08-09T12:40:00.000Z"],
      [siteId, "unknown-repeat", null, null, "2026-08-09T12:45:00.000Z"],
      [siteId, "unknown-repeat", null, "Mystery", "2026-08-09T12:46:00.000Z"],
      [siteId, "unknown-two", null, null, "2026-08-09T12:50:00.000Z"],
      [siteId, "start-boundary", "JP", "Japan", "2026-08-09T12:00:00.000Z"],
      [siteId, "end-boundary", "FR", "France", "2026-08-09T13:00:00.000Z"],
      [siteId, "before-range", "CA", "Canada", "2026-08-09T11:59:59.999Z"],
      [otherSiteId, "other-one", "GB", "United Kingdom", "2026-08-09T12:05:00.000Z"],
      [otherSiteId, "other-two", "GB", "United Kingdom", "2026-08-09T12:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
        geography: {
          countryCode,
          countryName,
          regionCode: null,
          regionName: null,
          cityName: null,
        },
      });
    }

    const rankedCountries: RankedCountryByVisitors[] =
      getRankedCountriesByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      });

    assert.deepEqual(rankedCountries, [
      { countryCode: "GB", countryName: "Britain", visitors: 3 },
      { countryCode: null, countryName: null, visitors: 2 },
      { countryCode: "DE", countryName: "Germany", visitors: 2 },
      { countryCode: "US", countryName: "USA", visitors: 2 },
      { countryCode: "JP", countryName: "Japan", visitors: 1 },
    ]);
  });
});

test("returns no ranked countries when no pageviews match", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedCountriesByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid country-ranking dates and ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedCountriesByVisitors(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      {
        message:
          "Ranked countries by visitors start time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedCountriesByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      {
        message: "Ranked countries by visitors end time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedCountriesByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked countries by visitors start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedCountriesByVisitors(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked countries by visitors start time must be earlier than end time",
      },
    );
  });
});

test("ranks regions by distinct visitors within one site and half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [
      pageviewSiteId,
      visitorId,
      countryCode,
      countryName,
      regionCode,
      regionName,
      occurredAt,
    ] of [
      [siteId, "wa-repeat", "US", "United States", "WA", "Washington", "2026-08-09T12:05:00.000Z"],
      [siteId, "wa-repeat", "US", "United States of America", "WA", "Washington State", "2026-08-09T12:10:00.000Z"],
      [siteId, "wa-repeat", "US", null, "WA", null, "2026-08-09T12:12:00.000Z"],
      [siteId, "shared", "US", "United States", "WA", "Washington", "2026-08-09T12:15:00.000Z"],
      [siteId, "shared", "US", "United States", "CA", "California", "2026-08-09T12:20:00.000Z"],
      [siteId, "ca-only", "US", "United States", "CA", "California", "2026-08-09T12:25:00.000Z"],
      [siteId, "canada-one", "CA", "Canada", "WA", "Western Region", "2026-08-09T12:30:00.000Z"],
      [siteId, "canada-two", "CA", "Canada Alternate", "WA", "Western Area", "2026-08-09T12:35:00.000Z"],
      [siteId, "unknown-us", "US", "United States", null, "Mystery", "2026-08-09T12:40:00.000Z"],
      [siteId, "unknown-us", "US", "United States", null, null, "2026-08-09T12:41:00.000Z"],
      [siteId, "unknown-us-two", "US", "United States", null, null, "2026-08-09T12:42:00.000Z"],
      [siteId, "fully-unknown", null, "Mystery", null, "Mystery", "2026-08-09T12:45:00.000Z"],
      [siteId, "fully-unknown", null, null, null, null, "2026-08-09T12:46:00.000Z"],
      [siteId, "fully-unknown-two", null, null, null, null, "2026-08-09T12:47:00.000Z"],
      [siteId, "start-boundary", "GB", "United Kingdom", "ENG", "England", "2026-08-09T12:00:00.000Z"],
      [siteId, "end-boundary", "FR", "France", "IDF", "Ile-de-France", "2026-08-09T13:00:00.000Z"],
      [siteId, "before-range", "DE", "Germany", "BE", "Berlin", "2026-08-09T11:59:59.999Z"],
      [otherSiteId, "other-one", "US", "United States", "WA", "Washington", "2026-08-09T12:05:00.000Z"],
      [otherSiteId, "other-two", "US", "United States", "WA", "Washington", "2026-08-09T12:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
        geography: {
          countryCode,
          countryName,
          regionCode,
          regionName,
          cityName: null,
        },
      });
    }

    const rankedRegions: RankedRegionByVisitors[] =
      getRankedRegionsByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      });

    assert.deepEqual(rankedRegions, [
      {
        countryCode: null,
        countryName: null,
        regionCode: null,
        regionName: null,
        visitors: 2,
      },
      {
        countryCode: "CA",
        countryName: "Canada",
        regionCode: "WA",
        regionName: "Western Area",
        visitors: 2,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: null,
        regionName: null,
        visitors: 2,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "CA",
        regionName: "California",
        visitors: 2,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        visitors: 2,
      },
      {
        countryCode: "GB",
        countryName: "United Kingdom",
        regionCode: "ENG",
        regionName: "England",
        visitors: 1,
      },
    ]);
  });
});

test("returns no ranked regions when no pageviews match", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedRegionsByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid region-ranking dates and ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedRegionsByVisitors(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      {
        message:
          "Ranked regions by visitors start time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedRegionsByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      {
        message: "Ranked regions by visitors end time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedRegionsByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked regions by visitors start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedRegionsByVisitors(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked regions by visitors start time must be earlier than end time",
      },
    );
  });
});

test("ranks cities by distinct visitors within one site and half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

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
      [siteId, "seattle-repeat", "US", "United States", "WA", "Washington", "Seattle", "2026-08-09T12:05:00.000Z"],
      [siteId, "seattle-repeat", "US", "United States of America", "WA", "Washington State", "Seattle", "2026-08-09T12:10:00.000Z"],
      [siteId, "shared", "US", "United States", "WA", "Washington", "Seattle", "2026-08-09T12:15:00.000Z"],
      [siteId, "shared", "US", "United States", "WA", "Washington", "Portland", "2026-08-09T12:20:00.000Z"],
      [siteId, "wa-portland", "US", "United States", "WA", "Washington", "Portland", "2026-08-09T12:25:00.000Z"],
      [siteId, "ca-portland-one", "US", "United States", "CA", "California", "Portland", "2026-08-09T12:30:00.000Z"],
      [siteId, "ca-portland-two", "US", "United States of America", "CA", "California State", "Portland", "2026-08-09T12:31:00.000Z"],
      [siteId, "canada-portland-one", "CA", "Canada", "BC", "British Columbia", "Portland", "2026-08-09T12:32:00.000Z"],
      [siteId, "canada-portland-two", "CA", "Canada Alternate", "BC", "British Columbia Province", "Portland", "2026-08-09T12:33:00.000Z"],
      [siteId, "unknown-city", "US", "United States", "WA", "Washington", null, "2026-08-09T12:35:00.000Z"],
      [siteId, "unknown-city", "US", "United States of America", "WA", "Washington State", null, "2026-08-09T12:36:00.000Z"],
      [siteId, "unknown-city-two", "US", "United States", "WA", "Washington", null, "2026-08-09T12:37:00.000Z"],
      [siteId, "fully-unknown", null, "Mystery", null, "Mystery", null, "2026-08-09T12:40:00.000Z"],
      [siteId, "fully-unknown", null, null, null, null, null, "2026-08-09T12:41:00.000Z"],
      [siteId, "fully-unknown-two", null, null, null, null, null, "2026-08-09T12:42:00.000Z"],
      [siteId, "start-boundary", "GB", "United Kingdom", "ENG", "England", "London", "2026-08-09T12:00:00.000Z"],
      [siteId, "end-boundary", "FR", "France", "IDF", "Ile-de-France", "Paris", "2026-08-09T13:00:00.000Z"],
      [siteId, "before-range", "DE", "Germany", "BE", "Berlin", "Berlin", "2026-08-09T11:59:59.999Z"],
      [otherSiteId, "other-one", "US", "United States", "WA", "Washington", "Seattle", "2026-08-09T12:05:00.000Z"],
      [otherSiteId, "other-two", "US", "United States", "WA", "Washington", "Seattle", "2026-08-09T12:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
        geography: {
          countryCode,
          countryName,
          regionCode,
          regionName,
          cityName,
        },
      });
    }

    const rankedCities: RankedCityByVisitors[] =
      getRankedCitiesByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      });

    assert.deepEqual(rankedCities, [
      {
        countryCode: null,
        countryName: null,
        regionCode: null,
        regionName: null,
        cityName: null,
        visitors: 2,
      },
      {
        countryCode: "CA",
        countryName: "Canada",
        regionCode: "BC",
        regionName: "British Columbia",
        cityName: "Portland",
        visitors: 2,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "CA",
        regionName: "California",
        cityName: "Portland",
        visitors: 2,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        cityName: null,
        visitors: 2,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        cityName: "Portland",
        visitors: 2,
      },
      {
        countryCode: "US",
        countryName: "United States",
        regionCode: "WA",
        regionName: "Washington",
        cityName: "Seattle",
        visitors: 2,
      },
      {
        countryCode: "GB",
        countryName: "United Kingdom",
        regionCode: "ENG",
        regionName: "England",
        cityName: "London",
        visitors: 1,
      },
    ]);
  });
});

test("returns no ranked cities when no pageviews match", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedCitiesByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid city-ranking dates and ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedCitiesByVisitors(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      {
        message: "Ranked cities by visitors start time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedCitiesByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      {
        message: "Ranked cities by visitors end time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedCitiesByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked cities by visitors start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedCitiesByVisitors(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked cities by visitors start time must be earlier than end time",
      },
    );
  });
});

test("ranks stored browser names by distinct visitors within one site and half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, browserName, occurredAt] of [
      [siteId, "chrome-repeat", "Chrome", "2026-08-09T12:05:00.000Z"],
      [siteId, "chrome-repeat", "Chrome", "2026-08-09T12:06:00.000Z"],
      [siteId, "shared", "Chrome", "2026-08-09T12:10:00.000Z"],
      [siteId, "chrome-only", "Chrome", "2026-08-09T12:15:00.000Z"],
      [siteId, "shared", "Safari", "2026-08-09T12:20:00.000Z"],
      [siteId, "safari-only", "Safari", "2026-08-09T12:25:00.000Z"],
      [siteId, "firefox-one", "Firefox", "2026-08-09T12:30:00.000Z"],
      [siteId, "firefox-two", "Firefox", "2026-08-09T12:35:00.000Z"],
      [siteId, "unknown-repeat", null, "2026-08-09T12:40:00.000Z"],
      [siteId, "unknown-repeat", null, "2026-08-09T12:41:00.000Z"],
      [siteId, "unknown-two", null, "2026-08-09T12:45:00.000Z"],
      [siteId, "start-boundary", "Edge", "2026-08-09T12:00:00.000Z"],
      [siteId, "lowercase-name", "chrome", "2026-08-09T12:50:00.000Z"],
      [siteId, "end-boundary", "Opera", "2026-08-09T13:00:00.000Z"],
      [siteId, "before-range", "Brave", "2026-08-09T11:59:59.999Z"],
      [otherSiteId, "other-one", "Chrome", "2026-08-09T12:05:00.000Z"],
      [otherSiteId, "other-two", "Chrome", "2026-08-09T12:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
        technology: {
          browserName,
          deviceType: null,
          operatingSystemName: null,
        },
      });
    }

    const rankedBrowsers: RankedBrowserByVisitors[] =
      getRankedBrowsersByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      });

    assert.deepEqual(rankedBrowsers, [
      { browserName: "Chrome", visitors: 3 },
      { browserName: null, visitors: 2 },
      { browserName: "Firefox", visitors: 2 },
      { browserName: "Safari", visitors: 2 },
      { browserName: "Edge", visitors: 1 },
      { browserName: "chrome", visitors: 1 },
    ]);
  });
});

test("returns no ranked browsers when no pageviews match", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedBrowsersByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid browser-ranking dates and ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedBrowsersByVisitors(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      {
        message: "Ranked browsers by visitors start time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedBrowsersByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      {
        message: "Ranked browsers by visitors end time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedBrowsersByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked browsers by visitors start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedBrowsersByVisitors(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked browsers by visitors start time must be earlier than end time",
      },
    );
  });
});

test("ranks stored device types by distinct visitors within one site and half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, deviceType, occurredAt] of [
      [siteId, "mobile-repeat", "mobile", "2026-08-09T12:05:00.000Z"],
      [siteId, "mobile-repeat", "mobile", "2026-08-09T12:06:00.000Z"],
      [siteId, "shared", "mobile", "2026-08-09T12:10:00.000Z"],
      [siteId, "mobile-only", "mobile", "2026-08-09T12:15:00.000Z"],
      [siteId, "shared", "tablet", "2026-08-09T12:20:00.000Z"],
      [siteId, "tablet-only", "tablet", "2026-08-09T12:25:00.000Z"],
      [siteId, "desktop-one", "Desktop", "2026-08-09T12:30:00.000Z"],
      [siteId, "desktop-two", "Desktop", "2026-08-09T12:31:00.000Z"],
      [siteId, "lower-one", "desktop", "2026-08-09T12:32:00.000Z"],
      [siteId, "lower-two", "desktop", "2026-08-09T12:33:00.000Z"],
      [siteId, "unknown-repeat", null, "2026-08-09T12:40:00.000Z"],
      [siteId, "unknown-repeat", null, "2026-08-09T12:41:00.000Z"],
      [siteId, "unknown-two", null, "2026-08-09T12:45:00.000Z"],
      [siteId, "start-boundary", "console", "2026-08-09T12:00:00.000Z"],
      [siteId, "end-boundary", "television", "2026-08-09T13:00:00.000Z"],
      [siteId, "before-range", "wearable", "2026-08-09T11:59:59.999Z"],
      [otherSiteId, "other-one", "mobile", "2026-08-09T12:05:00.000Z"],
      [otherSiteId, "other-two", "mobile", "2026-08-09T12:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
        technology: {
          browserName: null,
          deviceType,
          operatingSystemName: null,
        },
      });
    }

    const rankedDeviceTypes: RankedDeviceTypeByVisitors[] =
      getRankedDeviceTypesByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      });

    assert.deepEqual(rankedDeviceTypes, [
      { deviceType: "mobile", visitors: 3 },
      { deviceType: null, visitors: 2 },
      { deviceType: "Desktop", visitors: 2 },
      { deviceType: "desktop", visitors: 2 },
      { deviceType: "tablet", visitors: 2 },
      { deviceType: "console", visitors: 1 },
    ]);
  });
});

test("returns no ranked device types when no pageviews match", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedDeviceTypesByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid device-type-ranking dates and ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedDeviceTypesByVisitors(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      {
        message:
          "Ranked device types by visitors start time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedDeviceTypesByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      {
        message: "Ranked device types by visitors end time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedDeviceTypesByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked device types by visitors start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedDeviceTypesByVisitors(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked device types by visitors start time must be earlier than end time",
      },
    );
  });
});

test("ranks stored operating systems by distinct visitors within one site and half-open range", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const otherSiteId = registerSite(database, {
      name: "Other Site",
      domain: "other.example",
    }).id;

    for (const [pageviewSiteId, visitorId, operatingSystemName, occurredAt] of [
      [siteId, "windows-repeat", "Windows", "2026-08-09T12:05:00.000Z"],
      [siteId, "windows-repeat", "Windows", "2026-08-09T12:06:00.000Z"],
      [siteId, "shared", "Windows", "2026-08-09T12:10:00.000Z"],
      [siteId, "windows-only", "Windows", "2026-08-09T12:15:00.000Z"],
      [siteId, "shared", "macOS", "2026-08-09T12:20:00.000Z"],
      [siteId, "mac-only", "macOS", "2026-08-09T12:25:00.000Z"],
      [siteId, "linux-one", "Linux", "2026-08-09T12:30:00.000Z"],
      [siteId, "linux-two", "Linux", "2026-08-09T12:31:00.000Z"],
      [siteId, "android-one", "Android", "2026-08-09T12:32:00.000Z"],
      [siteId, "android-two", "Android", "2026-08-09T12:33:00.000Z"],
      [siteId, "lower-one", "android", "2026-08-09T12:34:00.000Z"],
      [siteId, "lower-two", "android", "2026-08-09T12:35:00.000Z"],
      [siteId, "unknown-repeat", null, "2026-08-09T12:40:00.000Z"],
      [siteId, "unknown-repeat", null, "2026-08-09T12:41:00.000Z"],
      [siteId, "unknown-two", null, "2026-08-09T12:45:00.000Z"],
      [siteId, "start-boundary", "FreeBSD", "2026-08-09T12:00:00.000Z"],
      [siteId, "end-boundary", "iOS", "2026-08-09T13:00:00.000Z"],
      [siteId, "before-range", "Chrome OS", "2026-08-09T11:59:59.999Z"],
      [otherSiteId, "other-one", "Windows", "2026-08-09T12:05:00.000Z"],
      [otherSiteId, "other-two", "Windows", "2026-08-09T12:10:00.000Z"],
    ] as const) {
      recordPageview(database, {
        siteId: pageviewSiteId,
        visitorId,
        path: "/",
        occurredAt: new Date(occurredAt),
        technology: {
          browserName: null,
          deviceType: null,
          operatingSystemName,
        },
      });
    }

    const rankedOperatingSystems: RankedOperatingSystemByVisitors[] =
      getRankedOperatingSystemsByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      });

    assert.deepEqual(rankedOperatingSystems, [
      { operatingSystemName: "Windows", visitors: 3 },
      { operatingSystemName: null, visitors: 2 },
      { operatingSystemName: "Android", visitors: 2 },
      { operatingSystemName: "Linux", visitors: 2 },
      { operatingSystemName: "android", visitors: 2 },
      { operatingSystemName: "macOS", visitors: 2 },
      { operatingSystemName: "FreeBSD", visitors: 1 },
    ]);
  });
});

test("returns no ranked operating systems when no pageviews match", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);

    assert.deepEqual(
      getRankedOperatingSystemsByVisitors(database, {
        siteId,
        startAt: new Date("2026-08-09T12:00:00.000Z"),
        endAt: new Date("2026-08-09T13:00:00.000Z"),
      }),
      [],
    );
  });
});

test("rejects invalid operating-system-ranking dates and ranges", () => {
  withTemporaryDatabase((database) => {
    const siteId = initializeRegisteredSite(database);
    const startAt = new Date("2026-08-09T12:00:00.000Z");
    const endAt = new Date("2026-08-09T13:00:00.000Z");

    assert.throws(
      () =>
        getRankedOperatingSystemsByVisitors(database, {
          siteId,
          startAt: new Date(Number.NaN),
          endAt,
        }),
      {
        message:
          "Ranked operating systems by visitors start time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedOperatingSystemsByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(Number.NaN),
        }),
      {
        message:
          "Ranked operating systems by visitors end time must be a valid date",
      },
    );
    assert.throws(
      () =>
        getRankedOperatingSystemsByVisitors(database, {
          siteId,
          startAt,
          endAt: new Date(startAt),
        }),
      {
        message:
          "Ranked operating systems by visitors start time must be earlier than end time",
      },
    );
    assert.throws(
      () =>
        getRankedOperatingSystemsByVisitors(database, {
          siteId,
          startAt: endAt,
          endAt: startAt,
        }),
      {
        message:
          "Ranked operating systems by visitors start time must be earlier than end time",
      },
    );
  });
});
