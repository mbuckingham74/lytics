import type { DatabaseSync } from "node:sqlite";

import type { Geography } from "./geolocation";

export type Pageview = {
  id: number;
  siteId: number;
  visitorId: string;
  path: string;
  referrer: string | null;
  occurredAt: Date;
  geography: Geography;
};

export type PageviewSummary = {
  pageviews: number;
  uniqueVisitors: number;
};

export type RankedPage = {
  path: string;
  pageviews: number;
};

export type RankedPageBySessions = {
  path: string;
  sessions: number;
};

export type RankedEntryPage = {
  path: string;
  sessions: number;
};

export type RankedExitPage = {
  path: string;
  sessions: number;
};

export type RankedReferrer = {
  referrer: string | null;
  pageviews: number;
};

export type RankedReferrerBySessions = {
  referrer: string | null;
  sessions: number;
};

export type RankedCountryByVisitors = {
  countryCode: string | null;
  countryName: string | null;
  visitors: number;
};

export type RankedRegionByVisitors = {
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
  visitors: number;
};

export type RankedCityByVisitors = {
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
  cityName: string | null;
  visitors: number;
};

type RecordPageviewInput = {
  siteId: number;
  visitorId: string;
  path: string;
  referrer?: string;
  occurredAt: Date;
  geography?: Geography;
};

const geographyColumns = [
  "country_code",
  "country_name",
  "region_code",
  "region_name",
  "city_name",
] as const;

function toPageview(row: Record<string, unknown>): Pageview {
  return {
    id: row.id as number,
    siteId: row.site_id as number,
    visitorId: row.visitor_id as string,
    path: row.path as string,
    referrer: row.referrer as string | null,
    occurredAt: new Date(row.occurred_at as number),
    geography: {
      countryCode: row.country_code as string | null,
      countryName: row.country_name as string | null,
      regionCode: row.region_code as string | null,
      regionName: row.region_name as string | null,
      cityName: row.city_name as string | null,
    },
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
      occurred_at INTEGER NOT NULL,
      country_code TEXT,
      country_name TEXT,
      region_code TEXT,
      region_name TEXT,
      city_name TEXT
    )
  `);

  const existingColumns = new Set(
    database
      .prepare("PRAGMA table_info(pageviews)")
      .all()
      .map((row) => row.name as string),
  );

  for (const column of geographyColumns) {
    if (!existingColumns.has(column)) {
      database.exec(`ALTER TABLE pageviews ADD COLUMN ${column} TEXT`);
    }
  }
}

export function recordPageview(
  database: DatabaseSync,
  input: RecordPageviewInput,
): Pageview {
  const visitorId = input.visitorId.trim();
  const path = input.path.trim();
  const referrer = input.referrer?.trim() || null;
  const occurredAt = input.occurredAt.getTime();
  const geography = input.geography ?? {
    countryCode: null,
    countryName: null,
    regionCode: null,
    regionName: null,
    cityName: null,
  };

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
      INSERT INTO pageviews (
        site_id,
        visitor_id,
        path,
        referrer,
        occurred_at,
        country_code,
        country_name,
        region_code,
        region_name,
        city_name
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING
        id,
        site_id,
        visitor_id,
        path,
        referrer,
        occurred_at,
        country_code,
        country_name,
        region_code,
        region_name,
        city_name
    `)
    .get(
      input.siteId,
      visitorId,
      path,
      referrer,
      occurredAt,
      geography.countryCode,
      geography.countryName,
      geography.regionCode,
      geography.regionName,
      geography.cityName,
    );

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

