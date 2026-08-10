import Link from "next/link";

import {
  createReportCsvHref,
  overviewRangePresets,
  resolveOverviewRangePreset,
  resolveOverviewSite,
} from "../../lib/overview-query";
import { getRankedReferrersBySessions } from "../../lib/server/pageviews";
import {
  createRecentCalendarSelection,
  createReportingRange,
  getReportingTimeZone,
} from "../../lib/server/reporting-range";
import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import { listSites } from "../../lib/server/sites";
import { DashboardShell } from "../dashboard-shell";
import { ReportingRangeSelector } from "../reporting-range-selector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReferrersProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function EmptyReferrers() {
  return (
    <DashboardShell
      activeSection="Referrers"
      siteCaption="Website"
      siteName="No site registered"
    >
      <main className="main-content overview-empty-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">No website selected</p>
            <h1>Referrers</h1>
          </div>
        </header>

        <section
          className="overview-onboarding"
          aria-labelledby="referrers-empty-heading"
        >
          <span className="onboarding-mark" aria-hidden="true">+</span>
          <p className="onboarding-eyebrow">Understand traffic sources</p>
          <h2 id="referrers-empty-heading">Register your first site</h2>
          <p className="onboarding-copy">
            Add a website in Settings to see which sources start its sessions.
          </p>
          <Link className="onboarding-link" href="/settings">Open Settings</Link>
        </section>
      </main>
    </DashboardShell>
  );
}

export default async function Referrers({ searchParams }: ReferrersProps) {
  const database = getRuntimeDatabase();
  const sites = listSites(database);

  if (sites.length === 0) {
    return <EmptyReferrers />;
  }

  const query = await searchParams;
  const site = resolveOverviewSite(sites, query.site);
  const rangePreset = resolveOverviewRangePreset(query.range);
  const rangePresetMetadata = overviewRangePresets[rangePreset];

  if (!site) {
    return <EmptyReferrers />;
  }

  const nowAt = new Date();
  const timeZone = getReportingTimeZone();
  const selection = createRecentCalendarSelection({
    nowAt,
    timeZone,
    dayCount: rangePresetMetadata.dayCount,
  });
  const range = createReportingRange({
    ...selection,
    timeZone,
  });
  const referrers = getRankedReferrersBySessions(database, {
    siteId: site.id,
    startAt: range.startAt,
    endAt: range.endAt,
  });
  const csvHref = createReportCsvHref({
    view: "referrers",
    siteId: site.id,
    firstSiteId: sites[0].id,
    rangePreset,
  });
  const maximumSessions = Math.max(
    0,
    ...referrers.map((referrer) => referrer.sessions),
  );

  return (
    <DashboardShell
      activeSection="Referrers"
      siteOptions={sites}
      selectedSiteId={site.id}
      siteSelectorPathname="/referrers"
    >
      <main className="main-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">{site.domain}</p>
            <h1>Referrers</h1>
          </div>

          <div className="header-actions" aria-label="Referrers controls">
            <a
              className="csv-export-link"
              href={csvHref}
              download
              aria-label="Export Referrers as CSV"
            >
              CSV
            </a>
            <ReportingRangeSelector
              selectedPreset={rangePreset}
              selectedSiteId={site.id}
              firstSiteId={sites[0].id}
              pathname="/referrers"
            />
          </div>
        </header>

        <section
          className="referrers-section"
          aria-labelledby="referrers-report-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="referrers-report-heading">Traffic sources</h2>
              <p>
                Session-ranked referrers for {rangePresetMetadata.periodCopy}
              </p>
            </div>
            <span className="updated-label">{timeZone}</span>
          </div>

          <article className="ranking-panel referrers-ranking">
            <h3>Referrers</h3>
            <table className="ranking-table">
              <thead>
                <tr>
                  <th scope="col">Referrer</th>
                  <th scope="col">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {referrers.length > 0 ? referrers.map((referrer) => {
                  const label = referrer.referrer ?? "Direct";

                  return (
                    <tr
                      key={referrer.referrer === null
                        ? "referrer:null"
                        : `referrer:${referrer.referrer}`}
                    >
                      <td>
                        <span
                          className="ranking-bar"
                          style={{
                            width: maximumSessions > 0
                              ? `${(referrer.sessions / maximumSessions) * 100}%`
                              : "0%",
                          }}
                          aria-hidden="true"
                        />
                        <span className="ranking-label">{label}</span>
                      </td>
                      <td>{formatCount(referrer.sessions)}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td className="ranking-empty" colSpan={2}>
                      No referring sessions in this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </article>
        </section>
      </main>
    </DashboardShell>
  );
}
