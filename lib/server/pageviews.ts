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

export type RankedEntryPage = {
  path: string;
  sessions: number;
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

export function getSessionCount(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): number {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Session count start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Session count end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error("Session count start time must be earlier than end time");
  }

  const row = database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          occurred_at,
          lag(occurred_at) OVER (
            PARTITION BY visitor_id
            ORDER BY occurred_at ASC, id ASC
          ) AS previous_occurred_at
        FROM pageviews
        WHERE site_id = ?
      )
      SELECT count(*) AS sessions
      FROM ordered_pageviews
      WHERE occurred_at >= ?
        AND occurred_at < ?
        AND (
          previous_occurred_at IS NULL
          OR occurred_at - previous_occurred_at >= 1800000
        )
    `)
    .get(input.siteId, startAt, endAt);

  if (!row) {
    throw new Error("Session count query did not return a result");
  }

  return row.sessions as number;
}

export function getPagesPerSession(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): number {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Pages per session start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Pages per session end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error(
      "Pages per session start time must be earlier than end time",
    );
  }

  const row = database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          id,
          visitor_id,
          occurred_at,
          CASE
            WHEN lag(occurred_at) OVER (
              PARTITION BY visitor_id
              ORDER BY occurred_at ASC, id ASC
            ) IS NULL
              OR occurred_at - lag(occurred_at) OVER (
                PARTITION BY visitor_id
                ORDER BY occurred_at ASC, id ASC
              ) >= 1800000
            THEN 1
            ELSE 0
          END AS begins_session
        FROM pageviews
        WHERE site_id = ?
      ),
      identified_pageviews AS (
        SELECT
          visitor_id,
          occurred_at,
          sum(begins_session) OVER (
            PARTITION BY visitor_id
            ORDER BY occurred_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS session_number
        FROM ordered_pageviews
      ),
      sessions AS (
        SELECT
          visitor_id,
          session_number,
          min(occurred_at) AS started_at,
          count(*) AS pageviews
        FROM identified_pageviews
        GROUP BY visitor_id, session_number
      )
      SELECT coalesce(avg(pageviews), 0) AS pages_per_session
      FROM sessions
      WHERE started_at >= ?
        AND started_at < ?
    `)
    .get(input.siteId, startAt, endAt);

  if (!row) {
    throw new Error("Pages per session query did not return a result");
  }

  return row.pages_per_session as number;
}

export function getBounceRate(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): number {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Bounce rate start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Bounce rate end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error("Bounce rate start time must be earlier than end time");
  }

  const row = database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          id,
          visitor_id,
          occurred_at,
          CASE
            WHEN lag(occurred_at) OVER (
              PARTITION BY visitor_id
              ORDER BY occurred_at ASC, id ASC
            ) IS NULL
              OR occurred_at - lag(occurred_at) OVER (
                PARTITION BY visitor_id
                ORDER BY occurred_at ASC, id ASC
              ) >= 1800000
            THEN 1
            ELSE 0
          END AS begins_session
        FROM pageviews
        WHERE site_id = ?
      ),
      identified_pageviews AS (
        SELECT
          visitor_id,
          occurred_at,
          sum(begins_session) OVER (
            PARTITION BY visitor_id
            ORDER BY occurred_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS session_number
        FROM ordered_pageviews
      ),
      sessions AS (
        SELECT
          visitor_id,
          session_number,
          min(occurred_at) AS started_at,
          count(*) AS pageviews
        FROM identified_pageviews
        GROUP BY visitor_id, session_number
      )
      SELECT coalesce(
        100.0 * sum(CASE WHEN pageviews = 1 THEN 1 ELSE 0 END) / count(*),
        0
      ) AS bounce_rate
      FROM sessions
      WHERE started_at >= ?
        AND started_at < ?
    `)
    .get(input.siteId, startAt, endAt);

  if (!row) {
    throw new Error("Bounce rate query did not return a result");
  }

  return row.bounce_rate as number;
}

export function getAverageSessionDuration(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): number {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error(
      "Average session duration start time must be a valid date",
    );
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Average session duration end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error(
      "Average session duration start time must be earlier than end time",
    );
  }

  const row = database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          id,
          visitor_id,
          occurred_at,
          CASE
            WHEN lag(occurred_at) OVER (
              PARTITION BY visitor_id
              ORDER BY occurred_at ASC, id ASC
            ) IS NULL
              OR occurred_at - lag(occurred_at) OVER (
                PARTITION BY visitor_id
                ORDER BY occurred_at ASC, id ASC
              ) >= 1800000
            THEN 1
            ELSE 0
          END AS begins_session
        FROM pageviews
        WHERE site_id = ?
      ),
      identified_pageviews AS (
        SELECT
          visitor_id,
          occurred_at,
          sum(begins_session) OVER (
            PARTITION BY visitor_id
            ORDER BY occurred_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS session_number
        FROM ordered_pageviews
      ),
      sessions AS (
        SELECT
          visitor_id,
          session_number,
          min(occurred_at) AS started_at,
          max(occurred_at) AS ended_at
        FROM identified_pageviews
        GROUP BY visitor_id, session_number
      )
      SELECT coalesce(avg((ended_at - started_at) / 1000.0), 0)
        AS average_session_duration
      FROM sessions
      WHERE started_at >= ?
        AND started_at < ?
    `)
    .get(input.siteId, startAt, endAt);

  if (!row) {
    throw new Error("Average session duration query did not return a result");
  }

  return row.average_session_duration as number;
}

export function getActiveVisitorCount(
  database: DatabaseSync,
  input: { siteId: number; nowAt: Date },
): number {
  const nowAt = input.nowAt.getTime();

  if (!Number.isFinite(nowAt)) {
    throw new Error("Active-visitor time must be a valid date");
  }

  const activeSince = nowAt - 5 * 60 * 1000;
  const row = database
    .prepare(`
      SELECT count(DISTINCT visitor_id) AS active_visitors
      FROM pageviews
      WHERE site_id = ?
        AND occurred_at >= ?
        AND occurred_at <= ?
    `)
    .get(input.siteId, activeSince, nowAt);

  if (!row) {
    throw new Error("Active-visitor query did not return a result");
  }

  return row.active_visitors as number;
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

export function getRankedEntryPages(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedEntryPage[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Ranked entry pages start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Ranked entry pages end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked entry pages start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          path,
          occurred_at,
          CASE
            WHEN lag(occurred_at) OVER (
              PARTITION BY visitor_id
              ORDER BY occurred_at ASC, id ASC
            ) IS NULL
              OR occurred_at - lag(occurred_at) OVER (
                PARTITION BY visitor_id
                ORDER BY occurred_at ASC, id ASC
              ) >= 1800000
            THEN 1
            ELSE 0
          END AS begins_session
        FROM pageviews
        WHERE site_id = ?
      )
      SELECT path, count(*) AS sessions
      FROM ordered_pageviews
      WHERE begins_session = 1
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY path
      ORDER BY sessions DESC, path COLLATE BINARY ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      path: row.path as string,
      sessions: row.sessions as number,
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
