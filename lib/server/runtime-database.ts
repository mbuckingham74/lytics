import type { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";

import { openDatabase } from "./database";
import { initializePageviews } from "./pageviews";
import { initializeSites } from "./sites";

const runtimeGlobal = globalThis as typeof globalThis & {
  __lyticsRuntimeDatabase__?: DatabaseSync;
};

export function getRuntimeDatabase(): DatabaseSync {
  if (runtimeGlobal.__lyticsRuntimeDatabase__) {
    return runtimeGlobal.__lyticsRuntimeDatabase__;
  }

  const filePath = process.env.LYTICS_DATABASE_PATH;

  if (!filePath || filePath.trim().length === 0) {
    throw new Error("LYTICS_DATABASE_PATH is required");
  }

  if (!isAbsolute(filePath)) {
    throw new Error("LYTICS_DATABASE_PATH must be an absolute path");
  }

  let database: DatabaseSync | undefined;

  try {
    database = openDatabase(filePath);
    initializeSites(database);
    initializePageviews(database);
    runtimeGlobal.__lyticsRuntimeDatabase__ = database;

    return database;
  } catch (error) {
    if (database?.isOpen) {
      database.close();
    }

    throw error;
  }
}

export function closeRuntimeDatabase(): void {
  const database = runtimeGlobal.__lyticsRuntimeDatabase__;
  delete runtimeGlobal.__lyticsRuntimeDatabase__;

  if (database?.isOpen) {
    database.close();
  }
}
