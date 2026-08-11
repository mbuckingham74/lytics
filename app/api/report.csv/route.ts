import {
  resolveOverviewRangeSelection,
  resolveOverviewSite,
  type OverviewQueryValue,
} from "../../../lib/overview-query";
import { getGeographyReport } from "../../../lib/server/geography-report";
import { getPagesReport } from "../../../lib/server/pages-report";
import { getRankedReferrersBySessions } from "../../../lib/server/pageviews";
import {
  createOverviewReportingRange,
  getReportingTimeZone,
} from "../../../lib/server/reporting-range";
import { getRuntimeDatabase } from "../../../lib/server/runtime-database";
import { listSites } from "../../../lib/server/sites";
import { getTechnologyReport } from "../../../lib/server/technology-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReportView = "pages" | "referrers" | "geography" | "technology";
type CsvValue = string | number | null;

const reportViews = new Set<ReportView>([
  "pages",
  "referrers",
  "geography",
  "technology",
]);

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
};

function readQueryValue(
  searchParams: URLSearchParams,
  key: "site" | "range" | "start" | "end",
): OverviewQueryValue {
  const values = searchParams.getAll(key);

  if (values.length === 0) {
    return undefined;
  }

  return values.length === 1 ? values[0] : values;
}

function readView(searchParams: URLSearchParams): ReportView | null {
  const values = searchParams.getAll("view");

  if (values.length !== 1 || !reportViews.has(values[0] as ReportView)) {
    return null;
  }

  return values[0] as ReportView;
}

function escapeCsvValue(value: CsvValue): string {
  const text = value === null ? "" : String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function createCsv(rows: CsvValue[][]): string {
  return rows
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n") + "\n";
}

function safeError(message: string, status: number): Response {
  return new Response(`${message}\n`, {
    status,
    headers: noStoreHeaders,
  });
}

export function GET(request: Request): Response {
  const searchParams = new URL(request.url).searchParams;
  const view = readView(searchParams);

  if (!view) {
    return safeError(
      "view must be one of pages, referrers, geography, or technology",
      400,
    );
  }

  try {
    const database = getRuntimeDatabase();
    const sites = listSites(database);
    const site = resolveOverviewSite(
      sites,
      readQueryValue(searchParams, "site"),
    );

    if (!site) {
      return safeError("No registered site is available", 404);
    }

    const rangeSelection = resolveOverviewRangeSelection(
      readQueryValue(searchParams, "range"),
      readQueryValue(searchParams, "start"),
      readQueryValue(searchParams, "end"),
    );
    const nowAt = new Date();
    const timeZone = getReportingTimeZone();
    const selection = createOverviewReportingRange({
      selection: rangeSelection,
      nowAt,
      timeZone,
    });
    const reportInput = {
      siteId: site.id,
      ...selection,
      timeZone,
    };
    let rows: CsvValue[][];

    if (view === "pages") {
      const report = getPagesReport(database, reportInput);
      rows = [
        ["category", "path", "sessions"],
        ...report.sessionRankedPages.map((item) => [
          "page",
          item.path,
          item.sessions,
        ]),
        ...report.rankedEntryPages.map((item) => [
          "entry_page",
          item.path,
          item.sessions,
        ]),
        ...report.rankedExitPages.map((item) => [
          "exit_page",
          item.path,
          item.sessions,
        ]),
      ];
    } else if (view === "referrers") {
      const referrers = getRankedReferrersBySessions(database, {
        siteId: site.id,
        startAt: selection.startAt,
        endAt: selection.endAt,
      });
      rows = [
        ["referrer", "sessions"],
        ...referrers.map((item) => [
          item.referrer ?? "Direct",
          item.sessions,
        ]),
      ];
    } else if (view === "geography") {
      const report = getGeographyReport(database, reportInput);
      rows = [
        [
          "category",
          "country_code",
          "country_name",
          "region_code",
          "region_name",
          "city_name",
          "visitors",
        ],
        ...report.rankedCountries.map((item) => [
          "country",
          item.countryCode,
          item.countryName,
          null,
          null,
          null,
          item.visitors,
        ]),
        ...report.rankedRegions.map((item) => [
          "region",
          item.countryCode,
          item.countryName,
          item.regionCode,
          item.regionName,
          null,
          item.visitors,
        ]),
        ...report.rankedCities.map((item) => [
          "city",
          item.countryCode,
          item.countryName,
          item.regionCode,
          item.regionName,
          item.cityName,
          item.visitors,
        ]),
      ];
    } else {
      const report = getTechnologyReport(database, reportInput);
      rows = [
        [
          "category",
          "browser_name",
          "device_type",
          "operating_system_name",
          "visitors",
        ],
        ...report.rankedBrowsers.map((item) => [
          "browser",
          item.browserName,
          null,
          null,
          item.visitors,
        ]),
        ...report.rankedDeviceTypes.map((item) => [
          "device",
          null,
          item.deviceType,
          null,
          item.visitors,
        ]),
        ...report.rankedOperatingSystems.map((item) => [
          "operating_system",
          null,
          null,
          item.operatingSystemName,
          item.visitors,
        ]),
      ];
    }

    const filename = [
      `lytics-${view}-site`,
      site.id,
      selection.startDate,
      selection.endDate,
    ].join("-") + ".csv";

    return new Response(createCsv(rows), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch {
    return safeError("Unable to export report CSV", 500);
  }
}
