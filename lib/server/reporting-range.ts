type Environment = Readonly<Record<string, string | undefined>>;

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

type ReportingRangeInput = {
  startDate: string;
  endDate: string;
  timeZone: string;
};

export type ReportingRange = {
  startAt: Date;
  endAt: Date;
};

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function canonicalizeTimeZone(timeZone: unknown): string | null {
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone })
      .resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

export function getReportingTimeZone(
  environment: Environment = process.env,
): string {
  const value = environment.LYTICS_TIME_ZONE;

  if (!value || value.trim().length === 0) {
    throw new Error("LYTICS_TIME_ZONE is required");
  }

  const canonicalTimeZone = canonicalizeTimeZone(value.trim());

  if (!canonicalTimeZone) {
    throw new Error("LYTICS_TIME_ZONE must be a valid IANA time zone");
  }

  return canonicalTimeZone;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseCalendarDate(value: string, fieldName: "startDate" | "endDate"): CalendarDate {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD calendar date`);
  }

  const match = calendarDatePattern.exec(value);

  if (!match) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD calendar date`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD calendar date`);
  }

  return { year, month, day };
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return (
    left.year - right.year ||
    left.month - right.month ||
    left.day - right.day
  );
}

function nextCalendarDate(date: CalendarDate): CalendarDate {
  if (date.day < daysInMonth(date.year, date.month)) {
    return { ...date, day: date.day + 1 };
  }

  if (date.month < 12) {
    return { year: date.year, month: date.month + 1, day: 1 };
  }

  return { year: date.year + 1, month: 1, day: 1 };
}

function utcTimestamp(parts: CalendarDate & { hour?: number; minute?: number; second?: number }): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);
  return date.getTime();
}

function readZonedParts(
  formatter: Intl.DateTimeFormat,
  instant: Date,
): Required<CalendarDate & { hour: number; minute: number; second: number }> {
  const values: Record<string, number> = {};

  for (const part of formatter.formatToParts(instant)) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function localMidnightToInstant(
  date: CalendarDate,
  formatter: Intl.DateTimeFormat,
): Date {
  const localTimestamp = utcTimestamp(date);
  let candidateTimestamp = localTimestamp;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = new Date(candidateTimestamp);
    const zonedParts = readZonedParts(formatter, candidate);
    const offset = utcTimestamp(zonedParts) - candidateTimestamp;
    const adjustedTimestamp = localTimestamp - offset;

    if (adjustedTimestamp === candidateTimestamp) {
      return candidate;
    }

    candidateTimestamp = adjustedTimestamp;
  }

  const candidate = new Date(candidateTimestamp);
  const zonedParts = readZonedParts(formatter, candidate);

  if (
    zonedParts.year === date.year &&
    zonedParts.month === date.month &&
    zonedParts.day === date.day &&
    zonedParts.hour === 0 &&
    zonedParts.minute === 0 &&
    zonedParts.second === 0
  ) {
    return candidate;
  }

  throw new Error("Calendar date cannot be resolved in the supplied time zone");
}

export function createReportingRange(input: ReportingRangeInput): ReportingRange {
  const startDate = parseCalendarDate(input.startDate, "startDate");
  const endDate = parseCalendarDate(input.endDate, "endDate");

  if (compareCalendarDates(startDate, endDate) > 0) {
    throw new Error("startDate must not be after endDate");
  }

  const canonicalTimeZone = canonicalizeTimeZone(input.timeZone);

  if (!canonicalTimeZone) {
    throw new Error("timeZone must be a valid IANA time zone");
  }

  const formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone: canonicalTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  return {
    startAt: localMidnightToInstant(startDate, formatter),
    endAt: localMidnightToInstant(nextCalendarDate(endDate), formatter),
  };
}
