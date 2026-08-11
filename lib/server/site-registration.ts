import type { DatabaseSync } from "node:sqlite";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import { findSiteByDomain, registerSite, type Site } from "./sites";

export type SiteRegistrationResult =
  | { ok: true; site: Site }
  | { ok: false; message: string };

type SiteRegistrationInput = {
  name: unknown;
  domain: unknown;
};

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
