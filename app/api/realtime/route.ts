import {
  resolveOverviewSite,
  type OverviewQueryValue,
} from "../../../lib/overview-query";
import { getActiveVisitorCount } from "../../../lib/server/pageviews";
import { getRuntimeDatabase } from "../../../lib/server/runtime-database";
import { listSites } from "../../../lib/server/sites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readSiteQueryValue(searchParams: URLSearchParams): OverviewQueryValue {
  const values = searchParams.getAll("site");

  if (values.length === 0) {
    return undefined;
  }

  return values.length === 1 ? values[0] : values;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function GET(request: Request): Response {
  try {
    const database = getRuntimeDatabase();
    const sites = listSites(database);
    const site = resolveOverviewSite(
      sites,
      readSiteQueryValue(new URL(request.url).searchParams),
    );

    if (!site) {
      return jsonResponse({ error: "No registered site is available" }, 404);
    }

    const nowAt = new Date();
    const visitors = getActiveVisitorCount(database, {
      siteId: site.id,
      nowAt,
    });

    return jsonResponse({ visitors });
  } catch {
    return jsonResponse({ error: "Unable to load realtime visitors" }, 500);
  }
}
