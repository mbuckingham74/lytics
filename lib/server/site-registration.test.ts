import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { registerSiteAtBoundary } from "./site-registration";
import { initializeSites, listSites, registerSite } from "./sites";

function withDatabase(run: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(":memory:");

  try {
    initializeSites(database);
    run(database);
  } finally {
    database.close();
  }
}

test("registers a normalized site through the settings boundary", () => {
  withDatabase((database) => {
    const result = registerSiteAtBoundary(database, {
      name: "  Personal Site  ",
      domain: "  PERSONAL.Example  ",
    });

    assert.deepEqual(result, {
      ok: true,
      site: { id: 1, name: "Personal Site", domain: "personal.example" },
    });
    assert.deepEqual(listSites(database), [
      { id: 1, name: "Personal Site", domain: "personal.example" },
    ]);
  });
});

test("returns stable messages for blank settings fields without persisting", () => {
  withDatabase((database) => {
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: "  ", domain: "site.example" }),
      { ok: false, message: "Enter a site name." },
    );
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: "Site", domain: "  " }),
      { ok: false, message: "Enter a domain." },
    );
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: null, domain: "site.example" }),
      { ok: false, message: "Enter a site name." },
    );
    assert.deepEqual(listSites(database), []);
  });
});

test("rejects a case-insensitive duplicate domain without exposing SQLite errors", () => {
  withDatabase((database) => {
    registerSite(database, { name: "First", domain: "personal.example" });

    assert.deepEqual(
      registerSiteAtBoundary(database, {
        name: "Duplicate",
        domain: "PERSONAL.EXAMPLE",
      }),
      { ok: false, message: "That domain is already registered." },
    );
    assert.deepEqual(listSites(database), [
      { id: 1, name: "First", domain: "personal.example" },
    ]);
  });
});

test("contains unexpected persistence failures behind a safe message", () => {
  const database = new DatabaseSync(":memory:");

  try {
    assert.deepEqual(
      registerSiteAtBoundary(database, { name: "Site", domain: "site.example" }),
      { ok: false, message: "Could not register the site. Try again." },
    );
  } finally {
    database.close();
  }
});
