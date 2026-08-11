"use client";

import { useActionState, useEffect, useId, useState } from "react";

import { updateSiteAction, type SiteUpdateActionState } from "./actions";

const initialState: SiteUpdateActionState = {
  status: "idle",
  message: "",
  savedSite: null,
};

type SiteEditFormProps = {
  currentDomain: string;
  currentName: string;
  panelId: string;
  siteId: number;
  visible: boolean;
};

export function SiteEditForm({
  currentDomain,
  currentName,
  panelId,
  siteId,
  visible,
}: SiteEditFormProps) {
  const generatedId = useId();
  const headingId = `site-edit-heading-${generatedId}`;
  const nameInputId = `site-edit-name-${generatedId}`;
  const domainInputId = `site-edit-domain-${generatedId}`;
  const domainHelpId = `site-edit-domain-help-${generatedId}`;
  const [state, formAction, isPending] = useActionState(
    updateSiteAction,
    initialState,
  );
  const [name, setName] = useState(currentName);
  const [domain, setDomain] = useState(currentDomain);

  useEffect(() => {
    if (state.status === "success" && state.savedSite) {
      setName(state.savedSite.name);
      setDomain(state.savedSite.domain);
    }
  }, [state]);

  useEffect(() => {
    if (!visible) {
      setName(currentName);
      setDomain(currentDomain);
    }
  }, [currentDomain, currentName, visible]);

  return (
    <section id={panelId} className="site-edit-panel" aria-labelledby={headingId}>
      <div className="site-edit-heading">
        <h4 id={headingId}>Edit {currentName}</h4>
        <p>Update the display name or the hostname used to identify this site.</p>
      </div>

      <form className="site-edit-form" action={formAction}>
        <input name="siteId" type="hidden" value={siteId} />
        <div className="site-edit-fields">
          <div className="site-edit-field">
            <label htmlFor={nameInputId}>Site name</label>
            <input
              id={nameInputId}
              name="name"
              type="text"
              value={name}
              autoComplete="organization"
              required
              aria-required="true"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="site-edit-field">
            <label htmlFor={domainInputId}>Domain</label>
            <input
              id={domainInputId}
              name="domain"
              type="text"
              value={domain}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              required
              aria-describedby={domainHelpId}
              aria-required="true"
              onChange={(event) => setDomain(event.target.value)}
            />
            <p id={domainHelpId}>
              Enter only a hostname, such as example.com—no protocol,
              credentials, port, path, query, fragment, wildcard, IP address,
              or localhost.
            </p>
          </div>
        </div>

        <button className="save-site-button" type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </form>

      <p
        className={`site-edit-message ${state.status}`}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
      >
        {state.message}
      </p>
    </section>
  );
}
