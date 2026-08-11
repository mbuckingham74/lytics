"use client";

import { useActionState, useEffect, useId, useState } from "react";

import {
  resetSiteAnalyticsAction,
  type SiteAnalyticsResetActionState,
} from "./actions";

const initialState: SiteAnalyticsResetActionState = {
  status: "idle",
  message: "",
};

type SiteAnalyticsResetFormProps = {
  domain: string;
  panelId: string;
  siteId: number;
  siteName: string;
  visible: boolean;
};

export function SiteAnalyticsResetForm({
  domain,
  panelId,
  siteId,
  siteName,
  visible,
}: SiteAnalyticsResetFormProps) {
  const generatedId = useId();
  const headingId = `site-reset-heading-${generatedId}`;
  const warningId = `site-reset-warning-${generatedId}`;
  const inputId = `site-reset-confirmation-${generatedId}`;
  const [state, formAction, isPending] = useActionState(
    resetSiteAnalyticsAction,
    initialState,
  );
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!visible || state.status === "success") {
      setConfirmation("");
    }
  }, [state, visible]);

  const isConfirmed = confirmation === domain;

  return (
    <section
      id={panelId}
      className="site-analytics-reset-panel"
      aria-labelledby={headingId}
    >
      <div className="site-analytics-reset-heading">
        <h4 id={headingId}>Reset analytics for {siteName}</h4>
        <p id={warningId}>
          This permanently deletes this site&apos;s collected analytics. The
          registered site and its tracking setup remain.
        </p>
      </div>

      <form className="site-analytics-reset-form" action={formAction}>
        <input name="siteId" type="hidden" value={siteId} />
        <label htmlFor={inputId}>
          Type <code>{domain}</code> to confirm
        </label>
        <div className="site-analytics-reset-controls">
          <input
            id={inputId}
            name="confirmationDomain"
            type="text"
            value={confirmation}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            aria-describedby={warningId}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <button type="submit" disabled={!isConfirmed || isPending}>
            {isPending ? "Resetting…" : "Permanently reset data"}
          </button>
        </div>
      </form>

      <p
        className={`site-analytics-reset-message ${state.status}`}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {state.message}
      </p>
    </section>
  );
}
