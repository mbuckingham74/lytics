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
import {
  createPreviousOverviewReportingRange,
  createReportingRange,
  getReportingTimeZone,
} from "./reporting-range";
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

export type OverviewRawKpis = {
  pageviews: number;
  uniqueVisitors: number;
  sessions: number;
  pagesPerSession: number;
  bounceRate: number;
  averageSessionDurationSeconds: number;
};

export type OverviewPreviousPeriod = OverviewRawKpis & {
  startDate: string;
  endDate: string;
  startAt: Date;
  endAt: Date;
};

export type OverviewReport = OverviewRawKpis & {
  startDate: string;
  endDate: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  previousPeriod: OverviewPreviousPeriod;
  realtimeVisitors: number;
  dailyUniqueVisitorTrend: DailyUniqueVisitorTrendItem[];
  sessionRankedPages: RankedPageBySessions[];
  sessionRankedReferrers: RankedReferrerBySessions[];
};

function getOverviewRawKpis(
  database: DatabaseSync,
  input: {
    siteId: number;
    startAt: Date;
    endAt: Date;
  },
): OverviewRawKpis {
  const summary = getPageviewSummary(database, input);

  return {
    pageviews: summary.pageviews,
    uniqueVisitors: summary.uniqueVisitors,
    sessions: getSessionCount(database, input),
    pagesPerSession: getPagesPerSession(database, input),
    bounceRate: getBounceRate(database, input),
    averageSessionDurationSeconds: getAverageSessionDuration(database, input),
  };
}

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
  const previousRange = createPreviousOverviewReportingRange({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone,
  });
  const rangeInput = {
    siteId: input.siteId,
    startAt: range.startAt,
    endAt: range.endAt,
  };
  const previousRangeInput = {
    siteId: input.siteId,
    startAt: previousRange.startAt,
    endAt: previousRange.endAt,
  };
  const realtimeVisitors = getActiveVisitorCount(database, {
    siteId: input.siteId,
    nowAt: input.nowAt,
  });
  const currentKpis = getOverviewRawKpis(database, rangeInput);
  const previousKpis = getOverviewRawKpis(database, previousRangeInput);

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone,
    startAt: range.startAt,
    endAt: range.endAt,
    ...currentKpis,
    previousPeriod: {
      startDate: previousRange.startDate,
      endDate: previousRange.endDate,
      startAt: previousRange.startAt,
      endAt: previousRange.endAt,
      ...previousKpis,
    },
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
