import { DashboardShell } from "../dashboard-shell";
import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import { listSites } from "../../lib/server/sites";
import { SiteRegistrationForm } from "./site-registration-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const sites = listSites(getRuntimeDatabase());

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

        <section className="settings-section" aria-labelledby="site-configuration-heading">
          <div className="settings-heading">
            <h2 id="site-configuration-heading">Site configuration</h2>
            <p>Register the websites you want Lytics to recognize.</p>
          </div>

          <div className="settings-grid">
            <section className="settings-panel" aria-labelledby="registered-sites-heading">
              <div className="settings-panel-heading">
                <div>
                  <h3 id="registered-sites-heading">Registered sites</h3>
                  <p>{sites.length === 1 ? "1 site" : `${sites.length} sites`}</p>
                </div>
              </div>

              {sites.length > 0 ? (
                <ul className="site-list">
                  {sites.map((site) => (
                    <li key={site.id}>
                      <span className="registered-site-mark" aria-hidden="true">
                        {site.name.charAt(0)}
                      </span>
                      <span className="registered-site-copy">
                        <strong>{site.name}</strong>
                        <span>{site.domain}</span>
                      </span>
                    </li>
                  ))}
                </ul>
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
