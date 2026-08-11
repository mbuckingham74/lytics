import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "./database";
import type { Geography } from "./geolocation";
import { initializePageviews, recordPageview } from "./pageviews";
import {
  findSiteByDomain,
  initializeSites,
  listSiteTrackingSummaries,
  listSites,
  registerSite,
  updateSite,
} from "./sites";
import type { Technology } from "./technology";

const utcSummaryInput = {
  nowAt: new Date("2026-08-10T12:00:00.000Z"),
  timeZone: "UTC",
};

function geography(overrides: Partial<Geography> = {}): Geography {
  return {
    countryCode: null,
    countryName: null,
    regionCode: null,
    regionName: null,
    cityName: null,
    ...overrides,
  };
}

function technology(overrides: Partial<Technology> = {}): Technology {
  return {
    browserName: null,
    deviceType: null,
    operatingSystemName: null,
    ...overrides,
  };
}

function withTemporaryDatabase(
  run: (database: ReturnType<typeof openDatabase>, filePath: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "lytics-sites-"));
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

test("initializes the sites table idempotently without losing data", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializeSites(database);

    const site = registerSite(database, {
      name: "Personal Site",
      domain: "personal.example",
    });

    initializeSites(database);

    assert.deepEqual(listSites(database), [site]);
    assert.deepEqual(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
      ["sites"],
    );
    assert.deepEqual(
      database
        .prepare("PRAGMA table_info(sites)")
        .all()
        .filter((row) => row.name === "registered_at")
        .map((row) => ({
          name: row.name,
          type: row.type,
          notNull: row.notnull,
          defaultValue: row.dflt_value,
        })),
      [
        {
          name: "registered_at",
          type: "INTEGER",
          notNull: 0,
          defaultValue: null,
        },
      ],
    );
  });
});

test("migrates legacy sites once without fabricating registration timestamps", () => {
  withTemporaryDatabase((database) => {
    database.exec(`
      CREATE TABLE sites (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        domain TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(domain)) > 0)
      );
      INSERT INTO sites (id, name, domain)
      VALUES (7, 'Legacy Site', 'legacy.example');
    `);

    initializeSites(database);
    initializeSites(database);

    const legacySite = {
      id: 7,
      name: "Legacy Site",
      domain: "legacy.example",
    };

    assert.deepEqual(listSites(database), [legacySite]);
    assert.equal(
      database
        .prepare("PRAGMA table_info(sites)")
        .all()
        .filter((row) => row.name === "registered_at").length,
      1,
    );
    assert.equal(
      database.prepare("SELECT registered_at FROM sites WHERE id = 7").get()
        ?.registered_at,
      null,
    );

    initializePageviews(database);
    assert.deepEqual(listSiteTrackingSummaries(database, utcSummaryInput), [
      {
        ...legacySite,
        registeredAt: null,
        eventsToday: 0,
        geographyEnrichedEventsToday: 0,
        technologyEnrichedEventsToday: 0,
        totalPageviews: 0,
        lastPageviewAt: null,
      },
    ]);
  });
});

test("registers normalized sites and lists them in registration order", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);

    const first = registerSite(database, {
      name: "  Personal Site  ",
      domain: "  PERSONAL.Example  ",
    });
    const second = registerSite(database, {
      name: "Notes",
      domain: "notes.example",
    });

    assert.deepEqual(first, {
      id: 1,
      name: "Personal Site",
      domain: "personal.example",
    });
    assert.deepEqual(listSites(database), [first, second]);
  });
});

test("persists a current registration timestamp without changing the Site shape", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);
    const beforeRegistration = Date.now();

    const site = registerSite(database, {
      name: "Timestamped Site",
      domain: "timestamped.example",
    });
    const afterRegistration = Date.now();
    const registeredAt = database
      .prepare("SELECT registered_at FROM sites WHERE id = ?")
      .get(site.id)?.registered_at;

    assert.deepEqual(site, {
      id: 1,
      name: "Timestamped Site",
      domain: "timestamped.example",
    });
    assert.equal(typeof registeredAt, "number");
    assert.equal(Number.isFinite(registeredAt), true);
    assert.equal(Number.isInteger(registeredAt), true);
    assert.ok((registeredAt as number) >= beforeRegistration);
    assert.ok((registeredAt as number) <= afterRegistration);
    assert.deepEqual(listSiteTrackingSummaries(database, utcSummaryInput), [
      {
        ...site,
        registeredAt: new Date(registeredAt as number),
        eventsToday: 0,
        geographyEnrichedEventsToday: 0,
        technologyEnrichedEventsToday: 0,
        totalPageviews: 0,
        lastPageviewAt: null,
      },
    ]);
  });
});

