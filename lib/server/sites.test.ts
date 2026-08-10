import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "./database";
import { initializeSites, listSites, registerSite } from "./sites";

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

test("persists sites after the database is closed and reopened", () => {
  withTemporaryDatabase((database, filePath) => {
    initializeSites(database);
    const site = registerSite(database, {
      name: "Journal",
      domain: "journal.example",
    });

    database.close();
    const reopenedDatabase = openDatabase(filePath);

    try {
      assert.deepEqual(listSites(reopenedDatabase), [site]);
    } finally {
      reopenedDatabase.close();
    }
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
