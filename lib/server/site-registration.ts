import type { DatabaseSync } from "node:sqlite";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import {
  findSiteByDomain,
  listSites,
  registerSite,
  type Site,
  updateSite,
} from "./sites";

export type SiteRegistrationResult =
  | { ok: true; site: Site }
  | { ok: false; message: string };

type SiteRegistrationInput = {
  name: unknown;
  domain: unknown;
};

export type SiteUpdateInput = SiteRegistrationInput & {
  siteId: unknown;
};

export type SiteUpdateResult =
  | { ok: true; site: Site }
  | { ok: false; message: string };

const invalidHostnameMessage =
  "Enter a valid hostname, such as example.com, without a protocol, credentials, port, path, query, or fragment.";

function canonicalizeHostname(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const hostname = value.trim();

  if (
    hostname.length === 0 ||
    hostname.endsWith(".") ||
    /[\s@:/\\?#*_]/u.test(hostname)
  ) {
    return null;
  }

  const asciiHostname = domainToASCII(hostname).toLowerCase();

  if (
    asciiHostname.length === 0 ||
    Buffer.byteLength(asciiHostname, "ascii") > 253 ||
    isIP(asciiHostname) !== 0
  ) {
    return null;
  }

  const labels = asciiHostname.split(".");

  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    ) ||
    !/[a-z]/u.test(labels.at(-1) ?? "")
  ) {
    return null;
  }

  return asciiHostname;
}

export function registerSiteAtBoundary(
  database: DatabaseSync,
  input: SiteRegistrationInput,
): SiteRegistrationResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";

  if (name.length === 0) {
    return { ok: false, message: "Enter a site name." };
  }

  const domain = canonicalizeHostname(input.domain);

  if (!domain) {
    return { ok: false, message: invalidHostnameMessage };
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

export function updateSiteAtBoundary(
  database: DatabaseSync,
  input: SiteUpdateInput,
): SiteUpdateResult {
  if (
    typeof input.siteId !== "number" ||
    !Number.isSafeInteger(input.siteId) ||
    input.siteId <= 0
  ) {
    return { ok: false, message: "Select a valid site." };
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";

  if (name.length === 0) {
    return { ok: false, message: "Enter a site name." };
  }

  const domain = canonicalizeHostname(input.domain);

  if (!domain) {
    return { ok: false, message: invalidHostnameMessage };
  }

  try {
    const currentSite = listSites(database).find(
      (site) => site.id === input.siteId,
    );

    if (!currentSite) {
      return { ok: false, message: "That site is not registered." };
    }

    const domainOwner = findSiteByDomain(database, domain);

    if (domainOwner && domainOwner.id !== currentSite.id) {
      return { ok: false, message: "That domain is already registered." };
    }

    const site = updateSite(database, {
      siteId: currentSite.id,
      name,
      domain,
    });

    if (!site) {
      return { ok: false, message: "That site is not registered." };
    }

    return { ok: true, site };
  } catch {
    try {
      const domainOwner = findSiteByDomain(database, domain);

      if (domainOwner && domainOwner.id !== input.siteId) {
        return { ok: false, message: "That domain is already registered." };
      }
    } catch {
      // Preserve the stable update failure if the database cannot be queried.
    }

    return { ok: false, message: "Could not update the site. Try again." };
  }
}
