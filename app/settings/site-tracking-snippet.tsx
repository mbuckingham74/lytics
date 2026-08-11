"use client";

import { useEffect, useId, useState } from "react";

import type { TrackingEnrichmentDiagnostic } from "../../lib/tracking-diagnostics";
import { SiteAnalyticsResetForm } from "./site-analytics-reset-form";
import { SiteDeleteForm } from "./site-delete-form";
import { SiteEditForm } from "./site-edit-form";

type SiteTrackingSnippetProps = {
  panelId?: string;
  resetCopyFeedback?: boolean;
  siteName?: string;
  visible?: boolean;
};

type RegisteredSiteTableRowsProps = {
  domain: string;
  eventsToday: string;
  geographyDiagnostic: TrackingEnrichmentDiagnostic;
  lastPageviewAt: string | null;
  lastPageviewLabel: string | null;
  name: string;
  registeredAt: string | null;
  registeredAtLabel: string | null;
  siteId: number;
  totalHits: string;
  technologyDiagnostic: TrackingEnrichmentDiagnostic;
};

export function SiteTrackingSnippet({
  panelId,
  resetCopyFeedback = false,
  siteName,
  visible = true,
}: SiteTrackingSnippetProps) {
  const generatedId = useId();
  const resolvedPanelId = panelId ?? `tracking-snippet-panel-${generatedId}`;
  const titleId = `tracking-snippet-title-${generatedId}`;
  const [lyticsOrigin, setLyticsOrigin] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    setLyticsOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (resetCopyFeedback) {
      setCopyMessage("");
    }
  }, [resetCopyFeedback]);

  const trackingSnippet = lyticsOrigin
    ? `<script defer src="${lyticsOrigin}/tracker.js"></script>`
    : "";
  const panelTitle = siteName
    ? `Tracking snippet for ${siteName}`
    : "Add tracking to your site";

  async function copyTrackingSnippet() {
    if (!navigator.clipboard?.writeText) {
      setCopyMessage("Clipboard unavailable. Select the snippet and copy it manually.");
      return;
    }

    try {
      await navigator.clipboard.writeText(trackingSnippet);
      setCopyMessage("Snippet copied.");
    } catch {
      setCopyMessage(
        "Could not copy automatically. Select the snippet and copy it manually.",
      );
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <section
      id={resolvedPanelId}
      className="tracking-snippet-panel"
      aria-labelledby={titleId}
    >
      <div className="tracking-snippet-heading">
        <h4 id={titleId}>{panelTitle}</h4>
        <p>Paste this snippet into your site&apos;s HTML.</p>
      </div>

      <div className="tracking-snippet-controls">
        <textarea
          className="tracking-snippet-field"
          aria-label={siteName ? `Tracking snippet for ${siteName}` : "Tracking snippet"}
          readOnly
          rows={2}
          value={trackingSnippet}
        />
        <button
          className="copy-snippet-button"
          type="button"
          onClick={copyTrackingSnippet}
        >
          Copy snippet
        </button>
      </div>

      <p
        className="copy-snippet-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {copyMessage}
      </p>
    </section>
  );
}

