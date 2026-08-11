import { DashboardShell } from "../dashboard-shell";
import { getReportingTimeZone } from "../../lib/server/reporting-range";
import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import { listSiteTrackingSummaries } from "../../lib/server/sites";
import { resolveTrackingEnrichmentDiagnostic } from "../../lib/tracking-diagnostics";
import { SiteRegistrationForm } from "./site-registration-form";
import { RegisteredSiteTableRows } from "./site-tracking-snippet";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseDeletionNotice(
  query: Record<string, string | string[] | undefined>,
): { deletedSites: number; deletedPageviews: number } | null {
  const allowedKeys = new Set(["deletedSites", "deletedPageviews"]);

  if (Object.keys(query).some((key) => !allowedKeys.has(key))) {
    return null;
  }

  if (query.deletedSites !== "1") {
    return null;
  }

  const rawDeletedPageviews = query.deletedPageviews;

  if (
    typeof rawDeletedPageviews !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(rawDeletedPageviews)
  ) {
    return null;
  }

  const deletedPageviews = Number(rawDeletedPageviews);

  if (!Number.isSafeInteger(deletedPageviews)) {
    return null;
  }

  return { deletedSites: Number(query.deletedSites), deletedPageviews };
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const deletionNotice = parseDeletionNotice(await searchParams);
  const nowAt = new Date();
  const timeZone = getReportingTimeZone();
  const siteSummaries = listSiteTrackingSummaries(getRuntimeDatabase(), {
    nowAt,
    timeZone,
  });
  const registeredAtFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const lastPageviewFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <DashboardShell
      activeSection="Settings"
      siteCaption="Configuration"
      siteName="Manage sites"
    >
      <main className="main-content settings-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">Sites</p>
            <h1>Settings</h1>
          </div>
        </header>

        {deletionNotice ? (
          <p
            className="settings-deletion-notice"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            Deleted {deletionNotice.deletedSites}{" "}
            {deletionNotice.deletedSites === 1 ? "site" : "sites"} and{" "}
            {deletionNotice.deletedPageviews.toLocaleString("en-US")} {" "}
            {deletionNotice.deletedPageviews === 1 ? "pageview" : "pageviews"}.
          </p>
        ) : null}

        <section className="settings-section" aria-labelledby="site-configuration-heading">
          <div className="settings-heading">
            <h2 id="site-configuration-heading">Site configuration</h2>
            <p>Register the websites you want Lytics to recognize.</p>
          </div>

          <div className="settings-grid">
            <section
              className="settings-panel active-sites-panel"
              aria-labelledby="active-sites-heading"
            >
              <div className="settings-panel-heading">
                <div>
                  <h3 id="active-sites-heading">Active sites</h3>
                  <p>
                    {siteSummaries.length === 1
                      ? "1 site"
                      : `${siteSummaries.length} sites`}
                  </p>
                </div>
              </div>

              {siteSummaries.length > 0 ? (
                <div className="active-sites-table-wrap">
                  <table className="active-sites-table">
                    <caption className="visually-hidden">
                      Active sites tracking overview
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Site</th>
                        <th scope="col">Status</th>
                        <th scope="col">Registered</th>
                        <th className="active-site-number" scope="col">
                          Events today
                        </th>
                        <th className="active-site-number" scope="col">Total hits</th>
                        <th scope="col">Last hit</th>
                        <th scope="col">Enrichment today</th>
                        <th className="active-site-action" scope="col">
                          Tracking
                        </th>
                        <th className="active-site-action" scope="col">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {siteSummaries.map((site) => {
                        const registeredAt = site.registeredAt?.toISOString() ?? null;
                        const registeredAtLabel = site.registeredAt && registeredAtFormatter
                          ? registeredAtFormatter.format(site.registeredAt)
                          : null;
                        const lastPageviewAt = site.lastPageviewAt?.toISOString() ?? null;
                        const lastPageviewLabel = site.lastPageviewAt && lastPageviewFormatter
                          ? lastPageviewFormatter.format(site.lastPageviewAt)
                          : null;
                        const geographyDiagnostic =
                          resolveTrackingEnrichmentDiagnostic({
                            eventsToday: site.eventsToday,
                            enrichedEventsToday:
                              site.geographyEnrichedEventsToday,
                          });
                        const technologyDiagnostic =
                          resolveTrackingEnrichmentDiagnostic({
                            eventsToday: site.eventsToday,
                            enrichedEventsToday:
                              site.technologyEnrichedEventsToday,
                          });

                        return (
                          <RegisteredSiteTableRows
                            key={site.id}
                            domain={site.domain}
                            eventsToday={site.eventsToday.toLocaleString("en-US")}
                            geographyDiagnostic={geographyDiagnostic}
                            name={site.name}
                            registeredAt={registeredAt}
                            registeredAtLabel={registeredAtLabel}
                            siteId={site.id}
                            totalHits={site.totalPageviews.toLocaleString("en-US")}
                            technologyDiagnostic={technologyDiagnostic}
                            lastPageviewAt={lastPageviewAt}
                            lastPageviewLabel={lastPageviewLabel}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="sites-empty-state">
                  <span className="empty-state-mark" aria-hidden="true">+</span>
                  <h4>No sites registered</h4>
                  <p>Add your first site to begin configuring Lytics.</p>
                </div>
              )}
            </section>

            <section className="settings-panel" aria-labelledby="add-site-heading">
              <div className="settings-panel-heading">
                <div>
                  <h3 id="add-site-heading">Add a site</h3>
                  <p>Names stay readable; domains are stored in lowercase.</p>
                </div>
              </div>
              <SiteRegistrationForm />
            </section>
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
