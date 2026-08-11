import assert from "node:assert/strict";
import test from "node:test";

import {
  createOverviewDrillDownHref,
  createOverviewHref,
  createReportCsvHref,
  overviewDrillDownRoutes,
  overviewRangePresets,
  resolveOverviewRangePreset,
  resolveOverviewRangeSelection,
  resolveOverviewSite,
} from "./overview-query";

const sites = [
  { id: 1, name: "Apex", domain: "example.com" },
  { id: 2, name: "WWW", domain: "www.example.com" },
  { id: 3, name: "Other", domain: "other.example" },
];

test("exposes the approved range metadata and day counts", () => {
  assert.deepEqual(overviewRangePresets, {
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
  });
});

test("resolves every approved range preset exactly", () => {
  for (const value of ["today", "7d", "30d", "90d"] as const) {
    assert.equal(resolveOverviewRangePreset(value), value);
    assert.equal(resolveOverviewRangePreset([value]), value);
  }
});

test("falls back to 7d for missing, invalid, and repeated ranges", () => {
  for (const value of [
    undefined,
    "",
    "Today",
    "14d",
    ["today", "90d"],
  ]) {
    assert.equal(resolveOverviewRangePreset(value), "7d");
  }
});

test("resolves canonical preset selections while ignoring stray dates", () => {
  for (const preset of ["today", "7d", "30d", "90d"] as const) {
    assert.deepEqual(
      resolveOverviewRangeSelection(
        preset,
        "not-a-date",
        ["2026-08-10", "2026-08-11"],
      ),
      { type: "preset", preset },
    );
    assert.deepEqual(
      resolveOverviewRangeSelection([preset], undefined, undefined),
      { type: "preset", preset },
    );
  }
});

test("resolves only exact valid inclusive custom calendar dates", () => {
  assert.deepEqual(
    resolveOverviewRangeSelection(
      "custom",
      "2024-02-29",
      "2024-03-01",
    ),
    {
      type: "custom",
      startDate: "2024-02-29",
      endDate: "2024-03-01",
    },
  );
  assert.deepEqual(
    resolveOverviewRangeSelection(
      ["custom"],
      ["2026-08-10"],
      ["2026-08-10"],
    ),
    {
      type: "custom",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
    },
  );
});

test("falls back to 7d for invalid custom query classes", () => {
  const fallback = { type: "preset", preset: "7d" };
  const invalidQueries: Array<[
    Parameters<typeof resolveOverviewRangeSelection>[0],
    Parameters<typeof resolveOverviewRangeSelection>[1],
    Parameters<typeof resolveOverviewRangeSelection>[2],
  ]> = [
    [undefined, "2026-08-01", "2026-08-10"],
    ["CUSTOM", "2026-08-01", "2026-08-10"],
    ["custom", undefined, "2026-08-10"],
    ["custom", "2026-08-01", undefined],
    ["custom", "2026-8-01", "2026-08-10"],
    ["custom", "2026-02-29", "2026-03-01"],
    ["custom", "0000-01-01", "2026-03-01"],
    ["custom", "2026-13-01", "2026-03-01"],
    ["custom", "2026-04-31", "2026-05-01"],
    ["custom", "2026-08-10", "2026-08-09"],
    [["custom", "custom"], "2026-08-01", "2026-08-10"],
    ["custom", ["2026-08-01", "2026-08-02"], "2026-08-10"],
    ["custom", "2026-08-01", ["2026-08-10", "2026-08-11"]],
  ];

  for (const [range, start, end] of invalidQueries) {
    assert.deepEqual(resolveOverviewRangeSelection(range, start, end), fallback);
  }
});

test("resolves an exact site ID without collapsing apex and www sites", () => {
  assert.equal(resolveOverviewSite(sites, "1"), sites[0]);
  assert.equal(resolveOverviewSite(sites, "2"), sites[1]);
  assert.equal(resolveOverviewSite(sites, "2")?.domain, "www.example.com");
});

test("falls back to the first site for every invalid site query class", () => {
  for (const value of [
    undefined,
    "",
    "site-2",
    "1.5",
    "+2",
    "02",
    "0",
    "-1",
    String(Number.MAX_SAFE_INTEGER + 1),
    "999",
    ["2"],
    ["2", "1"],
  ]) {
    assert.equal(resolveOverviewSite(sites, value), sites[0]);
  }
});

test("returns undefined when there is no first site", () => {
  assert.equal(resolveOverviewSite([], "1"), undefined);
  assert.equal(resolveOverviewSite([], undefined), undefined);
});

test("builds every canonical Overview href permutation in approved order", () => {
  assert.equal(
    createOverviewHref({ siteId: 1, firstSiteId: 1, rangePreset: "7d" }),
    "/",
  );
  assert.equal(
    createOverviewHref({ siteId: 2, firstSiteId: 1, rangePreset: "7d" }),
    "/?site=2",
  );
  assert.equal(
    createOverviewHref({ siteId: 1, firstSiteId: 1, rangePreset: "today" }),
    "/?range=today",
  );
  assert.equal(
    createOverviewHref({ siteId: 2, firstSiteId: 1, rangePreset: "90d" }),
    "/?site=2&range=90d",
  );
  assert.equal(
    createOverviewHref({
      siteId: 1,
      firstSiteId: 1,
      rangePreset: "7d",
      pathname: "/api/overview.csv",
    }),
    "/api/overview.csv",
  );
  assert.equal(
    createOverviewHref({
      siteId: 2,
      firstSiteId: 1,
      rangePreset: "90d",
      pathname: "/api/overview.csv",
    }),
    "/api/overview.csv?site=2&range=90d",
  );
});

