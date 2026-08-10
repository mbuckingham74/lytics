import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "./database";
import { initializePageviews, recordPageview } from "./pageviews";
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