export function getRankedPagesBySessions(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedPageBySessions[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error(
      "Ranked pages by sessions start time must be a valid date",
    );
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Ranked pages by sessions end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked pages by sessions start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          id,
          visitor_id,
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
      ),
      identified_pageviews AS (
        SELECT
          id,
          visitor_id,
          path,
          occurred_at,
          sum(begins_session) OVER (
            PARTITION BY visitor_id
            ORDER BY occurred_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS session_number
        FROM ordered_pageviews
      ),
      session_pageviews AS (
        SELECT
          visitor_id,
          session_number,
          path,
          min(occurred_at) OVER (
            PARTITION BY visitor_id, session_number
          ) AS started_at
        FROM identified_pageviews
      ),
      distinct_session_paths AS (
        SELECT DISTINCT visitor_id, session_number, path, started_at
        FROM session_pageviews
      )
      SELECT path, count(*) AS sessions
      FROM distinct_session_paths
      WHERE started_at >= ?
        AND started_at < ?
      GROUP BY path
      ORDER BY sessions DESC, path COLLATE BINARY ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      path: row.path as string,
      sessions: row.sessions as number,
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

export function getRankedExitPages(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedExitPage[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error("Ranked exit pages start time must be a valid date");
  }

  if (!Number.isFinite(endAt)) {
    throw new Error("Ranked exit pages end time must be a valid date");
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked exit pages start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          id,
          visitor_id,
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
      ),
      identified_pageviews AS (
        SELECT
          id,
          visitor_id,
          path,
          occurred_at,
          sum(begins_session) OVER (
            PARTITION BY visitor_id
            ORDER BY occurred_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS session_number
        FROM ordered_pageviews
      ),
      ranked_session_pageviews AS (
        SELECT
          path,
          min(occurred_at) OVER (
            PARTITION BY visitor_id, session_number
          ) AS started_at,
          row_number() OVER (
            PARTITION BY visitor_id, session_number
            ORDER BY occurred_at DESC, id DESC
          ) AS exit_rank
        FROM identified_pageviews
      )
      SELECT path, count(*) AS sessions
      FROM ranked_session_pageviews
      WHERE exit_rank = 1
        AND started_at >= ?
        AND started_at < ?
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

export function getRankedReferrersBySessions(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedReferrerBySessions[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error(
      "Ranked referrers by sessions start time must be a valid date",
    );
  }

  if (!Number.isFinite(endAt)) {
    throw new Error(
      "Ranked referrers by sessions end time must be a valid date",
    );
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked referrers by sessions start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      WITH ordered_pageviews AS (
        SELECT
          referrer,
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
      SELECT referrer, count(*) AS sessions
      FROM ordered_pageviews
      WHERE begins_session = 1
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY referrer
      ORDER BY
        sessions DESC,
        referrer IS NOT NULL ASC,
        referrer COLLATE BINARY ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      referrer: row.referrer as string | null,
      sessions: row.sessions as number,
    }));
}

export function getRankedCountriesByVisitors(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedCountryByVisitors[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error(
      "Ranked countries by visitors start time must be a valid date",
    );
  }

  if (!Number.isFinite(endAt)) {
    throw new Error(
      "Ranked countries by visitors end time must be a valid date",
    );
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked countries by visitors start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      SELECT
        country_code,
        CASE
          WHEN country_code IS NULL THEN NULL
          ELSE min(country_name COLLATE BINARY)
        END AS selected_country_name,
        count(DISTINCT visitor_id) AS visitors
      FROM pageviews
      WHERE site_id = ?
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY country_code
      ORDER BY
        visitors DESC,
        country_code IS NOT NULL ASC,
        selected_country_name COLLATE BINARY ASC,
        country_code COLLATE BINARY ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      countryCode: row.country_code as string | null,
      countryName: row.selected_country_name as string | null,
      visitors: row.visitors as number,
    }));
}

export function getRankedRegionsByVisitors(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedRegionByVisitors[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error(
      "Ranked regions by visitors start time must be a valid date",
    );
  }

  if (!Number.isFinite(endAt)) {
    throw new Error(
      "Ranked regions by visitors end time must be a valid date",
    );
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked regions by visitors start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      SELECT
        country_code,
        CASE
          WHEN country_code IS NULL THEN NULL
          ELSE min(country_name COLLATE BINARY)
        END AS selected_country_name,
        region_code,
        CASE
          WHEN region_code IS NULL THEN NULL
          ELSE min(region_name COLLATE BINARY)
        END AS selected_region_name,
        count(DISTINCT visitor_id) AS visitors
      FROM pageviews
      WHERE site_id = ?
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY country_code, region_code
      ORDER BY
        visitors DESC,
        (country_code IS NOT NULL OR region_code IS NOT NULL) ASC,
        selected_country_name COLLATE BINARY ASC,
        country_code COLLATE BINARY ASC,
        selected_region_name COLLATE BINARY ASC,
        region_code COLLATE BINARY ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      countryCode: row.country_code as string | null,
      countryName: row.selected_country_name as string | null,
      regionCode: row.region_code as string | null,
      regionName: row.selected_region_name as string | null,
      visitors: row.visitors as number,
    }));
}

export function getRankedCitiesByVisitors(
  database: DatabaseSync,
  input: { siteId: number; startAt: Date; endAt: Date },
): RankedCityByVisitors[] {
  const startAt = input.startAt.getTime();
  const endAt = input.endAt.getTime();

  if (!Number.isFinite(startAt)) {
    throw new Error(
      "Ranked cities by visitors start time must be a valid date",
    );
  }

  if (!Number.isFinite(endAt)) {
    throw new Error(
      "Ranked cities by visitors end time must be a valid date",
    );
  }

  if (startAt >= endAt) {
    throw new Error(
      "Ranked cities by visitors start time must be earlier than end time",
    );
  }

  return database
    .prepare(`
      SELECT
        country_code,
        CASE
          WHEN country_code IS NULL THEN NULL
          ELSE min(country_name COLLATE BINARY)
        END AS selected_country_name,
        region_code,
        CASE
          WHEN region_code IS NULL THEN NULL
          ELSE min(region_name COLLATE BINARY)
        END AS selected_region_name,
        city_name,
        count(DISTINCT visitor_id) AS visitors
      FROM pageviews
      WHERE site_id = ?
        AND occurred_at >= ?
        AND occurred_at < ?
      GROUP BY country_code, region_code, city_name
      ORDER BY
        visitors DESC,
        (
          country_code IS NOT NULL
          OR region_code IS NOT NULL
          OR city_name IS NOT NULL
        ) ASC,
        selected_country_name COLLATE BINARY ASC,
        country_code COLLATE BINARY ASC,
        selected_region_name COLLATE BINARY ASC,
        region_code COLLATE BINARY ASC,
        city_name COLLATE BINARY ASC
    `)
    .all(input.siteId, startAt, endAt)
    .map((row) => ({
      countryCode: row.country_code as string | null,
      countryName: row.selected_country_name as string | null,
      regionCode: row.region_code as string | null,
      regionName: row.selected_region_name as string | null,
      cityName: row.city_name as string | null,
      visitors: row.visitors as number,
    }));
}
