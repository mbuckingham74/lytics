import type { DatabaseSync } from "node:sqlite";

import {
  getRankedEntryPages,
  getRankedExitPages,
  getRankedPagesBySessions,
  type RankedEntryPage,
  type RankedExitPage,
  type RankedPageBySessions,
} from "./pageviews";
import { createReportingRange, getReportingTimeZone } from "./reporting-range";

export type PagesReportInput = {
  siteId: number;
  startDate: string;
  endDate: string;
  timeZone: string;
};

export type PagesReport = {
  startDate: string;
  endDate: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  sessionRankedPages: RankedPageBySessions[];
  rankedEntryPages: RankedEntryPage[];
  rankedExitPages: RankedExitPage[];
};

export function getPagesReport(
  database: DatabaseSync,
  input: PagesReportInput,
): PagesReport {
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

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone,
    startAt: range.startAt,
    endAt: range.endAt,
    sessionRankedPages: getRankedPagesBySessions(database, rangeInput),
    rankedEntryPages: getRankedEntryPages(database, rangeInput),
    rankedExitPages: getRankedExitPages(database, rangeInput),
  };
}
