import Link from "next/link";
import type { ReactNode } from "react";

const navigationItems = [
  { label: "Overview", href: "/" },
  { label: "Pages" },
  { label: "Referrers" },
  { label: "Geography" },
  { label: "Technology" },
  { label: "Realtime" },
  { label: "Settings", href: "/settings" },
] as const;

type DashboardShellProps = {
  activeSection: "Overview" | "Settings";
  children: ReactNode;
  siteCaption?: string;
  siteName?: string;
};

export function DashboardShell({
  activeSection,
  children,
  siteCaption = "Website",
  siteName = "example.com",
}: DashboardShellProps) {
  return (
    <div className="dashboard-shell">
      <aside className="sidebar" aria-label="Dashboard sidebar">
        <div className="wordmark">Lytics</div>

        <button className="site-selector" type="button" aria-label="Select website" disabled>
          <span className="site-mark" aria-hidden="true">{siteName.charAt(0)}</span>
          <span className="site-copy">
            <span className="site-caption">{siteCaption}</span>
            <span className="site-name">{siteName}</span>
          </span>
          <span className="selector-chevron" aria-hidden="true">⌄</span>
        </button>

        <nav className="primary-nav" aria-label="Analytics sections">
          <ul>
            {navigationItems.map((item) => {
              const className = item.label === activeSection ? "nav-item selected" : "nav-item";
              const content = (
                <>
                  <span className="nav-dot" aria-hidden="true" />
                  {item.label}
                </>
              );

              return (
                <li key={item.label}>
                  {"href" in item ? (
                    <Link
                      className={className}
                      href={item.href}
                      aria-current={item.label === activeSection ? "page" : undefined}
                    >
                      {content}
                    </Link>
                  ) : (
                    <span className={className}>{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {children}
    </div>
  );
}
