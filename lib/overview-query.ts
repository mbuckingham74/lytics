export type OverviewRangePreset = "today" | "7d" | "30d" | "90d";
export type ReportCsvView =
  | "pages"
  | "referrers"
  | "geography"
  | "technology";

export type OverviewSiteRecord = {
  id: number;
  name: string;
  domain: string;
};

export type OverviewQueryValue = string | string[] | undefined;

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
  rangePreset: OverviewRangePreset;
  pathname?: string;
}): string {
  const pathname = input.pathname ?? "/";
  const parameters = new URLSearchParams();

  if (input.siteId !== input.firstSiteId) {
    parameters.set("site", String(input.siteId));
  }

  if (input.rangePreset !== "7d") {
    parameters.set("range", input.rangePreset);
  }

  const query = parameters.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function createReportCsvHref(input: {
  view: ReportCsvView;
  siteId: number;
  firstSiteId: number;
  rangePreset: OverviewRangePreset;
}): string {
  const parameters = new URLSearchParams();
  parameters.set("view", input.view);

  if (input.siteId !== input.firstSiteId) {
    parameters.set("site", String(input.siteId));
  }

  if (input.rangePreset !== "7d") {
    parameters.set("range", input.rangePreset);
  }

  return `/api/report.csv?${parameters.toString()}`;
}
