import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { openDatabase } from "./database";
import { listSites, registerSite } from "./sites";

type RuntimeDatabaseModule = typeof import("./runtime-database");

const originalDatabasePath = process.env.LYTICS_DATABASE_PATH;

async function importRuntimeDatabase(
  fresh = false,
): Promise<RuntimeDatabaseModule> {
  const suffix = fresh ? `?test=${Date.now()}-${Math.random()}` : "";

  return import(`./runtime-database${suffix}`) as Promise<RuntimeDatabaseModule>;
}

function restoreDatabasePath(): void {
  if (originalDatabasePath === undefined) {
    delete process.env.LYTICS_DATABASE_PATH;
  } else {
    process.env.LYTICS_DATABASE_PATH = originalDatabasePath;
  }
}

async function withRuntimeTest(
  run: (context: {
    directory: string;
    runtime: RuntimeDatabaseModule;
  }) => void | Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "lytics-runtime-database-"));
  const runtime = await importRuntimeDatabase();
  runtime.closeRuntimeDatabase();

  try {
    await run({ directory, runtime });
  } finally {
    runtime.closeRuntimeDatabase();
    restoreDatabasePath();
    rmSync(directory, { force: true, recursive: true });
  }
}

test("importing without configuration has no database side effects", async () => {
  await withRuntimeTest(async ({ directory }) => {
    delete process.env.LYTICS_DATABASE_PATH;

    const runtime = await importRuntimeDatabase(true);

    assert.equal(existsSync(join(directory, "analytics.sqlite")), false);
    runtime.closeRuntimeDatabase();
  });
});

test("rejects missing, blank, and relative database paths before opening", async () => {
  await withRuntimeTest(({ directory, runtime }) => {
    const absolutePath = join(directory, "analytics.sqlite");
    const relativePath = join(basename(directory), "analytics.sqlite");

    delete process.env.LYTICS_DATABASE_PATH;
    assert.throws(() => runtime.getRuntimeDatabase(), {
      message: "LYTICS_DATABASE_PATH is required",
    });

    process.env.LYTICS_DATABASE_PATH = "   ";
    assert.throws(() => runtime.getRuntimeDatabase(), {
      message: "LYTICS_DATABASE_PATH is required",
    });

    process.env.LYTICS_DATABASE_PATH = relativePath;
    assert.throws(() => runtime.getRuntimeDatabase(), {
      message: "LYTICS_DATABASE_PATH must be an absolute path",
    });

    assert.equal(existsSync(absolutePath), false);
    assert.equal(existsSync(join(process.cwd(), relativePath)), false);
  });
});

test("first access opens one configured database and initializes existing schemas", async () => {
  await withRuntimeTest(({ directory, runtime }) => {
    const filePath = join(directory, "analytics.sqlite");
    process.env.LYTICS_DATABASE_PATH = filePath;

    const database = runtime.getRuntimeDatabase();

    assert.equal(database.isOpen, true);
    assert.equal(database.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.deepEqual(
      database
        .prepare(`
          SELECT name
          FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name ASC
        `)
        .all()
        .map((row) => row.name),
      ["pageviews", "sites"],
    );
    assert.strictEqual(runtime.getRuntimeDatabase(), database);
  });
});

test("fresh module evaluation reuses the process-wide connection", async () => {
  await withRuntimeTest(async ({ directory, runtime }) => {
    process.env.LYTICS_DATABASE_PATH = join(directory, "analytics.sqlite");
    const database = runtime.getRuntimeDatabase();
    const reevaluatedRuntime = await importRuntimeDatabase(true);

    assert.strictEqual(reevaluatedRuntime.getRuntimeDatabase(), database);
  });
});

test("closing is idempotent and reopening preserves persisted data", async () => {
  await withRuntimeTest(({ directory, runtime }) => {
    process.env.LYTICS_DATABASE_PATH = join(directory, "analytics.sqlite");
    const firstDatabase = runtime.getRuntimeDatabase();
    registerSite(firstDatabase, {
      name: "Personal Site",
      domain: "personal.example",
    });

    runtime.closeRuntimeDatabase();
    runtime.closeRuntimeDatabase();
    assert.equal(firstDatabase.isOpen, false);

    const secondDatabase = runtime.getRuntimeDatabase();
    assert.notStrictEqual(secondDatabase, firstDatabase);
    assert.deepEqual(listSites(secondDatabase), [
      {
        id: 1,
        name: "Personal Site",
        domain: "personal.example",
      },
    ]);
  });
});

test("a failed open is not cached and a later valid attempt succeeds", async () => {
  await withRuntimeTest(({ directory, runtime }) => {
    process.env.LYTICS_DATABASE_PATH = join(
      directory,
      "missing-parent",
      "analytics.sqlite",
    );
    assert.throws(() => runtime.getRuntimeDatabase());

    const validPath = join(directory, "analytics.sqlite");
    process.env.LYTICS_DATABASE_PATH = validPath;
    const database = runtime.getRuntimeDatabase();

    assert.equal(database.isOpen, true);
    assert.equal(existsSync(validPath), true);
  });
});

test("failed schema initialization closes the attempt and permits retry", async () => {
  await withRuntimeTest(({ directory, runtime }) => {
    const filePath = join(directory, "analytics.sqlite");
    const blockingDatabase = openDatabase(filePath);
    blockingDatabase.exec(`
      CREATE TABLE initialization_lock (id INTEGER PRIMARY KEY);
      BEGIN IMMEDIATE;
      INSERT INTO initialization_lock DEFAULT VALUES;
    `);
    process.env.LYTICS_DATABASE_PATH = filePath;

    try {
      assert.throws(() => runtime.getRuntimeDatabase());
    } finally {
      blockingDatabase.exec("ROLLBACK");
      blockingDatabase.close();
    }

    const cleanupDatabase = openDatabase(filePath);
    cleanupDatabase.exec("DROP TABLE initialization_lock");
    cleanupDatabase.close();

    const database = runtime.getRuntimeDatabase();
    assert.deepEqual(
      database
        .prepare(`
          SELECT name
          FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name ASC
        `)
        .all()
        .map((row) => row.name),
      ["pageviews", "sites"],
    );
  });
});