test("persists sites after the database is closed and reopened", () => {
  withTemporaryDatabase((database, filePath) => {
    initializeSites(database);
    const site = registerSite(database, {
      name: "Journal",
      domain: "journal.example",
    });
    const registeredAt = database
      .prepare("SELECT registered_at FROM sites WHERE id = ?")
      .get(site.id)?.registered_at;

    database.close();
    const reopenedDatabase = openDatabase(filePath);

    try {
      assert.deepEqual(listSites(reopenedDatabase), [site]);
      assert.equal(
        reopenedDatabase
          .prepare("SELECT registered_at FROM sites WHERE id = ?")
          .get(site.id)?.registered_at,
        registeredAt,
      );
    } finally {
      reopenedDatabase.close();
    }
  });
});

test("updates only site metadata while preserving identity and analytics", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);
    const first = registerSite(database, {
      name: "First",
      domain: "first.example",
    });
    const second = registerSite(database, {
      name: "Second",
      domain: "second.example",
    });
    const registeredAt = database
      .prepare("SELECT registered_at FROM sites WHERE id = ?")
      .get(first.id)?.registered_at;

    recordPageview(database, {
      siteId: first.id,
      visitorId: "first-visitor",
      path: "/first",
      occurredAt: new Date("2026-08-10T10:00:00.000Z"),
    });
    recordPageview(database, {
      siteId: second.id,
      visitorId: "second-visitor",
      path: "/second",
      occurredAt: new Date("2026-08-10T11:00:00.000Z"),
    });
    const pageviewsBefore = database
      .prepare("SELECT * FROM pageviews ORDER BY id ASC")
      .all();

    const updated = updateSite(database, {
      siteId: first.id,
      name: "  Renamed First  ",
      domain: "  MOVED.Example  ",
    });

    assert.deepEqual(updated, {
      id: first.id,
      name: "Renamed First",
      domain: "moved.example",
    });
    assert.deepEqual(Object.keys(updated ?? {}).sort(), ["domain", "id", "name"]);
    assert.deepEqual(listSites(database), [updated, second]);
    assert.equal(findSiteByDomain(database, "first.example"), null);
    assert.deepEqual(findSiteByDomain(database, "MOVED.EXAMPLE"), updated);
    assert.equal(
      database.prepare("SELECT registered_at FROM sites WHERE id = ?").get(first.id)
        ?.registered_at,
      registeredAt,
    );
    assert.deepEqual(
      database.prepare("SELECT * FROM pageviews ORDER BY id ASC").all(),
      pageviewsBefore,
    );

    const summaries = listSiteTrackingSummaries(database, utcSummaryInput);
    assert.deepEqual(
      summaries.map(({ id, name, domain, totalPageviews }) => ({
        id,
        name,
        domain,
        totalPageviews,
      })),
      [
        { ...updated, totalPageviews: 1 },
        { ...second, totalPageviews: 1 },
      ],
    );
  });
});

test("returns null for a missing site update without changing persisted rows", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    const site = registerSite(database, {
      name: "Existing",
      domain: "existing.example",
    });
    const registeredAt = database
      .prepare("SELECT registered_at FROM sites WHERE id = ?")
      .get(site.id)?.registered_at;

    assert.equal(
      updateSite(database, {
        siteId: 999,
        name: "Missing",
        domain: "missing.example",
      }),
      null,
    );
    assert.deepEqual(
      updateSite(database, {
        siteId: site.id,
        name: site.name,
        domain: site.domain,
      }),
      site,
    );
    assert.deepEqual(listSites(database), [site]);
    assert.equal(
      database.prepare("SELECT registered_at FROM sites WHERE id = ?").get(site.id)
        ?.registered_at,
      registeredAt,
    );
  });
});

