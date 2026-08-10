import assert from "node:assert/strict";
import test from "node:test";

import { createReportingRange, getReportingTimeZone } from "./reporting-range";

test("reads, trims, and canonicalizes the reporting timezone only when called", () => {
  assert.equal(
    getReportingTimeZone({ LYTICS_TIME_ZONE: "  America/Los_Angeles  " }),
    "America/Los_Angeles",
  );
});

test("returns stable reporting-timezone configuration errors", () => {
  assert.throws(
    () => getReportingTimeZone({}),
    { message: "LYTICS_TIME_ZONE is required" },
  );
  assert.throws(
    () => getReportingTimeZone({ LYTICS_TIME_ZONE: "   " }),
    { message: "LYTICS_TIME_ZONE is required" },
  );
  assert.throws(
    () => getReportingTimeZone({ LYTICS_TIME_ZONE: "Not/A_Time_Zone" }),
    { message: "LYTICS_TIME_ZONE must be a valid IANA time zone" },
  );
});

test("converts an inclusive UTC calendar selection to a half-open instant range", () => {
  const range = createReportingRange({
    startDate: "2026-08-09",
    endDate: "2026-08-10",
    timeZone: "UTC",
  });

  assert.equal(range.startAt.toISOString(), "2026-08-09T00:00:00.000Z");
  assert.equal(range.endAt.toISOString(), "2026-08-11T00:00:00.000Z");
});

test("a Los Angeles spring-forward day spans 23 elapsed hours", () => {
  const range = createReportingRange({
    startDate: "2026-03-08",
    endDate: "2026-03-08",
    timeZone: "America/Los_Angeles",
  });

  assert.equal(range.startAt.toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(range.endAt.toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(range.endAt.getTime() - range.startAt.getTime(), 23 * 60 * 60 * 1000);
});

test("a Los Angeles fall-back day spans 25 elapsed hours", () => {
  const range = createReportingRange({
    startDate: "2026-11-01",
    endDate: "2026-11-01",
    timeZone: "America/Los_Angeles",
  });

  assert.equal(range.startAt.toISOString(), "2026-11-01T07:00:00.000Z");
  assert.equal(range.endAt.toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(range.endAt.getTime() - range.startAt.getTime(), 25 * 60 * 60 * 1000);
});

test("rejects malformed and impossible calendar dates with stable errors", () => {
  for (const startDate of [
    "2026-2-01",
    "2026-02-29",
    "2026-13-01",
    "2026-04-31",
    "0000-01-01",
    "2026-01-01T00:00:00Z",
  ]) {
    assert.throws(
      () => createReportingRange({ startDate, endDate: "2026-08-10", timeZone: "UTC" }),
      { message: "startDate must be a valid YYYY-MM-DD calendar date" },
    );
  }

  assert.throws(
    () => createReportingRange({
      startDate: "2026-08-09",
      endDate: "2026-02-29",
      timeZone: "UTC",
    }),
    { message: "endDate must be a valid YYYY-MM-DD calendar date" },
  );
});

test("rejects reversed ranges and invalid timezone names with stable errors", () => {
  assert.throws(
    () => createReportingRange({
      startDate: "2026-08-10",
      endDate: "2026-08-09",
      timeZone: "UTC",
    }),
    { message: "startDate must not be after endDate" },
  );
  assert.throws(
    () => createReportingRange({
      startDate: "2026-08-09",
      endDate: "2026-08-10",
      timeZone: "Not/A_Time_Zone",
    }),
    { message: "timeZone must be a valid IANA time zone" },
  );
});
