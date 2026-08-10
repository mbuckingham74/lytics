import Link from "next/link";

import { getOverviewReport } from "../lib/server/overview-report";
import {
  createRecentCalendarSelection,
  getReportingTimeZone,
} from "../lib/server/reporting-range";
import { getRuntimeDatabase } from "../lib/server/runtime-database";
import { listSites } from "../lib/server/sites";
import { DashboardShell } from "./dashboard-shell";

export const dynamic = "force-dynamic";

const chartWidth = 600;
const chartHeight = 200;
const chartTop = 8;
const chartBottom = 192;

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveSelectedSite(
  sites: ReturnType<typeof listSites>,
  value: string | string[] | undefined,
) {
  const fallbackSite = sites[0];

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return fallbackSite;
  }

  const siteId = Number(value);

  if (!Number.isSafeInteger(siteId)) {
    return fallbackSite;
  }

  return sites.find((site) => site.id === siteId) ?? fallbackSite;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function toUtcCalendarInstant(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(0, 0, 0, 0);
  return instant;
}

function formatShortTrendDate(
  formatter: Intl.DateTimeFormat,
  date: string,
): string {
  const parts = formatter.formatToParts(toUtcCalendarInstant(date));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${weekday} ${day}`;
}

function EmptyOverview() {
  return (
    <DashboardShell
      activeSection="Overview"
      siteCaption="Website"
      siteName="No site registered"
    >
      <main className="main-content overview-empty-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">No website selected</p>
            <h1>Overview</h1>
          </div>
        </header>

        <section className="overview-onboarding" aria-labelledby="overview-empty-heading">
          <span className="onboarding-mark" aria-hidden="true">+</span>
          <p className="onboarding-eyebrow">Start collecting analytics</p>
          <h2 id="overview-empty-heading">Register your first site</h2>
          <p className="onboarding-copy">
            Add a website in Settings to make its real analytics available here.
          </p>
          <Link className="onboarding-link" href="/settings">Open Settings</Link>
        </section>
      </main>
    </DashboardShell>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const database = getRuntimeDatabase();
  const sites = listSites(database);

  if (sites.length === 0) {
    return <EmptyOverview />;
  }

  const site = resolveSelectedSite(sites, (await searchParams).site);

  const nowAt = new Date();
  const timeZone = getReportingTimeZone();
  const selection = createRecentCalendarSelection({
    nowAt,
    timeZone,
    dayCount: 7,
  });
  const report = getOverviewReport(database, {
    siteId: site.id,
    ...selection,
    timeZone,
    nowAt,
  });
  const overviewMetrics = [
    { label: "Unique visitors", value: formatCount(report.uniqueVisitors) },
    { label: "Sessions", value: formatCount(report.sessions) },
    { label: "Pageviews", value: formatCount(report.pageviews) },
    { label: "Pages per session", value: formatDecimal(report.pagesPerSession, 2) },
    { label: "Bounce rate", value: `${formatDecimal(report.bounceRate, 1)}%` },
    { label: "Session duration", value: formatDuration(report.averageSessionDurationSeconds) },
  ];
  const maximumTrendValue = Math.max(
    0,
    ...report.dailyUniqueVisitorTrend.map((point) => point.uniqueVisitors),
  );
  const chartMaximum = Math.max(4, Math.ceil(maximumTrendValue / 4) * 4);
  const gridValues = [
    chartMaximum,
    chartMaximum * 0.75,
    chartMaximum * 0.5,
    chartMaximum * 0.25,
    0,
  ];
  const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
  });
  const accessibleDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const points = report.dailyUniqueVisitorTrend.map((point, index) => ({
    ...point,
    label: formatShortTrendDate(shortDateFormatter, point.date),
    accessibleDate: accessibleDateFormatter.format(toUtcCalendarInstant(point.date)),
    x:
      (index / Math.max(report.dailyUniqueVisitorTrend.length - 1, 1)) *
      chartWidth,
    y:
      chartBottom -
      (point.uniqueVisitors / chartMaximum) * (chartBottom - chartTop),
  }));
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = points.length > 0
    ? `M 0 ${chartBottom} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${chartWidth} ${chartBottom} Z`
    : "";
  const firstTrendDate = points[0]?.accessibleDate ?? report.startDate;
  const lastTrendDate = points[points.length - 1]?.accessibleDate ?? report.endDate;
  const rankingPanels = [
    {
      title: "Referrers",
      columnTitle: "Referrer",
      items: report.sessionRankedReferrers.slice(0, 6).map((item) => ({
        label: item.referrer ?? "Direct",
        sessions: item.sessions,
      })),
    },
    {
      title: "Pages",
      columnTitle: "Page",
      items: report.sessionRankedPages.slice(0, 6).map((item) => ({
        label: item.path,
        sessions: item.sessions,
      })),
    },
  ];

  return (
    <DashboardShell
      activeSection="Overview"
      siteOptions={sites}
      selectedSiteId={site.id}
    >
      <main className="main-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">{site.domain}</p>
            <h1>Overview</h1>
          </div>

          <div className="header-actions" aria-label="Overview controls">
            <span className="realtime-status">
              <span className="live-dot" aria-hidden="true" />
              {formatCount(report.realtimeVisitors)} live now
            </span>
            <button type="button" disabled aria-label="Export overview as CSV">CSV</button>
            <button type="button" disabled aria-label="Select date range, currently Last 7 days">Last 7 days</button>
          </div>
        </header>

        <section className="overview-section" aria-labelledby="overview-heading">
          <div className="section-heading">
            <div>
              <h2 id="overview-heading">Overview</h2>
              <p>Key activity for the selected 7-day period</p>
            </div>
            <span className="updated-label">{report.timeZone}</span>
          </div>

          <div className="kpi-grid">
            {overviewMetrics.map((metric) => (
              <article className="kpi-card" key={metric.label}>
                <p className="kpi-label">{metric.label}</p>
                <p className="kpi-value">{metric.value}</p>
                <p className="kpi-comparison neutral">Selected period</p>
              </article>
            ))}
          </div>

          <figure className="trend-panel" aria-labelledby="trend-title trend-description">
            <figcaption className="trend-header">
              <div>
                <h3 id="trend-title">Unique visitors</h3>
                <p id="trend-description">
                  Daily unique visitors for {firstTrendDate}–{lastTrendDate}
                </p>
              </div>
              <span className="chart-interval" aria-label="Chart interval: Daily">Daily</span>
            </figcaption>

            <div className="trend-chart">
              <div className="chart-y-axis" aria-hidden="true">
                {gridValues.map((value) => (
                  <span key={value}>{formatCount(value)}</span>
                ))}
              </div>
              <div className="chart-visual">
                <svg
                  className="chart-svg"
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <defs>
                    <linearGradient id="unique-visitors-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b8cf6" stopOpacity="0.24" />
                      <stop offset="100%" stopColor="#8b8cf6" stopOpacity="0.015" />
                    </linearGradient>
                  </defs>
                  {gridValues.map((value) => {
                    const y = chartBottom - (value / chartMaximum) * (chartBottom - chartTop);
                    return <line className="chart-grid-line" x1="0" x2={chartWidth} y1={y} y2={y} key={value} />;
                  })}
                  {areaPath ? <path className="chart-area" d={areaPath} /> : null}
                  {linePoints ? <polyline className="chart-line" points={linePoints} /> : null}
                  {points.map((point) => (
                    <line
                      className="chart-point"
                      x1={point.x}
                      x2={point.x + 0.01}
                      y1={point.y}
                      y2={point.y}
                      key={point.date}
                    />
                  ))}
                </svg>
                <div className="chart-x-axis" aria-hidden="true">
                  {points.map((point) => (
                    <span key={point.date}>{point.label}</span>
                  ))}
                </div>
              </div>
            </div>

            <ul className="visually-hidden">
              {points.map((point) => (
                <li key={point.date}>
                  {point.accessibleDate}: {formatCount(point.uniqueVisitors)} unique {point.uniqueVisitors === 1 ? "visitor" : "visitors"}
                </li>
              ))}
            </ul>
          </figure>

          <section className="rankings-grid" aria-label="Traffic rankings">
            {rankingPanels.map((ranking) => {
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
                        <tr key={`${index}-${item.label}`}>
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
                            <span className="ranking-label">{item.label}</span>
                          </td>
                          <td>{formatCount(item.sessions)}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td className="ranking-empty" colSpan={2}>No sessions in this period</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </article>
              );
            })}
          </section>
        </section>
      </main>
    </DashboardShell>
  );
}