test("builds every canonical report CSV href permutation in deterministic order", () => {
  for (const view of [
    "pages",
    "referrers",
    "geography",
    "technology",
  ] as const) {
    assert.equal(
      createReportCsvHref({
        view,
        siteId: 1,
        firstSiteId: 1,
        rangePreset: "7d",
      }),
      `/api/report.csv?view=${view}`,
    );
    assert.equal(
      createReportCsvHref({
        view,
        siteId: 2,
        firstSiteId: 1,
        rangePreset: "7d",
      }),
      `/api/report.csv?view=${view}&site=2`,
    );
    assert.equal(
      createReportCsvHref({
        view,
        siteId: 1,
        firstSiteId: 1,
        rangePreset: "today",
      }),
      `/api/report.csv?view=${view}&range=today`,
    );
    assert.equal(
      createReportCsvHref({
        view,
        siteId: 3,
        firstSiteId: 1,
        rangePreset: "90d",
      }),
      `/api/report.csv?view=${view}&site=3&range=90d`,
    );
  }
});

test("builds canonical selection hrefs without changing preset URLs", () => {
  assert.equal(
    createOverviewHref({
      siteId: 1,
      firstSiteId: 1,
      rangeSelection: { type: "preset", preset: "7d" },
    }),
    "/",
  );
  assert.equal(
    createOverviewHref({
      siteId: 2,
      firstSiteId: 1,
      rangeSelection: { type: "preset", preset: "90d" },
    }),
    "/?site=2&range=90d",
  );
  assert.equal(
    createOverviewHref({
      siteId: 1,
      firstSiteId: 1,
      rangeSelection: {
        type: "custom",
        startDate: "2024-02-29",
        endDate: "2024-03-01",
      },
    }),
    "/?range=custom&start=2024-02-29&end=2024-03-01",
  );
  assert.equal(
    createOverviewHref({
      siteId: 3,
      firstSiteId: 1,
      pathname: "/api/overview.csv",
      rangeSelection: {
        type: "custom",
        startDate: "2025-12-31",
        endDate: "2026-01-02",
      },
    }),
    "/api/overview.csv?site=3&range=custom&start=2025-12-31&end=2026-01-02",
  );
});

test("builds custom report CSV hrefs with view and site first", () => {
  assert.equal(
    createReportCsvHref({
      view: "pages",
      siteId: 1,
      firstSiteId: 1,
      rangeSelection: {
        type: "custom",
        startDate: "2026-08-01",
        endDate: "2026-08-10",
      },
    }),
    "/api/report.csv?view=pages&range=custom&start=2026-08-01&end=2026-08-10",
  );
  assert.equal(
    createReportCsvHref({
      view: "technology",
      siteId: 2,
      firstSiteId: 1,
      rangeSelection: {
        type: "custom",
        startDate: "2026-08-01",
        endDate: "2026-08-10",
      },
    }),
    "/api/report.csv?view=technology&site=2&range=custom&start=2026-08-01&end=2026-08-10",
  );
});

test("maps every Overview drill-down view to its canonical report route", () => {
  assert.deepEqual(overviewDrillDownRoutes, {
    pages: "/pages",
    referrers: "/referrers",
    geography: "/geography",
    technology: "/technology",
  });
});

test("builds canonical drill-down hrefs for every mapped report view", () => {
  for (const [view, route] of Object.entries(overviewDrillDownRoutes)) {
    assert.equal(
      createOverviewDrillDownHref({
        view: view as keyof typeof overviewDrillDownRoutes,
        siteId: 1,
        firstSiteId: 1,
        rangePreset: "7d",
      }),
      route,
    );
    assert.equal(
      createOverviewDrillDownHref({
        view: view as keyof typeof overviewDrillDownRoutes,
        siteId: 2,
        firstSiteId: 1,
        rangePreset: "7d",
      }),
      `${route}?site=2`,
    );
    assert.equal(
      createOverviewDrillDownHref({
        view: view as keyof typeof overviewDrillDownRoutes,
        siteId: 1,
        firstSiteId: 1,
        rangePreset: "30d",
      }),
      `${route}?range=30d`,
    );
    assert.equal(
      createOverviewDrillDownHref({
        view: view as keyof typeof overviewDrillDownRoutes,
        siteId: 3,
        firstSiteId: 1,
        rangeSelection: {
          type: "custom",
          startDate: "2024-02-29",
          endDate: "2024-03-01",
        },
      }),
      `${route}?site=3&range=custom&start=2024-02-29&end=2024-03-01`,
    );
  }
});

test("keeps existing Overview and report CSV href outputs unchanged", () => {
  assert.equal(
    createOverviewHref({
      siteId: 1,
      firstSiteId: 1,
      rangePreset: "7d",
    }),
    "/",
  );
  assert.equal(
    createOverviewHref({
      siteId: 2,
      firstSiteId: 1,
      rangePreset: "90d",
    }),
    "/?site=2&range=90d",
  );
  assert.equal(
    createReportCsvHref({
      view: "pages",
      siteId: 1,
      firstSiteId: 1,
      rangePreset: "7d",
    }),
    "/api/report.csv?view=pages",
  );
  assert.equal(
    createReportCsvHref({
      view: "technology",
      siteId: 2,
      firstSiteId: 1,
      rangeSelection: {
        type: "custom",
        startDate: "2026-08-01",
        endDate: "2026-08-10",
      },
    }),
    "/api/report.csv?view=technology&site=2&range=custom&start=2026-08-01&end=2026-08-10",
  );
});