test("rejects blank site names and domains", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);

    assert.throws(
      () => registerSite(database, { name: "   ", domain: "site.example" }),
      /name cannot be blank/i,
    );
    assert.throws(
      () => registerSite(database, { name: "Site", domain: "   " }),
      /domain cannot be blank/i,
    );
    assert.deepEqual(listSites(database), []);
  });
});

test("rejects domains that differ only by letter case", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    registerSite(database, {
      name: "Personal Site",
      domain: "personal.example",
    });

    assert.throws(() =>
      registerSite(database, {
        name: "Duplicate",
        domain: "PERSONAL.EXAMPLE",
      }),
    );
    assert.deepEqual(listSites(database), [
      { id: 1, name: "Personal Site", domain: "personal.example" },
    ]);
  });
});

test("finds sites by exact case-insensitive normalized domain", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    const apex = registerSite(database, {
      name: "Apex",
      domain: "example.com",
    });
    const www = registerSite(database, {
      name: "WWW",
      domain: "www.example.com",
    });

    assert.deepEqual(findSiteByDomain(database, "  EXAMPLE.COM  "), apex);
    assert.deepEqual(findSiteByDomain(database, "WWW.Example.Com"), www);
    assert.equal(findSiteByDomain(database, "sub.example.com"), null);
    assert.equal(findSiteByDomain(database, "notexample.com"), null);
    assert.equal(findSiteByDomain(database, ""), null);
  });
});

test("lists no tracking summaries when no sites are registered", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);

    assert.deepEqual(
      listSiteTrackingSummaries(database, utcSummaryInput),
      [],
    );
  });
});

test("summarizes each site's isolated tracking data in registration order", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);

    const first = registerSite(database, {
      name: "First",
      domain: "first.example",
    });
    const second = registerSite(database, {
      name: "Second",
      domain: "second.example",
    });
    const third = registerSite(database, {
      name: "No Data",
      domain: "no-data.example",
    });
    const firstLatest = new Date("2026-08-10T18:00:00.000Z");
    const secondLatest = new Date("2026-08-09T09:30:00.000Z");

    recordPageview(database, {
      siteId: first.id,
      visitorId: "first-latest",
      path: "/latest",
      occurredAt: firstLatest,
    });
    recordPageview(database, {
      siteId: second.id,
      visitorId: "second-only",
      path: "/",
      occurredAt: secondLatest,
    });
    recordPageview(database, {
      siteId: first.id,
      visitorId: "first-earlier",
      path: "/earlier",
      occurredAt: new Date("2026-08-08T10:00:00.000Z"),
    });
    recordPageview(database, {
      siteId: first.id,
      visitorId: "first-middle",
      path: "/middle",
      occurredAt: new Date("2026-08-09T12:00:00.000Z"),
    });

    const summaries = listSiteTrackingSummaries(database, utcSummaryInput);

    assert.deepEqual(
      summaries.map(({ id, name, domain }) => ({ id, name, domain })),
      listSites(database),
    );
    assert.equal(
      summaries.every((summary) => summary.registeredAt instanceof Date),
      true,
    );
    assert.deepEqual(
      summaries.map(({ registeredAt: _registeredAt, ...summary }) => summary),
      [
        {
          ...first,
          eventsToday: 1,
          geographyEnrichedEventsToday: 0,
          technologyEnrichedEventsToday: 0,
          totalPageviews: 3,
          lastPageviewAt: firstLatest,
        },
        {
          ...second,
          eventsToday: 0,
          geographyEnrichedEventsToday: 0,
          technologyEnrichedEventsToday: 0,
          totalPageviews: 1,
          lastPageviewAt: secondLatest,
        },
        {
          ...third,
          eventsToday: 0,
          geographyEnrichedEventsToday: 0,
          technologyEnrichedEventsToday: 0,
          totalPageviews: 0,
          lastPageviewAt: null,
        },
      ],
    );
  });
});

