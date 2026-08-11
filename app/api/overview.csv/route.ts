import {
  resolveOverviewRangeSelection,
  resolveOverviewSite,
  type OverviewQueryValue,
} from "../../../lib/overview-query";
import {
  createOverviewReportingRange,
  getReportingTimeZone,
} from "../../../lib/server/reporting-range";
import { getRuntimeDatabase } from "../../../lib/server/runtime-database";
import { listSites } from "../../../lib/server/sites";
import { getDailyUniqueVisitorTrend } from "../../../lib/server/visitor-trend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function safeError(message: string, status: number): Response {
  return new Response(`${message}\n`, {
    status,
    headers: noStoreHeaders,
  });
}

export function GET(request: Request): Response {
  try {
    const searchParams = new URL(request.url).searchParams;
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
    const trend = getDailyUniqueVisitorTrend(database, {
      siteId: site.id,
      ...selection,
      timeZone,
    });
    const csv = [
      "date,unique_visitors",
      ...trend.map((point) => `${point.date},${point.uniqueVisitors}`),
    ].join("\n") + "\n";
    const filename = [
      "lytics-site",
      site.id,
      selection.startDate,
      selection.endDate,
    ].join("-") + ".csv";

    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch {
    return safeError("Unable to export overview CSV", 500);
  }
}
