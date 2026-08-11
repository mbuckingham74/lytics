import type { DatabaseSync } from "node:sqlite";

import {
  createRecentCalendarSelection,
  createReportingRange,
} from "./reporting-range";

export type Site = {
  id: number;
  name: string;
  domain: string;
};

export type SiteTrackingSummary = Site & {
  registeredAt: Date | null;
  eventsToday: number;
  geographyEnrichedEventsToday: number;
  technologyEnrichedEventsToday: number;
  totalPageviews: number;
  lastPageviewAt: Date | null;
};

type RegisterSiteInput = {
  name: string;
  domain: string;
};

type UpdateSiteInput = RegisterSiteInput & {
  siteId: number;
};

function toSite(row: Record<string, unknown>): Site {
  return {
    id: row.id as number,
    name: row.name as string,
    domain: row.domain as string,
  };
}

function toSiteTrackingSummary(row: Record<string, unknown>): SiteTrackingSummary {
  return {
    ...toSite(row),
    registeredAt:
      row.registered_at === null
        ? null
        : new Date(row.registered_at as number),
    eventsToday: row.events_today as number,
    geographyEnrichedEventsToday:
      row.geography_enriched_events_today as number,
    technologyEnrichedEventsToday:
      row.technology_enriched_events_today as number,
    totalPageviews: row.total_pageviews as number,
    lastPageviewAt:
      row.last_pageview_at === null
        ? null
        : new Date(row.last_pageview_at as number),
  };
}

export function initializeSites(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      domain TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(domain)) > 0),
      registered_at INTEGER
    )
  `);

  const existingColumns = new Set(
    database
      .prepare("PRAGMA table_info(sites)")
      .all()
      .map((row) => row.name as string),
  );

  if (!existingColumns.has("registered_at")) {
    database.exec("ALTER TABLE sites ADD COLUMN registered_at INTEGER");
  }
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

  const registeredAt = Date.now();
  const row = database
    .prepare(
      `
        INSERT INTO sites (name, domain, registered_at)
        VALUES (?, ?, ?)
        RETURNING id, name, domain
      `,
    )
    .get(name, domain, registeredAt);

  if (!row) {
    throw new Error("Site registration did not return a persisted record");
  }

  return toSite(row);
}

export function updateSite(
  database: DatabaseSync,
  input: UpdateSiteInput,
): Site | null {
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
      `
        UPDATE sites
        SET name = ?, domain = ?
        WHERE id = ?
        RETURNING id, name, domain
      `,
    )
    .get(name, domain, input.siteId);

  return row ? toSite(row) : null;
}

export function listSites(database: DatabaseSync): Site[] {
  return database
    .prepare("SELECT id, name, domain FROM sites ORDER BY id ASC")
    .all()
    .map(toSite);
}

export function listSiteTrackingSummaries(
  database: DatabaseSync,
  input: { nowAt: Date; timeZone: string },
): SiteTrackingSummary[] {
  const selection = createRecentCalendarSelection({
    nowAt: input.nowAt,
    timeZone: input.timeZone,
    dayCount: 1,
  });
  const range = createReportingRange({
    ...selection,
    timeZone: input.timeZone,
  });

  return database
    .prepare(`
      SELECT
        sites.id,
        sites.name,
        sites.domain,
        sites.registered_at,
        count(
          CASE
            WHEN pageviews.occurred_at >= ?1 AND pageviews.occurred_at < ?2
            THEN pageviews.id
          END
        ) AS events_today,
        count(
          CASE
            WHEN
              pageviews.occurred_at >= ?1 AND
              pageviews.occurred_at < ?2 AND
              (
                pageviews.country_code IS NOT NULL OR
                pageviews.country_name IS NOT NULL OR
                pageviews.region_code IS NOT NULL OR
                pageviews.region_name IS NOT NULL OR
                pageviews.city_name IS NOT NULL
              )
            THEN pageviews.id
          END
        ) AS geography_enriched_events_today,
        count(
          CASE
            WHEN
              pageviews.occurred_at >= ?1 AND
              pageviews.occurred_at < ?2 AND
              (
                pageviews.browser_name IS NOT NULL OR
                pageviews.device_type IS NOT NULL OR
                pageviews.operating_system_name IS NOT NULL
              )
            THEN pageviews.id
          END
        ) AS technology_enriched_events_today,
        count(pageviews.id) AS total_pageviews,
        max(pageviews.occurred_at) AS last_pageview_at
      FROM sites
      LEFT JOIN pageviews ON pageviews.site_id = sites.id
      GROUP BY sites.id, sites.name, sites.domain, sites.registered_at
      ORDER BY sites.id ASC
    `)
    .all(range.startAt.getTime(), range.endAt.getTime())
    .map(toSiteTrackingSummary);
}

export function findSiteByDomain(
  database: DatabaseSync,
  domain: string,
): Site | null {
  const normalizedDomain = domain.trim().toLowerCase();
  const row = database
    .prepare(
      "SELECT id, name, domain FROM sites WHERE domain = ? COLLATE NOCASE",
    )
    .get(normalizedDomain);

  return row ? toSite(row) : null;
}
