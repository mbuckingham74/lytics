import { DatabaseSync } from "node:sqlite";

export function openDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath);

  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  return database;
}
