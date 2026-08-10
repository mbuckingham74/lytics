import type { DatabaseSync } from "node:sqlite";

import {
  getRankedBrowsersByVisitors,
  getRankedDeviceTypesByVisitors,
  getRankedOperatingSystemsByVisitors,
  type RankedBrowserByVisitors,
  type RankedDeviceTypeByVisitors,
  type RankedOperatingSystemByVisitors,
} from "./pageviews";
import { createReportingRange, getReportingTimeZone } from "./reporting-range";

export type TechnologyReportInput = {
  siteId: number;
  startDate: string;
  endDate: string;
  timeZone: string;
};

export type TechnologyReport = {
  startDate: string;
  endDate: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  rankedBrowsers: RankedBrowserByVisitors[];
  rankedDeviceTypes: RankedDeviceTypeByVisitors[];
  rankedOperatingSystems: RankedOperatingSystemByVisitors[];
};

export function getTechnologyReport(
  database: DatabaseSync,
  input: TechnologyReportInput,
): TechnologyReport {
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
    rankedBrowsers: getRankedBrowsersByVisitors(database, rangeInput),
    rankedDeviceTypes: getRankedDeviceTypesByVisitors(database, rangeInput),
    rankedOperatingSystems: getRankedOperatingSystemsByVisitors(
      database,
      rangeInput,
    ),
  };
}