test("counts independent geography and technology evidence for today's events", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);

    const first = registerSite(database, {
      name: "First",
      domain: "first.example",
    });
    const second = registerSite(database, {
      name: "Second",
      domain: "second.example",
    });
    const third = registerSite(database, {
      name: "No Data",
      domain: "no-data.example",
    });
    const geographyEvidence = [
      geography({ countryCode: "US" }),
      geography({ countryName: "United States" }),
      geography({ regionCode: "CA" }),
      geography({ regionName: "California" }),
      geography({ cityName: "Los Angeles" }),
    ];
    const technologyEvidence = [
      technology({ browserName: "Browser" }),
      technology({ deviceType: "desktop" }),
      technology({ operatingSystemName: "Operating system" }),
    ];

    geographyEvidence.forEach((evidence, index) => {
      recordPageview(database, {
        siteId: first.id,
        visitorId: `geography-${index}`,
        path: "/",
        occurredAt: new Date(`2026-08-10T0${index}:00:00.000Z`),
        geography: evidence,
      });
    });
    technologyEvidence.forEach((evidence, index) => {
      recordPageview(database, {
        siteId: first.id,
        visitorId: `technology-${index}`,
        path: "/",
        occurredAt: new Date(`2026-08-10T0${index + 5}:00:00.000Z`),
        technology: evidence,
      });
    });
    recordPageview(database, {
      siteId: first.id,
      visitorId: "both",
      path: "/",
      occurredAt: new Date("2026-08-10T08:00:00.000Z"),
      geography: geography({ cityName: "Los Angeles" }),
      technology: technology({ browserName: "Browser" }),
    });
    recordPageview(database, {
      siteId: first.id,
      visitorId: "all-null",
      path: "/",
      occurredAt: new Date("2026-08-10T09:00:00.000Z"),
      geography: geography(),
      technology: technology(),
    });
    recordPageview(database, {
      siteId: first.id,
      visitorId: "blank-but-non-null",
      path: "/",
      occurredAt: new Date("2026-08-10T10:00:00.000Z"),
      geography: geography({ cityName: "" }),
      technology: technology({ browserName: "" }),
    });

    for (const [visitorId, occurredAt] of [
      ["before-day", new Date("2026-08-09T23:59:59.999Z")],
      ["next-day-start", new Date("2026-08-11T00:00:00.000Z")],
    ] as const) {
      recordPageview(database, {
        siteId: first.id,
        visitorId,
        path: "/",
        occurredAt,
        geography: geography({ countryCode: "US" }),
        technology: technology({ browserName: "Browser" }),
      });
    }

    recordPageview(database, {
      siteId: second.id,
      visitorId: "other-site-both",
      path: "/",
      occurredAt: new Date("2026-08-10T11:00:00.000Z"),
      geography: geography({ countryCode: "CA" }),
      technology: technology({ deviceType: "mobile" }),
    });

    const summaries = listSiteTrackingSummaries(database, utcSummaryInput);

    assert.deepEqual(
      summaries.map(({ registeredAt: _registeredAt, ...summary }) => summary),
      [
        {
          ...first,
          eventsToday: 11,
          geographyEnrichedEventsToday: 7,
          technologyEnrichedEventsToday: 5,
          totalPageviews: 13,
          lastPageviewAt: new Date("2026-08-11T00:00:00.000Z"),
        },
        {
          ...second,
          eventsToday: 1,
          geographyEnrichedEventsToday: 1,
          technologyEnrichedEventsToday: 1,
          totalPageviews: 1,
          lastPageviewAt: new Date("2026-08-10T11:00:00.000Z"),
        },
        {
          ...third,
          eventsToday: 0,
          geographyEnrichedEventsToday: 0,
          technologyEnrichedEventsToday: 0,
          totalPageviews: 0,
          lastPageviewAt: null,
        },
      ],
    );
  });
});

