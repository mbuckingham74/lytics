import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializePageviews, recordPageview } from "./pageviews";
import {
  deleteSiteAtBoundary,
  resetSiteAnalyticsAtBoundary,
} from "./site-data-management";
import { initializeSites, listSites, registerSite } from "./sites";

function withDatabase(run: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(":memory:");

  try {
    database.exec("PRAGMA foreign_keys = ON");
    initializeSites(database);
    initializePageviews(database);
    run(database);
  } finally {
    database.close();
  }
}

test("resets only the selected site's analytics and returns the exact count", () => {
  withDatabase((database) => {
    const target = registerSite(database, {
      name: "Target",
      domain: "target.example",
    });
    const other = registerSite(database, {
      name: "Other",
      domain: "other.example",
    });

    recordPageview(database, {
      siteId: target.id,
      visitorId: "target-1",
      path: "/",
      occurredAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    recordPageview(database, {
      siteId: other.id,
      visitorId: "other-1",
      path: "/kept",
      referrer: "https://referrer.example/",
      occurredAt: new Date("2026-08-10T09:00:00.000Z"),
      geography: {
        countryCode: "US",
        countryName: "United States",
        regionCode: "CA",
        regionName: "California",
        cityName: "Oakland",
      },
      technology: {
        browserName: "Firefox",
        deviceType: "desktop",
        operatingSystemName: "Linux",
      },
    });
    recordPageview(database, {
      siteId: target.id,
      visitorId: "target-2",
      path: "/about",
      occurredAt: new Date("2026-08-10T10:00:00.000Z"),
    });
    recordPageview(database, {
      siteId: target.id,
      visitorId: "target-3",
      path: "/contact",
      occurredAt: new Date("2026-08-10T11:00:00.000Z"),
    });
    recordPageview(database, {
      siteId: other.id,
      visitorId: "other-2",
      path: "/also-kept",
      occurredAt: new Date("2026-08-10T12:00:00.000Z"),
    });

    const otherPageviewsBefore = database
      .prepare("SELECT * FROM pageviews WHERE site_id = ? ORDER BY id ASC")
      .all(other.id);

    assert.deepEqual(resetSiteAnalyticsAtBoundary(database, target.id), {
      ok: true,
      deletedPageviews: 3,
    });
    assert.deepEqual(
      database
        .prepare("SELECT * FROM pageviews WHERE site_id = ? ORDER BY id ASC")
        .all(target.id),
      [],
    );
    assert.deepEqual(
      database
        .prepare("SELECT * FROM pageviews WHERE site_id = ? ORDER BY id ASC")
        .all(other.id),
      otherPageviewsBefore,
    );
    assert.deepEqual(listSites(database), [target, other]);
    assert.deepEqual(resetSiteAnalyticsAtBoundary(database, target.id), {
      ok: true,
      deletedPageviews: 0,
    });
  });
});

test("succeeds with zero deletions for an existing site without pageviews", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Empty",
      domain: "empty.example",
    });

    assert.deepEqual(resetSiteAnalyticsAtBoundary(database, site.id), {
      ok: true,
      deletedPageviews: 0,
    });
    assert.deepEqual(listSites(database), [site]);
  });
});

test("rejects invalid and unknown site IDs without deleting data", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Preserved",
      domain: "preserved.example",
    });
    recordPageview(database, {
      siteId: site.id,
      visitorId: "preserved-visitor",
      path: "/",
      occurredAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    const pageviewsBefore = database
      .prepare("SELECT * FROM pageviews ORDER BY id ASC")
      .all();

    for (const invalidSiteId of [
      null,
      undefined,
      "1",
      true,
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.deepEqual(
        resetSiteAnalyticsAtBoundary(database, invalidSiteId),
        { ok: false, message: "Select a valid site." },
      );
    }

    assert.deepEqual(resetSiteAnalyticsAtBoundary(database, 999), {
      ok: false,
      message: "That site is not registered.",
    });
    assert.deepEqual(
      database.prepare("SELECT * FROM pageviews ORDER BY id ASC").all(),
      pageviewsBefore,
    );
    assert.deepEqual(listSites(database), [site]);
  });
});

