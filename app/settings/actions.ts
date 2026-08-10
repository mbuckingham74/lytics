"use server";

import { revalidatePath } from "next/cache";

import { getRuntimeDatabase } from "../../lib/server/runtime-database";
import { registerSiteAtBoundary } from "../../lib/server/site-registration";

export type SiteRegistrationActionState = {
  status: "idle" | "error" | "success";
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