test("counts exact reporting-day boundaries across Los Angeles DST transitions", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);

    const first = registerSite(database, {
      name: "First",
      domain: "first.example",
    });
    const second = registerSite(database, {
      name: "Second",
      domain: "second.example",
    });
    const third = registerSite(database, {
      name: "No Data",
      domain: "no-data.example",
    });
    const springStart = new Date("2026-03-08T08:00:00.000Z");
    const springEnd = new Date("2026-03-09T07:00:00.000Z");
    const fallStart = new Date("2026-11-01T07:00:00.000Z");
    const fallEnd = new Date("2026-11-02T08:00:00.000Z");

    for (const [visitorId, occurredAt] of [
      ["spring-start", springStart],
      ["spring-last-millisecond", new Date(springEnd.getTime() - 1)],
      ["spring-next-day-start", springEnd],
      ["fall-start", fallStart],
      ["fall-last-millisecond", new Date(fallEnd.getTime() - 1)],
      ["fall-next-day-start", fallEnd],
    ] as const) {
      recordPageview(database, {
        siteId: first.id,
        visitorId,
        path: "/",
        occurredAt,
        geography: geography({ countryCode: "US" }),
        technology: technology({ browserName: "Browser" }),
      });
    }

    recordPageview(database, {
      siteId: second.id,
      visitorId: "isolated-spring-start",
      path: "/",
      occurredAt: springStart,
      geography: geography({ countryCode: "CA" }),
      technology: technology({ browserName: "Other browser" }),
    });

    const springSummaries = listSiteTrackingSummaries(database, {
      nowAt: new Date("2026-03-08T20:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    const fallSummaries = listSiteTrackingSummaries(database, {
      nowAt: new Date("2026-11-01T20:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });

    assert.deepEqual(
      springSummaries.map(
        ({
          id,
          eventsToday,
          geographyEnrichedEventsToday,
          technologyEnrichedEventsToday,
          totalPageviews,
          lastPageviewAt,
        }) => ({
          id,
          eventsToday,
          geographyEnrichedEventsToday,
          technologyEnrichedEventsToday,
          totalPageviews,
          lastPageviewAt,
        }),
      ),
      [
        {
          id: first.id,
          eventsToday: 2,
          geographyEnrichedEventsToday: 2,
          technologyEnrichedEventsToday: 2,
          totalPageviews: 6,
          lastPageviewAt: fallEnd,
        },
        {
          id: second.id,
          eventsToday: 1,
          geographyEnrichedEventsToday: 1,
          technologyEnrichedEventsToday: 1,
          totalPageviews: 1,
          lastPageviewAt: springStart,
        },
        {
          id: third.id,
          eventsToday: 0,
          geographyEnrichedEventsToday: 0,
          technologyEnrichedEventsToday: 0,
          totalPageviews: 0,
          lastPageviewAt: null,
        },
      ],
    );
    assert.deepEqual(
      fallSummaries.map(
        ({
          id,
          eventsToday,
          geographyEnrichedEventsToday,
          technologyEnrichedEventsToday,
          totalPageviews,
        }) => ({
          id,
          eventsToday,
          geographyEnrichedEventsToday,
          technologyEnrichedEventsToday,
          totalPageviews,
        }),
      ),
      [
        {
          id: first.id,
          eventsToday: 2,
          geographyEnrichedEventsToday: 2,
          technologyEnrichedEventsToday: 2,
          totalPageviews: 6,
        },
        {
          id: second.id,
          eventsToday: 0,
          geographyEnrichedEventsToday: 0,
          technologyEnrichedEventsToday: 0,
          totalPageviews: 1,
        },
        {
          id: third.id,
          eventsToday: 0,
          geographyEnrichedEventsToday: 0,
          technologyEnrichedEventsToday: 0,
          totalPageviews: 0,
        },
      ],
    );
  });
});

test("rejects invalid tracking-summary dates and time zones", () => {
  withTemporaryDatabase((database) => {
    initializeSites(database);
    initializePageviews(database);

    assert.throws(
      () => listSiteTrackingSummaries(database, {
        nowAt: new Date(Number.NaN),
        timeZone: "UTC",
      }),
      { message: "nowAt must be a valid Date" },
    );
    assert.throws(
      () => listSiteTrackingSummaries(database, {
        nowAt: new Date("2026-08-10T12:00:00.000Z"),
        timeZone: "Not/A_Time_Zone",
      }),
      { message: "timeZone must be a valid IANA time zone" },
    );
  });
});
