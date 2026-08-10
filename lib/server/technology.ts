import { parseUA } from "ua-parser-modern";

export type Technology = {
  browserName: string | null;
  deviceType: string | null;
  operatingSystemName: string | null;
};

function normalizeValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveTechnology(userAgent: string | null): Technology {
  const normalizedUserAgent = userAgent?.trim();

  if (!normalizedUserAgent) {
    return {
      browserName: null,
      deviceType: null,
      operatingSystemName: null,
    };
  }

  const result = parseUA(normalizedUserAgent);
  const browserName = normalizeValue(result.browser.name);
  const operatingSystemName = normalizeValue(result.os.name);
  const parsedDeviceType = normalizeValue(result.device.type);

  return {
    browserName,
    deviceType:
      parsedDeviceType ?? (operatingSystemName !== null ? "desktop" : null),
    operatingSystemName,
  };
}
