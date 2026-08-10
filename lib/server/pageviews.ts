import type { DatabaseSync } from "node:sqlite";

export type Pageview = {
  id: number;
  siteId: number;
  visitorId: string;
  path: string;
  referrer: string | null;
  occurredAt: Date;
};

export type PageviewSummary = {
  pageviews: number;
  uniqueVisitors: number;
};

export type RankedPage = {
  path: string;
  pageviews: number;
};

export type RankedReferrer = {
  referrer: string | null;
  pageviews: number;
};

type RecordPageviewInput = {
  siteId: number;
  visitorId: string;
  path: string;
  referrer?: string;
  occurredAt: Date;
};

function toPageview(row: Record<string, unknown>): Pageview {
  return {
    id: row.id as number,
    siteId: row.site_id as number,
    visitorId: row.visitor_id as string,
    path: row.path as string,
    referrer: row.referrer as string | null,
    occurredAt: new Date(row.occurred_at as number),
  };
}

export function initializePageviews(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS pageviews (
      id INTEGER PRIMARY KEY,
      site_id INTEGER NOT NULL REFERENCES sites(id),
      visitor_id TEXT NOT NULL CHECK (length(trim(visitor_id)) > 0),
      path TEXT NOT NULL CHECK (length(trim(path)) > 0),
      referrer TEXT,
      occurred_at INTEGER NOT NULL
    )
  `);
}

export function recordPageview(
  database: DatabaseSync,
  input: RecordPageviewInput,
): Pageview {
  const visitorId = input.visitorId.trim();
  const path = input.path.trim();
  const referrer = input.referrer?.trim() || null;
  const occurredAt = input.occurredAt.getTime();

  if (visitorId.length === 0) {
    throw new Error("Pageview visitor ID cannot be blank");
  }

  if (path.length === 0) {
    throw new Error("Pageview path cannot be blank");
  }

  if (!Number.isFinite(occurredAt)) {
    throw new Error("Pageview occurrence time must be a valid date");
  }

  const row = database
    .prepare(`
      INSERT INTO pageviews (site_id, visitor_id, path, referrer, occurred_at)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, site_id, visitor_id, path, referrer, occurred_at
    `)
    .get(input.siteId, visitorId, path, referrer, occurredAt);

  if (!row) {
    throw new Error("Pageview insertion did not return a persisted record");
  }

  return toPageview(row);
}

export function getPageviewSummary(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): PageviewSummary {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Pageview summary start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Pageview summary end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error(
      "Pageview summary start time must be earlier than end time",
    );
  }

  const row = database
    .prepare(`
      SELECT
        count(*) AS pageviews,
        count(DISTINCT visitor_id) AS unique_visitors
      FROM pageviews
      WHERE site_id = ?
        AND occurred_at >= ?
        AND occurred_at < ?
    `)
    .get(input.siteId, startAt, endAt);

  if (!row) {
    throw new Error("Pageview summary query did not return a result");
  }

  return {
    pageviews: row.pageviews as number,
    uniqueVisitors: row.unique_visitors as number,
  };
}

export function getRankedPages(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedPage[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Ranked pages start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Ranked pages end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error("Ranked pages start time must be earlier than end time");
  }

  return database
    .prepare(`
      SELECT path, count(*) AS pageviews
      FROM pageviews
      WHERE site_id = ?
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY path
      ORDER BY pageviews DESC, path ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      path: row.path as string,
      pageviews: row.pageviews as number,
    }));
}

export function getRankedReferrers(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedReferrer[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Ranked referrers start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Ranked referrers end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked referrers start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      SELECT referrer, count(*) AS pageviews
      FROM pageviews
      WHERE site_id = ?
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY referrer
      ORDER BY
        pageviews DESC,
        referrer IS NOT NULL ASC,
        referrer COLLATE BINARY ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      referrer: row.referrer as string | null,
      pageviews: row.pageviews as number,
    }));
}
