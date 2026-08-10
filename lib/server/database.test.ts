import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDatabase } from "./database";

test("opens a file-backed database with WAL and foreign keys enabled", () => {
  const directory = mkdtempSync(join(tmpdir(), "lytics-database-"));
  let database: ReturnType<typeof openDatabase> | undefined;

  try {
    database = openDatabase(join(directory, "analytics.sqlite"));

    assert.equal(
      database.prepare("PRAGMA journal_mode").get()?.journal_mode,
      "wal",
    );
    assert.equal(
      database.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
    assert.equal(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all().length,
      0,
    );
  } finally {
    try {
      database?.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});
