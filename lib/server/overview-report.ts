import type { DatabaseSync } from "node:sqlite";

import {
  getActiveVisitorCount,
  getAverageSessionDuration,
  getBounceRate,
  getPagesPerSession,
  getPageviewSummary,
  getRankedPagesBySessions,
  getRankedReferrersBySessions,
  getSessionCount,
  type RankedPageBySessions,
  type RankedReferrerBySessions,
} from "./pageviews";
import { createReportingRange, getReportingTimeZone } from "./reporting-range";
import {
  getDailyUniqueVisitorTrend,
  type DailyUniqueVisitorTrendItem,
} from "./visitor-trend";

type OverviewReportInput = {
  siteId: number;
  startDate: string;
  endDate: string;
  timeZone: string;
  nowAt: Date;
};

export type OverviewReport = {
  startDate: string;
  endDate: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  pageviews: number;
  uniqueVisitors: number;
  sessions: number;
  pagesPerSession: number;
  bounceRate: number;
  averageSessionDurationSeconds: number;
  realtimeVisitors: number;
  dailyUniqueVisitorTrend: DailyUniqueVisitorTrendItem[];
  sessionRankedPages: RankedPageBySessions[];
  sessionRankedReferrers: RankedReferrerBySessions[];
};

export function getOverviewReport(
  database: DatabaseSync,
  input: OverviewReportInput,
): OverviewReport {
  const timeZone = getReportingTimeZone({
    LYTICS_TIME_ZONE: input.timeZone,
  });
  const range = createReportingRange({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone,
  });
  const rangeInput = {
    siteId: input.siteId,
    startAt: range.startAt,
    endAt: range.endAt,
  };
  const realtimeVisitors = getActiveVisitorCount(database, {
    siteId: input.siteId,
    nowAt: input.nowAt,
  });
  const summary = getPageviewSummary(database, rangeInput);

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone,
    startAt: range.startAt,
    endAt: range.endAt,
    pageviews: summary.pageviews,
    uniqueVisitors: summary.uniqueVisitors,
    sessions: getSessionCount(database, rangeInput),
    pagesPerSession: getPagesPerSession(database, rangeInput),
    bounceRate: getBounceRate(database, rangeInput),
    averageSessionDurationSeconds: getAverageSessionDuration(
      database,
      rangeInput,
    ),
    realtimeVisitors,
    dailyUniqueVisitorTrend: getDailyUniqueVisitorTrend(database, {
      siteId: input.siteId,
      startDate: input.startDate,
      endDate: input.endDate,
      timeZone,
    }),
    sessionRankedPages: getRankedPagesBySessions(database, rangeInput),
    sessionRankedReferrers: getRankedReferrersBySessions(database, rangeInput),
  };
}
