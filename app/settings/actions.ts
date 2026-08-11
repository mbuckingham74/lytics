"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import {
  deleteSiteAtBoundary,
  resetSiteAnalyticsAtBoundary,
} from "../../lib/server/site-data-management";
import {
  registerSiteAtBoundary,
  updateSiteAtBoundary,
} from "../../lib/server/site-registration";
import { listSites } from "../../lib/server/sites";

export type SiteRegistrationActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export type SiteAnalyticsResetActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export type SiteUpdateActionState = {
  status: "idle" | "error" | "success";
  message: string;
  savedSite: { name: string; domain: string } | null;
};

export type SiteDeleteActionState = {
  status: "idle" | "error";
  message: string;
};

export async function registerSiteAction(
  _previousState: SiteRegistrationActionState,
  formData: FormData,
): Promise<SiteRegistrationActionState> {
  try {
    const result = registerSiteAtBoundary(getRuntimeDatabase(), {
      name: formData.get("name"),
      domain: formData.get("domain"),
    });

    if (!result.ok) {
      return { status: "error", message: result.message };
    }

    revalidatePath("/settings");
    return { status: "success", message: "Site registered." };
  } catch {
    return {
      status: "error",
      message: "Could not register the site. Try again.",
    };
  }
}

export async function resetSiteAnalyticsAction(
  _previousState: SiteAnalyticsResetActionState,
  formData: FormData,
): Promise<SiteAnalyticsResetActionState> {
  const rawSiteId = formData.get("siteId");

  if (typeof rawSiteId !== "string" || !/^[1-9]\d*$/u.test(rawSiteId)) {
    return { status: "error", message: "Select a valid site to reset." };
  }

  const siteId = Number(rawSiteId);

  if (!Number.isSafeInteger(siteId)) {
    return { status: "error", message: "Select a valid site to reset." };
  }

  try {
    const database = getRuntimeDatabase();
    const site = listSites(database).find((candidate) => candidate.id === siteId);

    if (!site) {
      return { status: "error", message: "That site is not registered." };
    }

    const confirmationDomain = formData.get("confirmationDomain");

    if (confirmationDomain !== site.domain) {
      return {
        status: "error",
        message: `Enter ${site.domain} exactly to confirm.`,
      };
    }

    const result = resetSiteAnalyticsAtBoundary(database, siteId);

    if (!result.ok) {
      return { status: "error", message: result.message };
    }

    for (const path of [
      "/settings",
      "/",
      "/pages",
      "/referrers",
      "/geography",
      "/technology",
      "/realtime",
    ]) {
      revalidatePath(path);
    }

    const pageviewLabel = result.deletedPageviews === 1 ? "pageview" : "pageviews";

    return {
      status: "success",
      message: `Deleted ${result.deletedPageviews} ${pageviewLabel}. The site remains registered.`,
    };
  } catch {
    return {
      status: "error",
      message: "Could not reset site analytics. Try again.",
    };
  }
}

export async function updateSiteAction(
  _previousState: SiteUpdateActionState,
  formData: FormData,
): Promise<SiteUpdateActionState> {
  const rawSiteId = formData.get("siteId");

  if (typeof rawSiteId !== "string" || !/^[1-9]\d*$/u.test(rawSiteId)) {
    return {
      status: "error",
      message: "Select a valid site.",
      savedSite: null,
    };
  }

  const siteId = Number(rawSiteId);

  if (!Number.isSafeInteger(siteId)) {
    return {
      status: "error",
      message: "Select a valid site.",
      savedSite: null,
    };
  }

  try {
    const result = updateSiteAtBoundary(getRuntimeDatabase(), {
      siteId,
      name: formData.get("name"),
      domain: formData.get("domain"),
    });

    if (!result.ok) {
      return { status: "error", message: result.message, savedSite: null };
    }

    for (const path of [
      "/settings",
      "/",
      "/pages",
      "/referrers",
      "/geography",
      "/technology",
      "/realtime",
    ]) {
      revalidatePath(path);
    }

    return {
      status: "success",
      message: "Site updated.",
      savedSite: {
        name: result.site.name,
        domain: result.site.domain,
      },
    };
  } catch {
    return {
      status: "error",
      message: "Could not update the site. Try again.",
      savedSite: null,
    };
  }
}

export async function deleteSiteAction(
  _previousState: SiteDeleteActionState,
  formData: FormData,
): Promise<SiteDeleteActionState> {
  const rawSiteId = formData.get("siteId");

  if (typeof rawSiteId !== "string" || !/^[1-9]\d*$/u.test(rawSiteId)) {
    return { status: "error", message: "Select a valid site to delete." };
  }

  const siteId = Number(rawSiteId);

  if (!Number.isSafeInteger(siteId)) {
    return { status: "error", message: "Select a valid site to delete." };
  }

  let deletedSites: number;
  let deletedPageviews: number;

  try {
    const database = getRuntimeDatabase();
    const site = listSites(database).find((candidate) => candidate.id === siteId);

    if (!site) {
      return { status: "error", message: "That site is not registered." };
    }

    const confirmationDomain = formData.get("confirmationDomain");

    if (confirmationDomain !== site.domain) {
      return {
        status: "error",
        message: `Enter ${site.domain} exactly to confirm deletion.`,
      };
    }

    const result = deleteSiteAtBoundary(database, siteId);

    if (!result.ok) {
      return { status: "error", message: result.message };
    }

    deletedSites = result.deletedSites;
    deletedPageviews = result.deletedPageviews;

    for (const path of [
      "/settings",
      "/",
      "/pages",
      "/referrers",
      "/geography",
      "/technology",
      "/realtime",
    ]) {
      revalidatePath(path);
    }
  } catch {
    return {
      status: "error",
      message: "Could not delete the site. Try again.",
    };
  }

  const noticeParameters = new URLSearchParams({
    deletedSites: String(deletedSites),
    deletedPageviews: String(deletedPageviews),
  });

  redirect(`/settings?${noticeParameters.toString()}`);
}
