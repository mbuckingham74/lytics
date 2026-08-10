import Link from "next/link";

import {
  overviewRangePresets,
  resolveOverviewRangePreset,
  resolveOverviewSite,
} from "../../lib/overview-query";
import { getPagesReport } from "../../lib/server/pages-report";
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

type PagesProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function EmptyPages() {
  return (
    <DashboardShell
      activeSection="Pages"
      siteCaption="Website"
      siteName="No site registered"
    >
      <main className="main-content overview-empty-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">No website selected</p>
            <h1>Pages</h1>
          </div>
        </header>

        <section className="overview-onboarding" aria-labelledby="pages-empty-heading">
          <span className="onboarding-mark" aria-hidden="true">+</span>
          <p className="onboarding-eyebrow">Start measuring pages</p>
          <h2 id="pages-empty-heading">Register your first site</h2>
          <p className="onboarding-copy">
            Add a website in Settings to see its page, entry, and exit analytics.
          </p>
          <Link className="onboarding-link" href="/settings">Open Settings</Link>
        </section>
      </main>
    </DashboardShell>
  );
}

export default async function Pages({ searchParams }: PagesProps) {
  const database = getRuntimeDatabase();
  const sites = listSites(database);

  if (sites.length === 0) {
    return <EmptyPages />;
  }

  const query = await searchParams;
  const site = resolveOverviewSite(sites, query.site);
  const rangePreset = resolveOverviewRangePreset(query.range);
  const range = overviewRangePresets[rangePreset];

  if (!site) {
    return <EmptyPages />;
  }

  const nowAt = new Date();
  const timeZone = getReportingTimeZone();
  const selection = createRecentCalendarSelection({
    nowAt,
    timeZone,
    dayCount: range.dayCount,
  });
  const report = getPagesReport(database, {
    siteId: site.id,
    ...selection,
    timeZone,
  });
  const rankings = [
    {
      title: "Pages",
      columnTitle: "Page",
      emptyMessage: "No page sessions in this period",
      items: report.sessionRankedPages,
    },
    {
      title: "Entry pages",
      columnTitle: "Entry page",
      emptyMessage: "No entry-page sessions in this period",
      items: report.rankedEntryPages,
    },
    {
      title: "Exit pages",
      columnTitle: "Exit page",
      emptyMessage: "No exit-page sessions in this period",
      items: report.rankedExitPages,
    },
  ];

  return (
    <DashboardShell
      activeSection="Pages"
      siteOptions={sites}
      selectedSiteId={site.id}
      siteSelectorPathname="/pages"
    >
      <main className="main-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">{site.domain}</p>
            <h1>Pages</h1>
          </div>

          <div className="header-actions" aria-label="Pages controls">
            <ReportingRangeSelector
              selectedPreset={rangePreset}
              selectedSiteId={site.id}
              firstSiteId={sites[0].id}
              pathname="/pages"
            />
          </div>
        </header>

        <section className="pages-section" aria-labelledby="pages-report-heading">
          <div className="section-heading">
            <div>
              <h2 id="pages-report-heading">Page performance</h2>
              <p>Session-ranked paths for {range.periodCopy}</p>
            </div>
            <span className="updated-label">{report.timeZone}</span>
          </div>

          <div className="pages-rankings-grid">
            {rankings.map((ranking) => {
              const maximumSessions = Math.max(
                0,
                ...ranking.items.map((item) => item.sessions),
              );

              return (
                <article className="ranking-panel" key={ranking.title}>
                  <h3>{ranking.title}</h3>
                  <table className="ranking-table">
                    <thead>
                      <tr>
                        <th scope="col">{ranking.columnTitle}</th>
                        <th scope="col">Sessions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.items.length > 0 ? ranking.items.map((item, index) => (
                        <tr key={`${index}-${item.path}`}>
                          <td>
                            <span
                              className="ranking-bar"
                              style={{
                                width: maximumSessions > 0
                                  ? `${(item.sessions / maximumSessions) * 100}%`
                                  : "0%",
                              }}
                              aria-hidden="true"
                            />
                            <span className="ranking-label">{item.path}</span>
                          </td>
                          <td>{formatCount(item.sessions)}</td>
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
