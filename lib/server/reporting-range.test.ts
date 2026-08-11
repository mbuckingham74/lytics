import assert from "node:assert/strict";
import test from "node:test";

import {
  createOverviewReportingRange,
  createPreviousOverviewReportingRange,
  createRecentCalendarSelection,
  createReportingRange,
  getReportingTimeZone,
} from "./reporting-range";

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

test("creates an inclusive recent UTC calendar selection", () => {
  assert.deepEqual(
    createRecentCalendarSelection({
      nowAt: new Date("2026-08-10T12:34:56.789Z"),
      timeZone: "UTC",
      dayCount: 7,
    }),
    { startDate: "2026-08-04", endDate: "2026-08-10" },
  );
});

test("the same instant selects the correct current date in each timezone", () => {
  const nowAt = new Date("2026-08-10T02:00:00.000Z");

  assert.deepEqual(
    createRecentCalendarSelection({ nowAt, timeZone: "UTC", dayCount: 7 }),
    { startDate: "2026-08-04", endDate: "2026-08-10" },
  );
  assert.deepEqual(
    createRecentCalendarSelection({
      nowAt,
      timeZone: "America/Los_Angeles",
      dayCount: 7,
    }),
    { startDate: "2026-08-03", endDate: "2026-08-09" },
  );
});

test("subtracts local calendar dates across Los Angeles spring-forward", () => {
  assert.deepEqual(
    createRecentCalendarSelection({
      nowAt: new Date("2026-03-10T12:00:00.000Z"),
      timeZone: "America/Los_Angeles",
      dayCount: 4,
    }),
    { startDate: "2026-03-07", endDate: "2026-03-10" },
  );
});

test("handles month, year, and leap-day calendar boundaries", () => {
  assert.deepEqual(
    createRecentCalendarSelection({
      nowAt: new Date("2026-01-02T12:00:00.000Z"),
      timeZone: "UTC",
      dayCount: 7,
    }),
    { startDate: "2025-12-27", endDate: "2026-01-02" },
  );
  assert.deepEqual(
    createRecentCalendarSelection({
      nowAt: new Date("2024-03-01T12:00:00.000Z"),
      timeZone: "UTC",
      dayCount: 3,
    }),
    { startDate: "2024-02-28", endDate: "2024-03-01" },
  );
});

test("rejects invalid recent-calendar selection inputs with stable errors", () => {
  assert.throws(
    () => createRecentCalendarSelection({
      nowAt: new Date(Number.NaN),
      timeZone: "UTC",
      dayCount: 7,
    }),
    { message: "nowAt must be a valid Date" },
  );
  assert.throws(
    () => createRecentCalendarSelection({
      nowAt: new Date("2026-08-10T12:00:00.000Z"),
      timeZone: "Not/A_Time_Zone",
      dayCount: 7,
    }),
    { message: "timeZone must be a valid IANA time zone" },
  );

  for (const dayCount of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => createRecentCalendarSelection({
        nowAt: new Date("2026-08-10T12:00:00.000Z"),
        timeZone: "UTC",
        dayCount,
      }),
      { message: "dayCount must be a positive safe integer" },
    );
  }
});

test("builds every preset through the existing recent-calendar path exactly", () => {
  const nowAt = new Date("2026-08-10T02:00:00.000Z");
  const timeZone = "America/Los_Angeles";

  for (const [preset, dayCount] of [
    ["today", 1],
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ] as const) {
    const selection = createRecentCalendarSelection({
      nowAt,
      timeZone,
      dayCount,
    });
    const range = createReportingRange({ ...selection, timeZone });

    assert.deepEqual(
      createOverviewReportingRange({
        selection: { type: "preset", preset },
        nowAt,
        timeZone,
      }),
      { ...selection, ...range, dayCount },
    );
  }
});

