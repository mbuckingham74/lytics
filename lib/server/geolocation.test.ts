import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

type GeolocationModule = typeof import("./geolocation");

const originalDatabasePath = process.env.LYTICS_GEOLITE2_CITY_PATH;
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "GeoIP2-City-Test.mmdb",
);
const emptyGeography = {
  countryCode: null,
  countryName: null,
  regionCode: null,
  regionName: null,
  cityName: null,
};

async function importGeolocation(fresh = false): Promise<GeolocationModule> {
  const suffix = fresh ? `?test=${Date.now()}-${Math.random()}` : "";
  return import(`./geolocation${suffix}`) as Promise<GeolocationModule>;
}

function restoreDatabasePath(): void {
  if (originalDatabasePath === undefined) {
    delete process.env.LYTICS_GEOLITE2_CITY_PATH;
  } else {
    process.env.LYTICS_GEOLITE2_CITY_PATH = originalDatabasePath;
  }
}

afterEach(async () => {
  const geolocation = await importGeolocation();
  geolocation.resetGeolocationReaderForTests();
  restoreDatabasePath();
});

test("imports without configuration or file activity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lytics-geolocation-import-"));
  const missingPath = join(directory, "GeoLite2-City.mmdb");
  process.env.LYTICS_GEOLITE2_CITY_PATH = missingPath;

  try {
    await importGeolocation(true);
    assert.equal(existsSync(missingPath), false);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("validates required configuration only for a public lookup", async () => {
  const geolocation = await importGeolocation();

  delete process.env.LYTICS_GEOLITE2_CITY_PATH;
  await assert.rejects(() => geolocation.resolveGeography("81.2.69.142"), {
    message: "LYTICS_GEOLITE2_CITY_PATH is required",
  });

  process.env.LYTICS_GEOLITE2_CITY_PATH = "   ";
  await assert.rejects(() => geolocation.resolveGeography("81.2.69.142"), {
    message: "LYTICS_GEOLITE2_CITY_PATH is required",
  });

  process.env.LYTICS_GEOLITE2_CITY_PATH = join(
    basename(dirname(fixturePath)),
    basename(fixturePath),
  );
  await assert.rejects(() => geolocation.resolveGeography("81.2.69.142"), {
    message: "LYTICS_GEOLITE2_CITY_PATH must be an absolute path",
  });
});

test("maps one City lookup to only the approved English geography", async () => {
  const geolocation = await importGeolocation();
  process.env.LYTICS_GEOLITE2_CITY_PATH = fixturePath;

  const result = await geolocation.resolveGeography("81.2.69.142");

  assert.deepEqual(result, {
    countryCode: "GB",
    countryName: "United Kingdom",
    regionCode: "ENG",
    regionName: "England",
    cityName: "London",
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "cityName",
    "countryCode",
    "countryName",
    "regionCode",
    "regionName",
  ]);
  assert.equal("ipAddress" in result, false);
});

test("returns all-null geography for absent, private, local, and malformed IPs", async () => {
  const geolocation = await importGeolocation();
  process.env.LYTICS_GEOLITE2_CITY_PATH = fixturePath;

  for (const ipAddress of [
    "1.1.1.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "not-an-ip",
  ]) {
    assert.deepEqual(
      await geolocation.resolveGeography(ipAddress),
      emptyGeography,
    );
  }
});

test("normalizes missing City fields to null", async () => {
  const geolocation = await importGeolocation();
  process.env.LYTICS_GEOLITE2_CITY_PATH = fixturePath;

  assert.deepEqual(await geolocation.resolveGeography("2001:218::"), {
    countryCode: "JP",
    countryName: "Japan",
    regionCode: null,
    regionName: null,
    cityName: null,
  });
});

test("reuses one process-wide reader across fresh module evaluation", async () => {
  const geolocation = await importGeolocation();
  process.env.LYTICS_GEOLITE2_CITY_PATH = fixturePath;

  assert.equal(
    (await geolocation.resolveGeography("81.2.69.142")).cityName,
    "London",
  );

  process.env.LYTICS_GEOLITE2_CITY_PATH = "/does/not/exist.mmdb";
  const reevaluatedGeolocation = await importGeolocation(true);

  assert.equal(
    (await reevaluatedGeolocation.resolveGeography("216.160.83.56")).cityName,
    "Milton",
  );
});

test("does not cache a failed open and retries corrected configuration", async () => {
  const geolocation = await importGeolocation();
  process.env.LYTICS_GEOLITE2_CITY_PATH = "/does/not/exist.mmdb";

  await assert.rejects(() => geolocation.resolveGeography("81.2.69.142"), {
    message:
      "LYTICS_GEOLITE2_CITY_PATH must reference a readable GeoLite2 City database",
  });

  process.env.LYTICS_GEOLITE2_CITY_PATH = fixturePath;
  assert.equal(
    (await geolocation.resolveGeography("81.2.69.142")).cityName,
    "London",
  );
});

test("contains unreadable, invalid, and wrong-edition database failures", async () => {
  const geolocation = await importGeolocation();
  const directory = mkdtempSync(join(tmpdir(), "lytics-geolocation-errors-"));
  const invalidPath = join(directory, "invalid.mmdb");
  const wrongEditionPath = join(directory, "wrong-edition.mmdb");
  const safeError = {
    message:
      "LYTICS_GEOLITE2_CITY_PATH must reference a readable GeoLite2 City database",
  };

  try {
    for (const databasePath of [
      join(directory, "missing.mmdb"),
      invalidPath,
      wrongEditionPath,
    ]) {
      if (databasePath === invalidPath) {
        writeFileSync(databasePath, "not a MaxMind database");
      }

      if (databasePath === wrongEditionPath) {
        const buffer = readFileSync(fixturePath);
        const databaseType = buffer.indexOf("GeoIP2-City");
        assert.notEqual(databaseType, -1);
        buffer.write("GeoIP2-ASN ", databaseType, "utf8");
        writeFileSync(databasePath, buffer);
      }

      process.env.LYTICS_GEOLITE2_CITY_PATH = databasePath;
      await assert.rejects(
        () => geolocation.resolveGeography("81.2.69.142"),
        safeError,
      );
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
