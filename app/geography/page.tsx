import Link from "next/link";

import {
  createReportCsvHref,
  overviewRangePresets,
  resolveOverviewRangePreset,
  resolveOverviewSite,
} from "../../lib/overview-query";
import { getGeographyReport } from "../../lib/server/geography-report";
import {
  createRecentCalendarSelection,
  getReportingTimeZone,
} from "../../lib/server/reporting-range";
import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import { listSites } from "../../lib/server/sites";
import { DashboardShell } from "../dashboard-shell";
import { ReportingRangeSelector } from "../reporting-range-selector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GeographyProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatCountry(
  countryName: string | null,
  countryCode: string | null,
): string {
  return countryName ?? countryCode ?? "Unknown";
}

function formatRegion(input: {
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
}): string {
  const fullyUnknown =
    input.countryCode === null &&
    input.countryName === null &&
    input.regionCode === null &&
    input.regionName === null;

  if (fullyUnknown) {
    return "Unknown";
  }

  const region = input.regionName !== null && input.regionCode !== null
    ? `${input.regionName} (${input.regionCode})`
    : input.regionName ?? input.regionCode ?? "Unknown region";
  const country = input.countryName !== null || input.countryCode !== null
    ? formatCountry(input.countryName, input.countryCode)
    : "Unknown country";

  return `${region} · ${country}`;
}

function formatCity(input: {
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
  cityName: string | null;
}): string {
  const fullyUnknown =
    input.countryCode === null &&
    input.countryName === null &&
    input.regionCode === null &&
    input.regionName === null &&
    input.cityName === null;

  if (fullyUnknown) {
    return "Unknown";
  }

  const city = input.cityName ?? "Unknown city";
  const region = input.regionName !== null && input.regionCode !== null
    ? `${input.regionName} (${input.regionCode})`
    : input.regionName ?? input.regionCode ?? "Unknown region";
  const country = input.countryName !== null || input.countryCode !== null
    ? formatCountry(input.countryName, input.countryCode)
    : "Unknown country";

  return `${city} · ${region} · ${country}`;
}

function EmptyGeography() {
  return (
    <DashboardShell
      activeSection="Geography"
      siteCaption="Website"
      siteName="No site registered"
    >
      <main className="main-content overview-empty-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">No website selected</p>
            <h1>Geography</h1>
          </div>
        </header>

        <section
          className="overview-onboarding"
          aria-labelledby="geography-empty-heading"
        >
          <span className="onboarding-mark" aria-hidden="true">+</span>
          <p className="onboarding-eyebrow">Understand visitor locations</p>
          <h2 id="geography-empty-heading">Register your first site</h2>
          <p className="onboarding-copy">
            Add a website in Settings to see its country, region, and city
            analytics.
          </p>
          <Link className="onboarding-link" href="/settings">Open Settings</Link>
        </section>
      </main>
    </DashboardShell>
  );
}

export default async function Geography({ searchParams }: GeographyProps) {
  const database = getRuntimeDatabase();
  const sites = listSites(database);

  if (sites.length === 0) {
    return <EmptyGeography />;
  }

  const query = await searchParams;
  const site = resolveOverviewSite(sites, query.site);
  const rangePreset = resolveOverviewRangePreset(query.range);
  const range = overviewRangePresets[rangePreset];

  if (!site) {
    return <EmptyGeography />;
  }

  const nowAt = new Date();
  const timeZone = getReportingTimeZone();
  const selection = createRecentCalendarSelection({
    nowAt,
    timeZone,
    dayCount: range.dayCount,
  });
  const report = getGeographyReport(database, {
    siteId: site.id,
    ...selection,
    timeZone,
  });
  const csvHref = createReportCsvHref({
    view: "geography",
    siteId: site.id,
    firstSiteId: sites[0].id,
    rangePreset,
  });
  const rankings = [
    {
      title: "Countries",
      columnTitle: "Country",
      emptyMessage: "No country visitors in this period",
      items: report.rankedCountries.map((item) => ({
        label: formatCountry(item.countryName, item.countryCode),
        visitors: item.visitors,
      })),
    },
    {
      title: "Regions",
      columnTitle: "Region",
      emptyMessage: "No region visitors in this period",
      items: report.rankedRegions.map((item) => ({
        label: formatRegion(item),
        visitors: item.visitors,
      })),
    },
    {
      title: "Cities",
      columnTitle: "City",
      emptyMessage: "No city visitors in this period",
      items: report.rankedCities.map((item) => ({
        label: formatCity(item),
        visitors: item.visitors,
      })),
    },
  ];

  return (
    <DashboardShell
      activeSection="Geography"
      siteOptions={sites}
      selectedSiteId={site.id}
      siteSelectorPathname="/geography"
    >
      <main className="main-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">{site.domain}</p>
            <h1>Geography</h1>
          </div>

          <div className="header-actions" aria-label="Geography controls">
            <a
              className="csv-export-link"
              href={csvHref}
              download
              aria-label="Export Geography as CSV"
            >
              CSV
            </a>
            <ReportingRangeSelector
              selectedPreset={rangePreset}
              selectedSiteId={site.id}
              firstSiteId={sites[0].id}
              pathname="/geography"
            />
          </div>
        </header>

        <section
          className="geography-section"
          aria-labelledby="geography-report-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="geography-report-heading">Visitor locations</h2>
              <p>Distinct visitors for {range.periodCopy}</p>
            </div>
            <span className="updated-label">{report.timeZone}</span>
          </div>

          <div className="geography-rankings-grid">
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
                      {ranking.items.length > 0 ? ranking.items.map(
                        (item, index) => (
                          <tr key={`${index}-${item.label}`}>
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
                              <span className="ranking-label geography-ranking-label">
                                {item.label}
                              </span>
                            </td>
                            <td>{formatCount(item.visitors)}</td>
                          </tr>
                        ),
                      ) : (
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
