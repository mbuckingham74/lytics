"use client";

import { useActionState } from "react";

import {
  registerSiteAction,
  type SiteRegistrationActionState,
} from "./actions";

const initialState: SiteRegistrationActionState = {
  status: "idle",
  message: "",
};

export function SiteRegistrationForm() {
  const [state, formAction, isPending] = useActionState(registerSiteAction, initialState);

  return (
    <form className="site-registration-form" action={formAction}>
      <div className="form-field">
        <label htmlFor="site-name">Site name</label>
        <input
          id="site-name"
          name="name"
          type="text"
          autoComplete="organization"
          placeholder="Personal site"
          aria-required="true"
        />
      </div>

      <div className="form-field">
        <label htmlFor="site-domain">Domain</label>
        <input
          id="site-domain"
          name="domain"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          placeholder="example.com"
          aria-describedby="site-domain-help"
          aria-required="true"
        />
        <p id="site-domain-help">Enter the hostname without a protocol or path.</p>
      </div>

      <button className="register-site-button" type="submit" disabled={isPending}>
        {isPending ? "Registering…" : "Register site"}
      </button>

      <p
        className={`form-message ${state.status}`}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {state.message}
      </p>
    </form>
  );
}
