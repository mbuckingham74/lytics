import Link from "next/link";

import {
  createReportCsvHref,
  overviewRangePresets,
  resolveOverviewRangeSelection,
  resolveOverviewSite,
} from "../../lib/overview-query";
import {
  createOverviewReportingRange,
  getReportingTimeZone,
} from "../../lib/server/reporting-range";
import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import { listSites } from "../../lib/server/sites";
import { getTechnologyReport } from "../../lib/server/technology-report";
import { DashboardShell } from "../dashboard-shell";
import { ReportingRangeSelector } from "../reporting-range-selector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TechnologyProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function toUtcCalendarInstant(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(0, 0, 0, 0);
  return instant;
}

function formatDeviceType(deviceType: string | null): string {
  if (deviceType === null) {
    return "Unknown";
  }

  const knownLabels: Record<string, string> = {
    desktop: "Desktop",
    mobile: "Mobile",
    tablet: "Tablet",
    smarttv: "Smart TV",
    "smart tv": "Smart TV",
    wearable: "Wearable",
    console: "Console",
    embedded: "Embedded",
  };

  return knownLabels[deviceType] ?? deviceType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function EmptyTechnology() {
  return (
    <DashboardShell
      activeSection="Technology"
      siteCaption="Website"
      siteName="No site registered"
    >
      <main className="main-content overview-empty-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">No website selected</p>
            <h1>Technology</h1>
          </div>
        </header>

        <section
          className="overview-onboarding"
          aria-labelledby="technology-empty-heading"
        >
          <span className="onboarding-mark" aria-hidden="true">+</span>
          <p className="onboarding-eyebrow">Understand visitor technology</p>
          <h2 id="technology-empty-heading">Register your first site</h2>
          <p className="onboarding-copy">
            Add a website in Settings to see its browser, device, and operating
            system analytics.
          </p>
          <Link className="onboarding-link" href="/settings">Open Settings</Link>
        </section>
      </main>
    </DashboardShell>
  );
}

export default async function Technology({ searchParams }: TechnologyProps) {
  const database = getRuntimeDatabase();
  const sites = listSites(database);

  if (sites.length === 0) {
    return <EmptyTechnology />;
  }

  const query = await searchParams;
  const site = resolveOverviewSite(sites, query.site);
  const rangeSelection = resolveOverviewRangeSelection(
    query.range,
    query.start,
    query.end,
  );
  const rangeMetadata = rangeSelection.type === "preset"
    ? overviewRangePresets[rangeSelection.preset]
    : null;

  if (!site) {
    return <EmptyTechnology />;
  }

  const nowAt = new Date();
  const timeZone = getReportingTimeZone();
  const selection = createOverviewReportingRange({
    selection: rangeSelection,
    nowAt,
    timeZone,
  });
  const report = getTechnologyReport(database, {
    siteId: site.id,
    startDate: selection.startDate,
    endDate: selection.endDate,
    timeZone,
  });
  const csvHref = createReportCsvHref({
    view: "technology",
    siteId: site.id,
    firstSiteId: sites[0].id,
    rangeSelection,
  });
  const periodFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const periodCopy = rangeMetadata
    ? rangeMetadata.periodCopy
    : `${periodFormatter.format(toUtcCalendarInstant(selection.startDate))}–${periodFormatter.format(toUtcCalendarInstant(selection.endDate))}`;
  const rankings = [
    {
      title: "Browsers",
      columnTitle: "Browser",
      emptyMessage: "No browser visitors in this period",
      items: report.rankedBrowsers.map((item) => ({
        key: item.browserName === null
          ? "browser:null"
          : `browser:${item.browserName}`,
        label: item.browserName ?? "Unknown",
        visitors: item.visitors,
      })),
    },
    {
      title: "Devices",
      columnTitle: "Device",
      emptyMessage: "No device visitors in this period",
      items: report.rankedDeviceTypes.map((item) => ({
        key: item.deviceType === null
          ? "device:null"
          : `device:${item.deviceType}`,
        label: formatDeviceType(item.deviceType),
        visitors: item.visitors,
      })),
    },
    {
      title: "Operating systems",
      columnTitle: "Operating system",
      emptyMessage: "No operating system visitors in this period",
      items: report.rankedOperatingSystems.map((item) => ({
        key: item.operatingSystemName === null
          ? "operating-system:null"
          : `operating-system:${item.operatingSystemName}`,
        label: item.operatingSystemName ?? "Unknown",
        visitors: item.visitors,
      })),
    },
  ];

  return (
    <DashboardShell
      activeSection="Technology"
      siteOptions={sites}
      selectedSiteId={site.id}
      siteSelectorPathname="/technology"
      siteSelectorPreserveCustomRange
    >
      <main className="main-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">{site.domain}</p>
            <h1>Technology</h1>
          </div>

          <div className="header-actions" aria-label="Technology controls">
            <a
              className="csv-export-link"
              href={csvHref}
              download
              aria-label="Export Technology as CSV"
            >
              CSV
            </a>
            <ReportingRangeSelector
              customEnabled
              selectedRange={rangeSelection}
              resolvedStartDate={selection.startDate}
              resolvedEndDate={selection.endDate}
              selectedSiteId={site.id}
              firstSiteId={sites[0].id}
              pathname="/technology"
            />
          </div>
        </header>

        <section
          className="technology-section"
          aria-labelledby="technology-report-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="technology-report-heading">Visitor technology</h2>
              <p>Distinct visitors for {periodCopy}</p>
            </div>
            <span className="updated-label">{report.timeZone}</span>
          </div>

          <div className="technology-rankings-grid">
            {rankings.map((ranking) => {
              const maximumVisitors = Math.max(
                0,
                ...ranking.items.map((item) => item.visitors),
              );

              return (
                <article className="ranking-panel" key={ranking.title}>
                  <h3>{ranking.title}</h3>
                  <table className="ranking-table">
                    <thead>
                      <tr>
                        <th scope="col">{ranking.columnTitle}</th>
                        <th scope="col">Visitors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.items.length > 0 ? ranking.items.map((item) => (
                        <tr key={item.key}>
                          <td>
                            <span
                              className="ranking-bar"
                              style={{
                                width: maximumVisitors > 0
                                  ? `${(item.visitors / maximumVisitors) * 100}%`
                                  : "0%",
                              }}
                              aria-hidden="true"
                            />
                            <span className="ranking-label">{item.label}</span>
                          </td>
                          <td>{formatCount(item.visitors)}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td className="ranking-empty" colSpan={2}>
                            {ranking.emptyMessage}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
