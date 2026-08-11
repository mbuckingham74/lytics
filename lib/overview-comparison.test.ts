import assert from "node:assert/strict";
import test from "node:test";

import { createOverviewComparison } from "./overview-comparison";

test("uses the approved prior-zero comparison policy", () => {
  assert.deepEqual(createOverviewComparison(7, 0), {
    visibleText: "New",
    screenReaderText: "New compared with the previous period.",
  });
  assert.deepEqual(createOverviewComparison(0, 0), {
    visibleText: "No change",
    screenReaderText: "No change compared with the previous period.",
  });
});

test("returns exact increase, decrease, and equality comparisons", () => {
  assert.deepEqual(createOverviewComparison(112, 100), {
    visibleText: "↑ +12%",
    screenReaderText: "Increased by 12% compared with the previous period.",
  });
  assert.deepEqual(createOverviewComparison(88, 100), {
    visibleText: "↓ -12%",
    screenReaderText: "Decreased by 12% compared with the previous period.",
  });
  assert.deepEqual(createOverviewComparison(100, 100), {
    visibleText: "→ 0%",
    screenReaderText:
      "No percentage change compared with the previous period.",
  });
});

test("reports a complete decrease when current falls to zero", () => {
  assert.deepEqual(createOverviewComparison(0, 8), {
    visibleText: "↓ -100%",
    screenReaderText: "Decreased by 100% compared with the previous period.",
  });
});

test("compares fractional raw KPI values without pre-rounding", () => {
  assert.deepEqual(createOverviewComparison(2.5, 2), {
    visibleText: "↑ +25%",
    screenReaderText: "Increased by 25% compared with the previous period.",
  });
  assert.deepEqual(createOverviewComparison(37.5, 50), {
    visibleText: "↓ -25%",
    screenReaderText: "Decreased by 25% compared with the previous period.",
  });
});

test("rounds absolute percentage magnitudes to the nearest whole number", () => {
  assert.deepEqual(createOverviewComparison(110.5, 100), {
    visibleText: "↑ +11%",
    screenReaderText: "Increased by 11% compared with the previous period.",
  });
  assert.deepEqual(createOverviewComparison(89.5, 100), {
    visibleText: "↓ -11%",
    screenReaderText: "Decreased by 11% compared with the previous period.",
  });
});

test("preserves true direction when a tiny change rounds to zero", () => {
  assert.deepEqual(createOverviewComparison(100.1, 100), {
    visibleText: "↑ +0%",
    screenReaderText:
      "Increased by less than 1% compared with the previous period.",
  });
  assert.deepEqual(createOverviewComparison(99.9, 100), {
    visibleText: "↓ 0%",
    screenReaderText:
      "Decreased by less than 1% compared with the previous period.",
  });
});

test("rejects negative and non-finite comparison values", () => {
  for (const [currentValue, previousValue] of [
    [-1, 0],
    [0, -1],
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 1],
    [1, Number.NEGATIVE_INFINITY],
  ]) {
    assert.throws(
      () => createOverviewComparison(currentValue, previousValue),
      {
        message:
          "Overview comparison values must be non-negative finite numbers",
      },
    );
  }
});
