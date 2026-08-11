"use client";

import { useActionState, useEffect, useId, useState } from "react";

import { deleteSiteAction, type SiteDeleteActionState } from "./actions";

const initialState: SiteDeleteActionState = {
  status: "idle",
  message: "",
};

type SiteDeleteFormProps = {
  domain: string;
  panelId: string;
  siteId: number;
  siteName: string;
  visible: boolean;
};

export function SiteDeleteForm({
  domain,
  panelId,
  siteId,
  siteName,
  visible,
}: SiteDeleteFormProps) {
  const generatedId = useId();
  const headingId = `site-delete-heading-${generatedId}`;
  const warningId = `site-delete-warning-${generatedId}`;
  const inputId = `site-delete-confirmation-${generatedId}`;
  const [state, formAction, isPending] = useActionState(
    deleteSiteAction,
    initialState,
  );
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!visible) {
      setConfirmation("");
    }
  }, [visible]);

  const isConfirmed = confirmation === domain;

  return (
    <section id={panelId} className="site-delete-panel" aria-labelledby={headingId}>
      <div className="site-delete-heading">
        <h4 id={headingId}>Delete {siteName}</h4>
        <p id={warningId}>
          This permanently deletes the registered site and all its analytics.
          Lytics will stop accepting tracking for {domain} until it is
          registered again.
        </p>
      </div>

      <form className="site-delete-form" action={formAction}>
        <input name="siteId" type="hidden" value={siteId} />
        <label htmlFor={inputId}>
          Type <code>{domain}</code> to confirm site deletion
        </label>
        <div className="site-delete-controls">
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
            {isPending ? "Deleting…" : "Permanently delete site"}
          </button>
        </div>
      </form>

      <p
        className={`site-delete-message ${state.status}`}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
      >
        {state.message}
      </p>
    </section>
  );
}
