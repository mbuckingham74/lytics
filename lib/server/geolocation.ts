import {
  AddressNotFoundError,
  Reader,
  type ReaderModel,
  ValueError,
} from "@maxmind/geoip2-node";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";

export type Geography = {
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
  cityName: string | null;
};

const databaseErrorMessage =
  "LYTICS_GEOLITE2_CITY_PATH must reference a readable GeoLite2 City database";

const geolocationGlobal = globalThis as typeof globalThis & {
  __lyticsGeolocationReaderPromise__?: Promise<ReaderModel>;
};

function emptyGeography(): Geography {
  return {
    countryCode: null,
    countryName: null,
    regionCode: null,
    regionName: null,
    cityName: null,
  };
}

function isPrivateOrLocalIpv4(ipAddress: string): boolean {
  const [first, second] = ipAddress.split(".").map(Number);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateOrLocalIp(ipAddress: string, version: number): boolean {
  if (version === 4) {
    return isPrivateOrLocalIpv4(ipAddress);
  }

  const normalized = ipAddress.toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];

  if (mappedIpv4 && isPrivateOrLocalIpv4(mappedIpv4)) {
    return true;
  }

  const firstGroup = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  return (
    (firstGroup & 0xfe00) === 0xfc00 ||
    (firstGroup & 0xffc0) === 0xfe80
  );
}

async function openConfiguredReader(): Promise<ReaderModel> {
  const filePath = process.env.LYTICS_GEOLITE2_CITY_PATH;

  if (!filePath || filePath.trim().length === 0) {
    throw new Error("LYTICS_GEOLITE2_CITY_PATH is required");
  }

  if (!isAbsolute(filePath)) {
    throw new Error("LYTICS_GEOLITE2_CITY_PATH must be an absolute path");
  }

  try {
    const reader = await Reader.open(filePath);

    try {
      reader.city("0.0.0.0");
    } catch (error) {
      if (!(error instanceof AddressNotFoundError)) {
        throw new Error(databaseErrorMessage);
      }
    }

    return reader;
  } catch (error) {
    if (error instanceof Error && error.message === databaseErrorMessage) {
      throw error;
    }

    throw new Error(databaseErrorMessage);
  }
}

async function getReader(): Promise<ReaderModel> {
  if (geolocationGlobal.__lyticsGeolocationReaderPromise__) {
    return geolocationGlobal.__lyticsGeolocationReaderPromise__;
  }

  const readerPromise = openConfiguredReader();
  geolocationGlobal.__lyticsGeolocationReaderPromise__ = readerPromise;

  try {
    return await readerPromise;
  } catch (error) {
    if (geolocationGlobal.__lyticsGeolocationReaderPromise__ === readerPromise) {
      delete geolocationGlobal.__lyticsGeolocationReaderPromise__;
    }

    throw error;
  }
}

export async function resolveGeography(ipAddress: string): Promise<Geography> {
  const ipVersion = isIP(ipAddress);

  if (ipVersion === 0 || isPrivateOrLocalIp(ipAddress, ipVersion)) {
    return emptyGeography();
  }

  const reader = await getReader();

  try {
    const response = reader.city(ipAddress);
    const subdivisions = response.subdivisions;
    const region = subdivisions?.[subdivisions.length - 1];

    return {
      countryCode: response.country?.isoCode ?? null,
      countryName: response.country?.names?.en ?? null,
      regionCode: region?.isoCode ?? null,
      regionName: region?.names?.en ?? null,
      cityName: response.city?.names?.en ?? null,
    };
  } catch (error) {
    if (error instanceof AddressNotFoundError || error instanceof ValueError) {
      return emptyGeography();
    }

    throw new Error(databaseErrorMessage);
  }
}

export function resetGeolocationReaderForTests(): void {
  delete geolocationGlobal.__lyticsGeolocationReaderPromise__;
}