test("contains unexpected database failures behind a stable safe message", () => {
  const database = new DatabaseSync(":memory:");

  try {
    initializeSites(database);
    const site = registerSite(database, {
      name: "Missing pageviews table",
      domain: "failure.example",
    });

    const result = resetSiteAnalyticsAtBoundary(database, site.id);

    assert.deepEqual(result, {
      ok: false,
      message: "Could not reset site analytics. Try again.",
    });
    assert.equal(result.ok ? "" : /sqlite|pageviews|table/i.test(result.message), false);
    assert.deepEqual(listSites(database), [site]);
  } finally {
    database.close();
  }
});

test("deletes exactly one site and only its fully populated pageviews", () => {
  withDatabase((database) => {
    const target = registerSite(database, {
      name: "Target",
      domain: "target.example",
    });
    const other = registerSite(database, {
      name: "Other",
      domain: "other.example",
    });

    for (const [siteId, visitorId, path, referrer, occurredAt, cityName] of [
      [
        target.id,
        "target-1",
        "/target-one",
        "https://target-referrer.example/one",
        new Date("2026-08-10T08:00:00.000Z"),
        "Oakland",
      ],
      [
        other.id,
        "other-1",
        "/other-one",
        "https://other-referrer.example/one",
        new Date("2026-08-10T09:00:00.000Z"),
        "Berkeley",
      ],
      [
        target.id,
        "target-2",
        "/target-two",
        "https://target-referrer.example/two",
        new Date("2026-08-10T10:00:00.000Z"),
        "San Francisco",
      ],
      [
        other.id,
        "other-2",
        "/other-two",
        "https://other-referrer.example/two",
        new Date("2026-08-10T11:00:00.000Z"),
        "San Jose",
      ],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path,
        referrer,
        occurredAt,
        geography: {
          countryCode: "US",
          countryName: "United States",
          regionCode: "CA",
          regionName: "California",
          cityName,
        },
        technology: {
          browserName: "Firefox",
          deviceType: "desktop",
          operatingSystemName: "Linux",
        },
      });
    }

    const otherSiteBefore = database
      .prepare("SELECT * FROM sites WHERE id = ?")
      .get(other.id);
    const otherPageviewsBefore = database
      .prepare("SELECT * FROM pageviews WHERE site_id = ? ORDER BY id ASC")
      .all(other.id);

    assert.deepEqual(deleteSiteAtBoundary(database, target.id), {
      ok: true,
      deletedSites: 1,
      deletedPageviews: 2,
    });
    assert.equal(
      database.prepare("SELECT * FROM sites WHERE id = ?").get(target.id),
      undefined,
    );
    assert.deepEqual(
      database
        .prepare("SELECT * FROM pageviews WHERE site_id = ? ORDER BY id ASC")
        .all(target.id),
      [],
    );
    assert.deepEqual(
      database.prepare("SELECT * FROM sites WHERE id = ?").get(other.id),
      otherSiteBefore,
    );
    assert.deepEqual(
      database
        .prepare("SELECT * FROM pageviews WHERE site_id = ? ORDER BY id ASC")
        .all(other.id),
      otherPageviewsBefore,
    );
    assert.deepEqual(listSites(database), [other]);
    assert.deepEqual(deleteSiteAtBoundary(database, target.id), {
      ok: false,
      message: "That site is not registered.",
    });
  });
});

test("deletes an existing empty site with exact zero pageviews", () => {
  withDatabase((database) => {
    const empty = registerSite(database, {
      name: "Empty",
      domain: "empty.example",
    });

    assert.deepEqual(deleteSiteAtBoundary(database, empty.id), {
      ok: true,
      deletedSites: 1,
      deletedPageviews: 0,
    });
    assert.deepEqual(listSites(database), []);
  });
});

