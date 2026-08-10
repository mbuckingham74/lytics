import type { DatabaseSync } from "node:sqlite";

import { createReportingRange } from "./reporting-range";

export type DailyUniqueVisitorTrendItem = {
  date: string;
  uniqueVisitors: number;
};

type DailyUniqueVisitorTrendInput = {
  siteId: number;
  startDate: string;
  endDate: string;
  timeZone: string;
};

type DailyBucket = {
  date: string;
  startAt: number;
  endAt: number;
};

const trendFailureMessage = "Daily unique visitor trend could not be calculated";

function getNextCalendarDate(date: string): string {
  const cursor = new Date(`${date}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

function buildDailyBuckets(input: DailyUniqueVisitorTrendInput): DailyBucket[] {
  const reportingRange = createReportingRange({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
  });
  const buckets: DailyBucket[] = [];
  let date = input.startDate;

  while (true) {
    const dailyRange = createReportingRange({
      startDate: date,
      endDate: date,
      timeZone: input.timeZone,
    });

    buckets.push({
      date,
      startAt: dailyRange.startAt.getTime(),
      endAt: dailyRange.endAt.getTime(),
    });

    if (date === input.endDate) {
      break;
    }

    date = getNextCalendarDate(date);
  }

  if (
    buckets.length === 0 ||
    buckets[0].startAt !== reportingRange.startAt.getTime() ||
    buckets[buckets.length - 1].endAt !== reportingRange.endAt.getTime()
  ) {
    throw new Error(trendFailureMessage);
  }

  return buckets;
}

export function getDailyUniqueVisitorTrend(
  database: DatabaseSync,
  input: DailyUniqueVisitorTrendInput,
): DailyUniqueVisitorTrendItem[] {
  if (!Number.isSafeInteger(input.siteId) || input.siteId <= 0) {
    throw new Error("siteId must be a positive integer");
  }

  const buckets = buildDailyBuckets(input);
  let rows: Record<string, unknown>[];

  try {
    rows = database
      .prepare(`
        WITH requested_buckets AS (
          SELECT
            CAST(key AS INTEGER) AS bucket_order,
            json_extract(value, '$.date') AS date,
            json_extract(value, '$.startAt') AS start_at,
            json_extract(value, '$.endAt') AS end_at
          FROM json_each(?)
        )
        SELECT
          requested_buckets.date AS date,
          count(DISTINCT pageviews.visitor_id) AS unique_visitors
        FROM requested_buckets
        LEFT JOIN pageviews
          ON pageviews.site_id = ?
          AND pageviews.occurred_at >= requested_buckets.start_at
          AND pageviews.occurred_at < requested_buckets.end_at
        GROUP BY requested_buckets.bucket_order, requested_buckets.date
        ORDER BY requested_buckets.bucket_order ASC
      `)
      .all(JSON.stringify(buckets), input.siteId);
  } catch {
    throw new Error(trendFailureMessage);
  }

  if (rows.length !== buckets.length) {
    throw new Error(trendFailureMessage);
  }

  return rows.map((row, index) => {
    const date = row.date;
    const uniqueVisitors = row.unique_visitors;

    if (
      date !== buckets[index].date ||
      typeof uniqueVisitors !== "number" ||
      !Number.isSafeInteger(uniqueVisitors) ||
      uniqueVisitors < 0
    ) {
      throw new Error(trendFailureMessage);
    }

    return { date, uniqueVisitors };
  });
}