export function RegisteredSiteTableRows({
  domain,
  eventsToday,
  geographyDiagnostic,
  lastPageviewAt,
  lastPageviewLabel,
  name,
  registeredAt,
  registeredAtLabel,
  siteId,
  totalHits,
  technologyDiagnostic,
}: RegisteredSiteTableRowsProps) {
  const generatedId = useId();
  const trackingPanelId = `tracking-snippet-panel-${generatedId}`;
  const editPanelId = `site-edit-panel-${generatedId}`;
  const resetPanelId = `site-reset-panel-${generatedId}`;
  const deletePanelId = `site-delete-panel-${generatedId}`;
  const [trackingExpanded, setTrackingExpanded] = useState(false);
  const [editExpanded, setEditExpanded] = useState(false);
  const [resetExpanded, setResetExpanded] = useState(false);
  const [deleteExpanded, setDeleteExpanded] = useState(false);
  const isReceivingData = lastPageviewAt !== null;

  function toggleTrackingExpanded() {
    setTrackingExpanded((currentExpanded) => !currentExpanded);
  }

  function toggleResetExpanded() {
    setResetExpanded((currentExpanded) => !currentExpanded);
  }

  function toggleEditExpanded() {
    setEditExpanded((currentExpanded) => !currentExpanded);
  }

  function toggleDeleteExpanded() {
    setDeleteExpanded((currentExpanded) => !currentExpanded);
  }

  return (
    <>
      <tr className="active-site-row">
        <th className="active-site-name" scope="row">
          <div className="active-site-identity">
            <span className="registered-site-mark" aria-hidden="true">
              {name.charAt(0)}
            </span>
            <div className="registered-site-copy">
              <strong>{name}</strong>
              <span className="registered-site-domain">{domain}</span>
            </div>
          </div>
        </th>
        <td>
          <span
            className={`site-tracking-status ${isReceivingData ? "receiving" : "no-data"}`}
          >
            <span className="site-tracking-status-dot" aria-hidden="true" />
            {isReceivingData ? "Receiving data" : "No data yet"}
          </span>
        </td>
        <td className="active-site-time">
          {registeredAt && registeredAtLabel ? (
            <time dateTime={registeredAt}>{registeredAtLabel}</time>
          ) : (
            <span className="active-site-fallback">Unknown</span>
          )}
        </td>
        <td className="active-site-number">{eventsToday}</td>
        <td className="active-site-number">{totalHits}</td>
        <td className="active-site-time">
          {lastPageviewAt && lastPageviewLabel ? (
            <time dateTime={lastPageviewAt}>{lastPageviewLabel}</time>
          ) : (
            <span className="active-site-fallback">Never</span>
          )}
        </td>
        <td className="active-site-diagnostics">
          <dl className="site-enrichment-diagnostics">
            <div>
              <dt>Geography</dt>
              <dd>{geographyDiagnostic.label}</dd>
            </div>
            <div>
              <dt>Technology</dt>
              <dd>{technologyDiagnostic.label}</dd>
            </div>
          </dl>
        </td>
        <td className="active-site-action">
          <button
            className="view-snippet-button"
            type="button"
            aria-expanded={trackingExpanded}
            aria-controls={trackingPanelId}
            aria-label={`${trackingExpanded ? "Hide" : "View"} tracking snippet for ${name}`}
            onClick={toggleTrackingExpanded}
          >
            {trackingExpanded ? "Hide snippet" : "View snippet"}
          </button>
        </td>
        <td className="active-site-action">
          <div className="active-site-management-actions">
            <button
              className="edit-site-button"
              type="button"
              aria-expanded={editExpanded}
              aria-controls={editPanelId}
              aria-label={`${editExpanded ? "Hide edit" : "Edit"} for ${name}`}
              onClick={toggleEditExpanded}
            >
              {editExpanded ? "Hide edit" : "Edit"}
            </button>
            <button
              className="reset-data-button"
              type="button"
              aria-expanded={resetExpanded}
              aria-controls={resetPanelId}
              aria-label={`${resetExpanded ? "Hide reset" : "Reset data"} for ${name}`}
              onClick={toggleResetExpanded}
            >
              {resetExpanded ? "Hide reset" : "Reset data"}
            </button>
            <button
              className="delete-site-button"
              type="button"
              aria-expanded={deleteExpanded}
              aria-controls={deletePanelId}
              aria-label={`${deleteExpanded ? "Hide deletion" : "Delete site"} for ${name}`}
              onClick={toggleDeleteExpanded}
            >
              {deleteExpanded ? "Hide deletion" : "Delete site"}
            </button>
          </div>
        </td>
      </tr>
      <tr className="active-site-edit-row" hidden={!editExpanded}>
        <td className="active-site-edit-cell" colSpan={9}>
          <SiteEditForm
            currentDomain={domain}
            currentName={name}
            panelId={editPanelId}
            siteId={siteId}
            visible={editExpanded}
          />
        </td>
      </tr>
      <tr className="active-site-snippet-row" hidden={!trackingExpanded}>
        <td className="active-site-snippet-cell" colSpan={9}>
          <SiteTrackingSnippet
            panelId={trackingPanelId}
            resetCopyFeedback={!trackingExpanded}
            siteName={name}
          />
        </td>
      </tr>
      <tr className="active-site-reset-row" hidden={!resetExpanded}>
        <td className="active-site-reset-cell" colSpan={9}>
          <SiteAnalyticsResetForm
            domain={domain}
            panelId={resetPanelId}
            siteId={siteId}
            siteName={name}
            visible={resetExpanded}
          />
        </td>
      </tr>
      <tr className="active-site-delete-row" hidden={!deleteExpanded}>
        <td className="active-site-delete-cell" colSpan={9}>
          <SiteDeleteForm
            domain={domain}
            panelId={deletePanelId}
            siteId={siteId}
            siteName={name}
            visible={deleteExpanded}
          />
        </td>
      </tr>
    </>
  );
}
