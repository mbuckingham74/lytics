export type OverviewRangePreset = "today" | "7d" | "30d" | "90d";
export type OverviewRangeSelection =
  | { type: "preset"; preset: OverviewRangePreset }
  | { type: "custom"; startDate: string; endDate: string };
export type ReportCsvView =
  | "pages"
  | "referrers"
  | "geography"
  | "technology";

export const overviewDrillDownRoutes = {
  pages: "/pages",
  referrers: "/referrers",
  geography: "/geography",
  technology: "/technology",
} as const satisfies Readonly<Record<ReportCsvView, string>>;

export type OverviewSiteRecord = {
  id: number;
  name: string;
  domain: string;
};

export type OverviewQueryValue = string | string[] | undefined;

type LegacyRangeInput = {
  rangePreset: OverviewRangePreset;
  rangeSelection?: never;
};

type CanonicalRangeInput = {
  rangePreset?: never;
  rangeSelection: OverviewRangeSelection;
};

type RangeHrefInput = LegacyRangeInput | CanonicalRangeInput;

export const overviewRangePresets = {
  today: {
    value: "today",
    dayCount: 1,
    label: "Today",
    periodCopy: "today",
  },
  "7d": {
    value: "7d",
    dayCount: 7,
    label: "Last 7 days",
    periodCopy: "the last 7 days",
  },
  "30d": {
    value: "30d",
    dayCount: 30,
    label: "Last 30 days",
    periodCopy: "the last 30 days",
  },
  "90d": {
    value: "90d",
    dayCount: 90,
    label: "Last 90 days",
    periodCopy: "the last 90 days",
  },
} as const satisfies Record<
  OverviewRangePreset,
  {
    value: OverviewRangePreset;
    dayCount: number;
    label: string;
    periodCopy: string;
  }
>;

export function resolveOverviewRangePreset(
  value: OverviewQueryValue,
): OverviewRangePreset {
  const candidate = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : undefined
    : value;

  if (
    typeof candidate !== "string" ||
    !Object.hasOwn(overviewRangePresets, candidate)
  ) {
    return "7d";
  }

  return candidate as OverviewRangePreset;
}

function readSingleQueryValue(value: OverviewQueryValue): string | undefined {
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : undefined;
  }

  return value;
}

function isCanonicalCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDayCounts = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    year > 0 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= monthDayCounts[month - 1]
  );
}

export function resolveOverviewRangeSelection(
  range: OverviewQueryValue,
  start: OverviewQueryValue,
  end: OverviewQueryValue,
): OverviewRangeSelection {
  const rangeValue = readSingleQueryValue(range);

  if (
    typeof rangeValue === "string" &&
    Object.hasOwn(overviewRangePresets, rangeValue)
  ) {
    return {
      type: "preset",
      preset: rangeValue as OverviewRangePreset,
    };
  }

  if (rangeValue !== "custom") {
    return { type: "preset", preset: "7d" };
  }

  const startDate = readSingleQueryValue(start);
  const endDate = readSingleQueryValue(end);

  if (
    typeof startDate !== "string" ||
    typeof endDate !== "string" ||
    !isCanonicalCalendarDate(startDate) ||
    !isCanonicalCalendarDate(endDate) ||
    startDate > endDate
  ) {
    return { type: "preset", preset: "7d" };
  }

  return { type: "custom", startDate, endDate };
}

export function resolveOverviewSite<T extends OverviewSiteRecord>(
  sites: readonly T[],
  value: OverviewQueryValue,
): T | undefined {
  const fallbackSite = sites[0];

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return fallbackSite;
  }

  const siteId = Number(value);

  if (!Number.isSafeInteger(siteId)) {
    return fallbackSite;
  }

  return sites.find((site) => site.id === siteId) ?? fallbackSite;
}

export function createOverviewHref(input: {
  siteId: number;
  firstSiteId: number;
  pathname?: string;
} & RangeHrefInput): string {
  const pathname = input.pathname ?? "/";
  const parameters = new URLSearchParams();

  if (input.siteId !== input.firstSiteId) {
    parameters.set("site", String(input.siteId));
  }

  const rangeSelection = input.rangeSelection ?? {
    type: "preset",
    preset: input.rangePreset,
  };

  if (rangeSelection.type === "custom") {
    parameters.set("range", "custom");
    parameters.set("start", rangeSelection.startDate);
    parameters.set("end", rangeSelection.endDate);
  } else if (rangeSelection.preset !== "7d") {
    parameters.set("range", rangeSelection.preset);
  }

  const query = parameters.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function createOverviewDrillDownHref(input: {
  view: keyof typeof overviewDrillDownRoutes;
  siteId: number;
  firstSiteId: number;
} & RangeHrefInput): string {
  return createOverviewHref({
    ...input,
    pathname: overviewDrillDownRoutes[input.view],
  });
}

export function createReportCsvHref(input: {
  view: ReportCsvView;
  siteId: number;
  firstSiteId: number;
} & RangeHrefInput): string {
  const parameters = new URLSearchParams();
  parameters.set("view", input.view);

  if (input.siteId !== input.firstSiteId) {
    parameters.set("site", String(input.siteId));
  }

  const rangeSelection = input.rangeSelection ?? {
    type: "preset",
    preset: input.rangePreset,
  };

  if (rangeSelection.type === "custom") {
    parameters.set("range", "custom");
    parameters.set("start", rangeSelection.startDate);
    parameters.set("end", rangeSelection.endDate);
  } else if (rangeSelection.preset !== "7d") {
    parameters.set("range", rangeSelection.preset);
  }

  return `/api/report.csv?${parameters.toString()}`;
}
