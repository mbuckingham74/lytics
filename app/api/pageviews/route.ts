import { getClientIp } from "../../../lib/server/client-ip";
import { resolveGeography } from "../../../lib/server/geolocation";
import { recordPageview } from "../../../lib/server/pageviews";
import { getRuntimeDatabase } from "../../../lib/server/runtime-database";
import { findSiteByDomain } from "../../../lib/server/sites";
import { resolveTechnology } from "../../../lib/server/technology";

export const runtime = "nodejs";

type ValidatedOrigin = {
  hostname: string;
  serialized: string;
};

const allowedBodyFields = new Set(["visitorId", "path", "referrer"]);

function validateOrigin(request: Request): ValidatedOrigin | null {
  const serialized = request.headers.get("origin");

  if (
    !serialized ||
    serialized === "null" ||
    serialized.includes(",") ||
    /\s/.test(serialized) ||
    !/^https?:\/\/[^/?#]+$/.test(serialized)
  ) {
    return null;
  }

  try {
    const url = new URL(serialized);
    const authority = serialized.slice(serialized.indexOf("//") + 2);
    let serializedHostname: string;
    let serializedPort: string | undefined;

    if (authority.startsWith("[")) {
      const closingBracket = authority.indexOf("]");

      if (closingBracket < 0) {
        return null;
      }

      serializedHostname = authority.slice(0, closingBracket + 1);
      const remainder = authority.slice(closingBracket + 1);

      if (remainder) {
        if (!remainder.startsWith(":")) {
          return null;
        }

        serializedPort = remainder.slice(1);
      }
    } else {
      const portSeparator = authority.lastIndexOf(":");
      serializedHostname =
        portSeparator < 0 ? authority : authority.slice(0, portSeparator);
      serializedPort =
        portSeparator < 0 ? undefined : authority.slice(portSeparator + 1);
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      serializedHostname.toLowerCase() !== url.hostname.toLowerCase() ||
      (serializedPort !== undefined &&
        (!/^(0|[1-9]\d*)$/.test(serializedPort) ||
          serializedPort !== url.port))
    ) {
      return null;
    }

    return {
      hostname: url.hostname.toLowerCase(),
      serialized,
    };
  } catch {
    return null;
  }
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function unresolvedError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { Vary: "Origin" } },
  );
}

function resolvedError(
  message: string,
  status: number,
  origin: string,
): Response {
  return Response.json(
    { error: message },
    { status, headers: corsHeaders(origin) },
  );
}

function isJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");

  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function isRequestBody(
  value: unknown,
): value is { visitorId: string; path: string; referrer?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;
  const fields = Object.keys(body);

  if (
    !Object.hasOwn(body, "visitorId") ||
    !Object.hasOwn(body, "path") ||
    fields.some((field) => !allowedBodyFields.has(field)) ||
    typeof body.visitorId !== "string" ||
    body.visitorId.trim().length === 0 ||
    typeof body.path !== "string" ||
    body.path.trim().length === 0 ||
    (Object.hasOwn(body, "referrer") && typeof body.referrer !== "string")
  ) {
    return false;
  }

  return true;
}

function resolveRegisteredOrigin(request: Request):
  | { response: Response }
  | {
      database: ReturnType<typeof getRuntimeDatabase>;
      origin: ValidatedOrigin;
      siteId: number;
    } {
  const origin = validateOrigin(request);

  if (!origin) {
    return { response: unresolvedError("Invalid Origin", 400) };
  }

  try {
    const database = getRuntimeDatabase();
    const site = findSiteByDomain(database, origin.hostname);

    if (!site) {
      return {
        response: unresolvedError("Origin is not registered", 403),
      };
    }

    return { database, origin, siteId: site.id };
  } catch {
    return {
      response: unresolvedError("Unable to record pageview", 500),
    };
  }
}

export function OPTIONS(request: Request): Response {
  const resolution = resolveRegisteredOrigin(request);

  if ("response" in resolution) {
    return resolution.response;
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(resolution.origin.serialized),
  });
}

export async function POST(request: Request): Promise<Response> {
  const resolution = resolveRegisteredOrigin(request);

  if ("response" in resolution) {
    return resolution.response;
  }

  const corsOrigin = resolution.origin.serialized;

  if (!isJsonContentType(request)) {
    return resolvedError(
      "Content-Type must be application/json",
      415,
      corsOrigin,
    );
  }

  if (new URL(request.url).search.length > 0) {
    return resolvedError("Invalid request body", 400, corsOrigin);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return resolvedError("Invalid request body", 400, corsOrigin);
  }

  if (!isRequestBody(body)) {
    return resolvedError("Invalid request body", 400, corsOrigin);
  }

  const clientIp = getClientIp(request.headers);

  if (clientIp === null) {
    return resolvedError("Invalid client IP", 400, corsOrigin);
  }

  const occurredAt = new Date();

  try {
    const geography = await resolveGeography(clientIp);
    const technology = resolveTechnology(request.headers.get("user-agent"));

    recordPageview(resolution.database, {
      siteId: resolution.siteId,
      visitorId: body.visitorId,
      path: body.path,
      referrer: body.referrer,
      occurredAt,
      geography,
      technology,
    });
  } catch {
    return resolvedError("Unable to record pageview", 500, corsOrigin);
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(corsOrigin),
  });
}
