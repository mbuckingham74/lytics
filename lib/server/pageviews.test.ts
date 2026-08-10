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
  getRankedEntryPages,
  getRankedExitPages,
  getRankedPages,
  getRankedPagesBySessions,
  getRankedReferrers,
  getRankedReferrersBySessions,
  getSessionCount,
  initializePageviews,
  recordPageview,
} from "./pageviews";
import type { RankedReferrerBySessions } from "./pageviews";
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
    });

    assert.deepEqual(pageview, {
      id: 1,
      siteId,
      visitorId: "visitor-1",
      path: "/writing/hello",
      referrer: "https://example.com/source",
      occurredAt,
    });
    assert.deepEqual(
      {
        ...database
          .prepare(
            "SELECT id, site_id, visitor_id, path, referrer, occurred_at FROM pageviews",
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
    });

    database.close();
    const reopenedDatabase = openDatabase(filePath);

    try {
      assert.deepEqual(
        {
          ...reopenedDatabase
            .prepare(
              "SELECT site_id, visitor_id, path, referrer, occurred_at FROM pageviews",
            )
            .get(),
        },
        {
          site_id: siteId,
          visitor_id: "visitor-2",
          path: "/archive",
          referrer: null,
          occurred_at: occurredAt.getTime(),
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
