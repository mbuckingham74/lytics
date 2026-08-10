import type { DatabaseSync } from "node:sqlite";

export type Site = {
  id: number;
  name: string;
  domain: string;
};

type RegisterSiteInput = {
  name: string;
  domain: string;
};

function toSite(row: Record<string, unknown>): Site {
  return {
    id: row.id as number,
    name: row.name as string,
    domain: row.domain as string,
  };
}

export function initializeSites(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      domain TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(domain)) > 0)
    )
  `);
}

export function registerSite(
  database: DatabaseSync,
  input: RegisterSiteInput,
): Site {
  const name = input.name.trim();
  const domain = input.domain.trim().toLowerCase();

  if (name.length === 0) {
    throw new Error("Site name cannot be blank");
  }

  if (domain.length === 0) {
    throw new Error("Site domain cannot be blank");
  }

  const row = database
    .prepare(
      "INSERT INTO sites (name, domain) VALUES (?, ?) RETURNING id, name, domain",
    )
    .get(name, domain);

  if (!row) {
    throw new Error("Site registration did not return a persisted record");
  }

  return toSite(row);
}

export function listSites(database: DatabaseSync): Site[] {
  return database
    .prepare("SELECT id, name, domain FROM sites ORDER BY id ASC")
    .all()
    .map(toSite);
}
