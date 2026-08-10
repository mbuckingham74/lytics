import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "./database";
import {
  getPageviewSummary,
  getRankedPages,
  getRankedReferrers,
  initializePageviews,
  recordPageview,
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
