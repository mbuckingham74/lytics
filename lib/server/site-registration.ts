import type { DatabaseSync } from "node:sqlite";

import { findSiteByDomain, registerSite, type Site } from "./sites";

export type SiteRegistrationResult =
  | { ok: true; site: Site }
  | { ok: false; message: string };

type SiteRegistrationInput = {
  name: unknown;
  domain: unknown;
};

export function registerSiteAtBoundary(
  database: DatabaseSync,
  input: SiteRegistrationInput,
): SiteRegistrationResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const domain = typeof input.domain === "string" ? input.domain.trim().toLowerCase() : "";

  if (name.length === 0) {
    return { ok: false, message: "Enter a site name." };
  }

  if (domain.length === 0) {
    return { ok: false, message: "Enter a domain." };
  }

  try {
    if (findSiteByDomain(database, domain)) {
      return { ok: false, message: "That domain is already registered." };
    }

    return { ok: true, site: registerSite(database, { name, domain }) };
  } catch {
    try {
      if (findSiteByDomain(database, domain)) {
        return { ok: false, message: "That domain is already registered." };
      }
    } catch {
      // Preserve the stable boundary message if the database cannot be queried.
    }

    return { ok: false, message: "Could not register the site. Try again." };
  }
}
