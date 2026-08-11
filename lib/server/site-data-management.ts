import type { DatabaseSync } from "node:sqlite";

export type ResetSiteAnalyticsResult =
  | { ok: true; deletedPageviews: number }
  | { ok: false; message: string };

export type DeleteSiteResult =
  | { ok: true; deletedSites: 1; deletedPageviews: number }
  | { ok: false; message: string };

const invalidSiteMessage = "Select a valid site.";
const missingSiteMessage = "That site is not registered.";
const resetFailureMessage = "Could not reset site analytics. Try again.";
const deleteFailureMessage = "Could not delete the site. Try again.";
const deleteSiteSavepoint = "lytics_delete_site_boundary";

function toExactDeletedPageviewCount(value: number | bigint): number {
  if (typeof value === "bigint") {
    if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Deleted pageview count is outside the supported range");
    }

    return Number(value);
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Deleted pageview count is outside the supported range");
  }

  return value;
}

export function resetSiteAnalyticsAtBoundary(
  database: DatabaseSync,
  siteId: unknown,
): ResetSiteAnalyticsResult {
  if (
    typeof siteId !== "number" ||
    !Number.isSafeInteger(siteId) ||
    siteId <= 0
  ) {
    return { ok: false, message: invalidSiteMessage };
  }

  try {
    const siteExists = database
      .prepare("SELECT 1 FROM sites WHERE id = ?")
      .get(siteId);

    if (!siteExists) {
      return { ok: false, message: missingSiteMessage };
    }

    const result = database
      .prepare("DELETE FROM pageviews WHERE site_id = ?")
      .run(siteId);

    return {
      ok: true,
      deletedPageviews: toExactDeletedPageviewCount(result.changes),
    };
  } catch {
    return { ok: false, message: resetFailureMessage };
  }
}

export function deleteSiteAtBoundary(
  database: DatabaseSync,
  siteId: unknown,
): DeleteSiteResult {
  if (
    typeof siteId !== "number" ||
    !Number.isSafeInteger(siteId) ||
    siteId <= 0
  ) {
    return { ok: false, message: invalidSiteMessage };
  }

  let savepointIsOpen = false;

  try {
    database.exec(`SAVEPOINT ${deleteSiteSavepoint}`);
    savepointIsOpen = true;

    const siteExists = database
      .prepare("SELECT 1 FROM sites WHERE id = ?")
      .get(siteId);

    if (!siteExists) {
      database.exec(`RELEASE SAVEPOINT ${deleteSiteSavepoint}`);
      savepointIsOpen = false;
      return { ok: false, message: missingSiteMessage };
    }

    const deletedPageviews = toExactDeletedPageviewCount(
      database
        .prepare("DELETE FROM pageviews WHERE site_id = ?")
        .run(siteId).changes,
    );
    const deletedSites = toExactDeletedPageviewCount(
      database.prepare("DELETE FROM sites WHERE id = ?").run(siteId).changes,
    );

    if (deletedSites !== 1) {
      throw new Error("Site deletion did not delete exactly one record");
    }

    database.exec(`RELEASE SAVEPOINT ${deleteSiteSavepoint}`);
    savepointIsOpen = false;

    return { ok: true, deletedSites: 1, deletedPageviews };
  } catch {
    if (savepointIsOpen) {
      try {
        database.exec(`ROLLBACK TO SAVEPOINT ${deleteSiteSavepoint}`);
      } catch {
        // The deletion-specific boundary error remains stable during cleanup.
      }

      try {
        database.exec(`RELEASE SAVEPOINT ${deleteSiteSavepoint}`);
      } catch {
        // The deletion-specific boundary error remains stable during cleanup.
      }
    }

    return { ok: false, message: deleteFailureMessage };
  }
}