test("rejects invalid and unknown deletion IDs without mutation", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Preserved",
      domain: "preserved.example",
    });
    recordPageview(database, {
      siteId: site.id,
      visitorId: "preserved-visitor",
      path: "/",
      occurredAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    const sitesBefore = database.prepare("SELECT * FROM sites ORDER BY id").all();
    const pageviewsBefore = database
      .prepare("SELECT * FROM pageviews ORDER BY id")
      .all();

    for (const invalidSiteId of [
      null,
      undefined,
      "1",
      true,
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.deepEqual(deleteSiteAtBoundary(database, invalidSiteId), {
        ok: false,
        message: "Select a valid site.",
      });
    }

    assert.deepEqual(deleteSiteAtBoundary(database, 999), {
      ok: false,
      message: "That site is not registered.",
    });
    assert.deepEqual(database.prepare("SELECT * FROM sites ORDER BY id").all(), sitesBefore);
    assert.deepEqual(
      database.prepare("SELECT * FROM pageviews ORDER BY id").all(),
      pageviewsBefore,
    );
  });
});

test("rolls back pageview deletion when the site-row delete fails", () => {
  withDatabase((database) => {
    const target = registerSite(database, {
      name: "Target",
      domain: "target.example",
    });
    const other = registerSite(database, {
      name: "Other",
      domain: "other.example",
    });

    for (const [siteId, visitorId] of [
      [target.id, "target-1"],
      [target.id, "target-2"],
      [other.id, "other-1"],
    ] as const) {
      recordPageview(database, {
        siteId,
        visitorId,
        path: `/${visitorId}`,
        occurredAt: new Date("2026-08-10T08:00:00.000Z"),
      });
    }

    const sitesBefore = database.prepare("SELECT * FROM sites ORDER BY id").all();
    const pageviewsBefore = database
      .prepare("SELECT * FROM pageviews ORDER BY id")
      .all();
    database.exec(`
      CREATE TRIGGER fail_target_site_delete
      BEFORE DELETE ON sites
      WHEN OLD.id = ${target.id}
      BEGIN
        SELECT RAISE(ABORT, 'forced internal deletion failure');
      END
    `);

    const result = deleteSiteAtBoundary(database, target.id);

    assert.deepEqual(result, {
      ok: false,
      message: "Could not delete the site. Try again.",
    });
    assert.equal(
      result.ok ? "" : /sqlite|trigger|forced|internal/i.test(result.message),
      false,
    );
    assert.deepEqual(database.prepare("SELECT * FROM sites ORDER BY id").all(), sitesBefore);
    assert.deepEqual(
      database.prepare("SELECT * FROM pageviews ORDER BY id").all(),
      pageviewsBefore,
    );

    database.exec("DROP TRIGGER fail_target_site_delete");
    assert.deepEqual(deleteSiteAtBoundary(database, target.id), {
      ok: true,
      deletedSites: 1,
      deletedPageviews: 2,
    });
  });
});

test("composes site deletion inside a surrounding transaction", () => {
  withDatabase((database) => {
    const site = registerSite(database, {
      name: "Transactional",
      domain: "transactional.example",
    });
    recordPageview(database, {
      siteId: site.id,
      visitorId: "transactional-visitor",
      path: "/",
      occurredAt: new Date("2026-08-10T08:00:00.000Z"),
    });
    const sitesBefore = database.prepare("SELECT * FROM sites ORDER BY id").all();
    const pageviewsBefore = database
      .prepare("SELECT * FROM pageviews ORDER BY id")
      .all();

    database.exec("BEGIN");
    assert.deepEqual(deleteSiteAtBoundary(database, site.id), {
      ok: true,
      deletedSites: 1,
      deletedPageviews: 1,
    });
    assert.deepEqual(listSites(database), []);
    database.exec("ROLLBACK");

    assert.deepEqual(database.prepare("SELECT * FROM sites ORDER BY id").all(), sitesBefore);
    assert.deepEqual(
      database.prepare("SELECT * FROM pageviews ORDER BY id").all(),
      pageviewsBefore,
    );
  });
});
