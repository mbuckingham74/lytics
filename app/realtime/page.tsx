import Link from "next/link";

import {
  createOverviewHref,
  resolveOverviewSite,
} from "../../lib/overview-query";
import { getActiveVisitorCount } from "../../lib/server/pageviews";
import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import { listSites } from "../../lib/server/sites";
import { DashboardShell } from "../dashboard-shell";
import { RealtimeVisitorCount } from "../realtime-visitor-count";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RealtimeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function EmptyRealtime() {
  return (
    <DashboardShell
      activeSection="Realtime"
      siteCaption="Website"
      siteName="No site registered"
    >
      <main className="main-content overview-empty-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">No website selected</p>
            <h1>Realtime</h1>
          </div>
        </header>

        <section
          className="overview-onboarding"
          aria-labelledby="realtime-empty-heading"
        >
          <span className="onboarding-mark" aria-hidden="true">+</span>
          <p className="onboarding-eyebrow">See visitors as they arrive</p>
          <h2 id="realtime-empty-heading">Register your first site</h2>
          <p className="onboarding-copy">
            Add a website in Settings to see its current visitor activity.
          </p>
          <Link className="onboarding-link" href="/settings">Open Settings</Link>
        </section>
      </main>
    </DashboardShell>
  );
}

export default async function Realtime({ searchParams }: RealtimeProps) {
  const database = getRuntimeDatabase();
  const sites = listSites(database);

  if (sites.length === 0) {
    return <EmptyRealtime />;
  }

  const query = await searchParams;
  const site = resolveOverviewSite(sites, query.site);

  if (!site) {
    return <EmptyRealtime />;
  }

  const nowAt = new Date();
  const initialVisitors = getActiveVisitorCount(database, {
    siteId: site.id,
    nowAt,
  });
  const endpoint = createOverviewHref({
    siteId: site.id,
    firstSiteId: sites[0].id,
    rangePreset: "7d",
    pathname: "/api/realtime",
  });

  return (
    <DashboardShell
      activeSection="Realtime"
      siteOptions={sites}
      selectedSiteId={site.id}
      siteSelectorPathname="/realtime"
      siteSelectorPreserveRange={false}
    >
      <main className="main-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">{site.domain}</p>
            <h1>Realtime</h1>
          </div>
        </header>

        <section
          className="realtime-section"
          aria-labelledby="realtime-activity-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="realtime-activity-heading">Visitors right now</h2>
              <p>Current activity for {site.name}</p>
            </div>
          </div>

          <div className="realtime-panel">
            <RealtimeVisitorCount
              endpoint={endpoint}
              initialVisitors={initialVisitors}
            />
            <p className="realtime-description">
              Distinct visitors active in the last five minutes. This count
              refreshes every 15 seconds.
            </p>
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
