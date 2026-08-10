import type { DatabaseSync } from "node:sqlite";

import {
  getRankedCitiesByVisitors,
  getRankedCountriesByVisitors,
  getRankedRegionsByVisitors,
  type RankedCityByVisitors,
  type RankedCountryByVisitors,
  type RankedRegionByVisitors,
} from "./pageviews";
import { createReportingRange, getReportingTimeZone } from "./reporting-range";

export type GeographyReportInput = {
  siteId: number;
  startDate: string;
  endDate: string;
  timeZone: string;
};

export type GeographyReport = {
  startDate: string;
  endDate: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  rankedCountries: RankedCountryByVisitors[];
  rankedRegions: RankedRegionByVisitors[];
  rankedCities: RankedCityByVisitors[];
};

export function getGeographyReport(
  database: DatabaseSync,
  input: GeographyReportInput,
): GeographyReport {
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
    rankedCountries: getRankedCountriesByVisitors(database, rangeInput),
    rankedRegions: getRankedRegionsByVisitors(database, rangeInput),
    rankedCities: getRankedCitiesByVisitors(database, rangeInput),
  };
}
