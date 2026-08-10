import { DashboardShell } from "./dashboard-shell";

const overviewMetrics = [
  { label: "Unique visitors", value: "12,842", comparison: "+12.4% vs prior period", tone: "positive" },
  { label: "Sessions", value: "15,907", comparison: "+8.2% vs prior period", tone: "positive" },
  { label: "Pageviews", value: "42,631", comparison: "+14.6% vs prior period", tone: "positive" },
  { label: "Pages per session", value: "2.68", comparison: "+5.9% vs prior period", tone: "positive" },
  { label: "Bounce rate", value: "38.4%", comparison: "−2.1% vs prior period", tone: "negative" },
  { label: "Session duration", value: "2m 16s", comparison: "+7.8% vs prior period", tone: "positive" },
] as const;

const uniqueVisitorsTrend = [
  { label: "Mon 3", date: "August 3, 2026", value: 1580 },
  { label: "Tue 4", date: "August 4, 2026", value: 1714 },
  { label: "Wed 5", date: "August 5, 2026", value: 1838 },
  { label: "Thu 6", date: "August 6, 2026", value: 1647 },
  { label: "Fri 7", date: "August 7, 2026", value: 2053 },
  { label: "Sat 8", date: "August 8, 2026", value: 1896 },
  { label: "Sun 9", date: "August 9, 2026", value: 2114 },
] as const;

const referrers = [
  { label: "google.com", sessions: 5216 },
  { label: "Direct", sessions: 3804 },
  { label: "github.com", sessions: 1782 },
  { label: "duckduckgo.com", sessions: 1104 },
  { label: "bing.com", sessions: 742 },
  { label: "newsletter.example.com", sessions: 496 },
] as const;

const pages = [
  { label: "/", sessions: 4960 },
  { label: "/blog/self-hosted-analytics", sessions: 2618 },
  { label: "/projects", sessions: 1844 },
  { label: "/notes/sqlite-analytics", sessions: 1327 },
  { label: "/about", sessions: 986 },
  { label: "/contact", sessions: 704 },
] as const;

export default function Home() {
  const chartWidth = 600;
  const chartHeight = 200;
  const chartTop = 8;
  const chartBottom = 192;
  const chartMaximum = 2400;
  const gridValues = [2400, 1800, 1200, 600, 0];
  const points = uniqueVisitorsTrend.map((point, index) => ({
    ...point,
    x: (index / (uniqueVisitorsTrend.length - 1)) * chartWidth,
    y: chartBottom - (point.value / chartMaximum) * (chartBottom - chartTop),
  }));
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `M 0 ${chartBottom} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${chartWidth} ${chartBottom} Z`;

  return (
    <DashboardShell activeSection="Overview">
      <main className="main-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">example.com</p>
            <h1>Overview</h1>
          </div>

          <div className="header-actions" aria-label="Overview controls">
            <span className="realtime-status">
              <span className="live-dot" aria-hidden="true" />
              Live
            </span>
            <button type="button" disabled aria-label="Export overview as CSV">CSV</button>
            <button type="button" disabled aria-label="Select date range, currently Last 7 days">Last 7 days</button>
          </div>
        </header>

        <section className="overview-section" aria-labelledby="overview-heading">
          <div className="section-heading">
            <div>
              <h2 id="overview-heading">Overview</h2>
              <p>Key activity for the selected period</p>
            </div>
            <span className="updated-label">Updated just now</span>
          </div>

          <div className="kpi-grid">
            {overviewMetrics.map((metric) => (
              <article className="kpi-card" key={metric.label}>
                <p className="kpi-label">{metric.label}</p>
                <p className="kpi-value">{metric.value}</p>
                <p className={`kpi-comparison ${metric.tone}`}>{metric.comparison}</p>
              </article>
            ))}
          </div>

          <figure className="trend-panel" aria-labelledby="trend-title trend-description">
            <figcaption className="trend-header">
              <div>
                <h3 id="trend-title">Unique visitors</h3>
                <p id="trend-description">Daily unique visitors for August 3–9, 2026</p>
              </div>
              <span className="chart-interval" aria-label="Chart interval: Daily">Daily</span>
            </figcaption>

            <div className="trend-chart">
              <div className="chart-y-axis" aria-hidden="true">
                {gridValues.map((value) => (
                  <span key={value}>{value.toLocaleString("en-US")}</span>
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
                  <path className="chart-area" d={areaPath} />
                  <polyline className="chart-line" points={linePoints} />
                  {points.map((point) => (
                    <line className="chart-point" x1={point.x} x2={point.x + 0.01} y1={point.y} y2={point.y} key={point.date} />
                  ))}
                </svg>
                <div className="chart-x-axis" aria-hidden="true">
                  {uniqueVisitorsTrend.map((point) => (
                    <span key={point.date}>{point.label}</span>
                  ))}
                </div>
              </div>
            </div>

            <ul className="visually-hidden">
              {uniqueVisitorsTrend.map((point) => (
                <li key={point.date}>{point.date}: {point.value.toLocaleString("en-US")} unique visitors</li>
              ))}
            </ul>
          </figure>

          <section className="rankings-grid" aria-label="Traffic rankings">
            {[
              { title: "Referrers", items: referrers },
              { title: "Pages", items: pages },
            ].map((ranking) => {
              const maximumSessions = ranking.items[0].sessions;

              return (
                <article className="ranking-panel" key={ranking.title}>
                  <h3>{ranking.title}</h3>
                  <table className="ranking-table">
                    <thead>
                      <tr>
                        <th scope="col">{ranking.title === "Referrers" ? "Referrer" : "Page"}</th>
                        <th scope="col">Sessions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.items.map((item) => (
                        <tr key={item.label}>
                          <td>
                            <span
                              className="ranking-bar"
                              style={{ width: `${(item.sessions / maximumSessions) * 100}%` }}
                              aria-hidden="true"
                            />
                            <span className="ranking-label">{item.label}</span>
                          </td>
                          <td>{item.sessions.toLocaleString("en-US")}</td>
                        </tr>
                      ))}
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