test("builds inclusive custom ranges and day counts across calendar boundaries", () => {
  assert.deepEqual(
    createOverviewReportingRange({
      selection: {
        type: "custom",
        startDate: "2024-02-28",
        endDate: "2024-03-01",
      },
      nowAt: new Date("2026-08-10T12:00:00.000Z"),
      timeZone: "UTC",
    }),
    {
      startDate: "2024-02-28",
      endDate: "2024-03-01",
      startAt: new Date("2024-02-28T00:00:00.000Z"),
      endAt: new Date("2024-03-02T00:00:00.000Z"),
      dayCount: 3,
    },
  );

  const yearBoundary = createOverviewReportingRange({
    selection: {
      type: "custom",
      startDate: "2025-12-30",
      endDate: "2026-01-02",
    },
    nowAt: new Date("2026-08-10T12:00:00.000Z"),
    timeZone: "UTC",
  });

  assert.equal(yearBoundary.dayCount, 4);
  assert.equal(yearBoundary.startAt.toISOString(), "2025-12-30T00:00:00.000Z");
  assert.equal(yearBoundary.endAt.toISOString(), "2026-01-03T00:00:00.000Z");
});

test("uses configured local calendar boundaries for custom DST ranges", () => {
  const springForward = createOverviewReportingRange({
    selection: {
      type: "custom",
      startDate: "2026-03-08",
      endDate: "2026-03-08",
    },
    nowAt: new Date("2026-08-10T12:00:00.000Z"),
    timeZone: "America/Los_Angeles",
  });
  const fallBack = createOverviewReportingRange({
    selection: {
      type: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-01",
    },
    nowAt: new Date("2026-08-10T12:00:00.000Z"),
    timeZone: "America/Los_Angeles",
  });
  const multiDay = createOverviewReportingRange({
    selection: {
      type: "custom",
      startDate: "2026-03-07",
      endDate: "2026-03-10",
    },
    nowAt: new Date("2026-08-10T12:00:00.000Z"),
    timeZone: "America/Los_Angeles",
  });

  assert.equal(springForward.dayCount, 1);
  assert.equal(springForward.startAt.toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(springForward.endAt.toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(
    springForward.endAt.getTime() - springForward.startAt.getTime(),
    23 * 60 * 60 * 1000,
  );
  assert.equal(fallBack.dayCount, 1);
  assert.equal(fallBack.startAt.toISOString(), "2026-11-01T07:00:00.000Z");
  assert.equal(fallBack.endAt.toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(
    fallBack.endAt.getTime() - fallBack.startAt.getTime(),
    25 * 60 * 60 * 1000,
  );
  assert.equal(multiDay.dayCount, 4);
});

test("preserves stable custom date, reversal, and timezone errors at runtime", () => {
  assert.throws(
    () => createOverviewReportingRange({
      selection: {
        type: "custom",
        startDate: "2026-02-29",
        endDate: "2026-03-01",
      },
      nowAt: new Date("2026-08-10T12:00:00.000Z"),
      timeZone: "UTC",
    }),
    { message: "startDate must be a valid YYYY-MM-DD calendar date" },
  );
  assert.throws(
    () => createOverviewReportingRange({
      selection: {
        type: "custom",
        startDate: "2026-08-10",
        endDate: "2026-08-09",
      },
      nowAt: new Date("2026-08-10T12:00:00.000Z"),
      timeZone: "UTC",
    }),
    { message: "startDate must not be after endDate" },
  );
  assert.throws(
    () => createOverviewReportingRange({
      selection: {
        type: "custom",
        startDate: "2026-08-09",
        endDate: "2026-08-10",
      },
      nowAt: new Date("2026-08-10T12:00:00.000Z"),
      timeZone: "Not/A_Time_Zone",
    }),
    { message: "timeZone must be a valid IANA time zone" },
  );
});

test("builds an adjacent equal-length previous period for every resolved preset", () => {
  const nowAt = new Date("2026-08-10T02:00:00.000Z");
  const timeZone = "America/Los_Angeles";
  const expectedDates = {
    today: { startDate: "2026-08-08", endDate: "2026-08-08" },
    "7d": { startDate: "2026-07-27", endDate: "2026-08-02" },
    "30d": { startDate: "2026-06-11", endDate: "2026-07-10" },
    "90d": { startDate: "2026-02-11", endDate: "2026-05-11" },
  } as const;

  for (const preset of ["today", "7d", "30d", "90d"] as const) {
    const current = createOverviewReportingRange({
      selection: { type: "preset", preset },
      nowAt,
      timeZone,
    });
    const previous = createPreviousOverviewReportingRange({
      startDate: current.startDate,
      endDate: current.endDate,
      timeZone,
    });

    assert.equal(previous.startDate, expectedDates[preset].startDate);
    assert.equal(previous.endDate, expectedDates[preset].endDate);
    assert.equal(previous.dayCount, current.dayCount);
    assert.equal(previous.endAt.getTime(), current.startAt.getTime());
  }
});

test("builds previous custom periods across month, year, and leap boundaries", () => {
  const examples = [
    {
      current: { startDate: "2026-05-01", endDate: "2026-05-01" },
      previous: { startDate: "2026-04-30", endDate: "2026-04-30" },
      dayCount: 1,
    },
    {
      current: { startDate: "2026-05-01", endDate: "2026-05-03" },
      previous: { startDate: "2026-04-28", endDate: "2026-04-30" },
      dayCount: 3,
    },
    {
      current: { startDate: "2026-03-01", endDate: "2026-03-02" },
      previous: { startDate: "2026-02-27", endDate: "2026-02-28" },
      dayCount: 2,
    },
    {
      current: { startDate: "2026-01-01", endDate: "2026-01-03" },
      previous: { startDate: "2025-12-29", endDate: "2025-12-31" },
      dayCount: 3,
    },
    {
      current: { startDate: "2024-03-01", endDate: "2024-03-02" },
      previous: { startDate: "2024-02-28", endDate: "2024-02-29" },
      dayCount: 2,
    },
  ] as const;

  for (const example of examples) {
    const currentRange = createReportingRange({
      ...example.current,
      timeZone: "UTC",
    });
    const previous = createPreviousOverviewReportingRange({
      ...example.current,
      timeZone: "UTC",
    });

    assert.equal(previous.startDate, example.previous.startDate);
    assert.equal(previous.endDate, example.previous.endDate);
    assert.equal(previous.dayCount, example.dayCount);
    assert.equal(previous.endAt.getTime(), currentRange.startAt.getTime());
  }
});

test("uses calendar-day equivalence across Los Angeles DST transitions", () => {
  for (const example of [
    {
      currentDate: "2026-03-09",
      previousDate: "2026-03-08",
      previousHours: 23,
    },
    {
      currentDate: "2026-11-02",
      previousDate: "2026-11-01",
      previousHours: 25,
    },
  ]) {
    const current = createOverviewReportingRange({
      selection: {
        type: "custom",
        startDate: example.currentDate,
        endDate: example.currentDate,
      },
      nowAt: new Date("2026-08-10T12:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    const previous = createPreviousOverviewReportingRange({
      startDate: current.startDate,
      endDate: current.endDate,
      timeZone: "America/Los_Angeles",
    });

    assert.equal(previous.startDate, example.previousDate);
    assert.equal(previous.endDate, example.previousDate);
    assert.equal(previous.dayCount, current.dayCount);
    assert.equal(previous.endAt.getTime(), current.startAt.getTime());
    assert.equal(
      previous.endAt.getTime() - previous.startAt.getTime(),
      example.previousHours * 60 * 60 * 1000,
    );
  }
});

test("preserves stable validation errors for previous reporting periods", () => {
  assert.throws(
    () => createPreviousOverviewReportingRange({
      startDate: "2026-02-29",
      endDate: "2026-03-01",
      timeZone: "UTC",
    }),
    { message: "startDate must be a valid YYYY-MM-DD calendar date" },
  );
  assert.throws(
    () => createPreviousOverviewReportingRange({
      startDate: "2026-08-09",
      endDate: "2026-02-29",
      timeZone: "UTC",
    }),
    { message: "endDate must be a valid YYYY-MM-DD calendar date" },
  );
  assert.throws(
    () => createPreviousOverviewReportingRange({
      startDate: "2026-08-10",
      endDate: "2026-08-09",
      timeZone: "UTC",
    }),
    { message: "startDate must not be after endDate" },
  );
  assert.throws(
    () => createPreviousOverviewReportingRange({
      startDate: "2026-08-09",
      endDate: "2026-08-10",
      timeZone: "Not/A_Time_Zone",
    }),
    { message: "timeZone must be a valid IANA time zone" },
  );
});
