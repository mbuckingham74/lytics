import { isIP } from "node:net";

export function getClientIp(headers: Headers): string | null {
  const headerValue = headers.get("x-real-ip");

  if (headerValue === null || headerValue.includes(",")) {
    return null;
  }

  const ipAddress = headerValue.trim();
  return ipAddress.length > 0 && isIP(ipAddress) !== 0 ? ipAddress : null;
}
