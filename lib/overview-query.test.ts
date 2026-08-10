import assert from "node:assert/strict";
import test from "node:test";

import {
  createOverviewHref,
  overviewRangePresets,
  resolveOverviewRangePreset,
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
