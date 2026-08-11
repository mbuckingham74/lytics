import assert from "node:assert/strict";
import test from "node:test";

import { resolveTrackingEnrichmentDiagnostic } from "./tracking-diagnostics";

test("awaits enrichment evidence when there are no events today", () => {
  assert.deepEqual(
    resolveTrackingEnrichmentDiagnostic({
      eventsToday: 0,
      enrichedEventsToday: 0,
    }),
    {
      state: "awaiting-events",
      label: "Awaiting events",
    },
  );
});

test("reports no enriched data when today's events have no evidence", () => {
  assert.deepEqual(
    resolveTrackingEnrichmentDiagnostic({
      eventsToday: 8,
      enrichedEventsToday: 0,
    }),
    {
      state: "no-enriched-data-today",
      label: "No enriched data today",
    },
  );
});

test("reports receiving data for partial, complete, and large safe evidence", () => {
  for (const evidence of [
    { eventsToday: 8, enrichedEventsToday: 3 },
    { eventsToday: 8, enrichedEventsToday: 8 },
    {
      eventsToday: Number.MAX_SAFE_INTEGER,
      enrichedEventsToday: Number.MAX_SAFE_INTEGER - 1,
    },
  ]) {
    assert.deepEqual(resolveTrackingEnrichmentDiagnostic(evidence), {
      state: "receiving-enriched-data",
      label: "Receiving enriched data",
    });
  }
});

test("rejects invalid tracking diagnostic count shapes", () => {
  for (const evidence of [
    { eventsToday: -1, enrichedEventsToday: 0 },
    { eventsToday: 0, enrichedEventsToday: -1 },
    { eventsToday: 1.5, enrichedEventsToday: 0 },
    { eventsToday: 1, enrichedEventsToday: 0.5 },
    { eventsToday: Number.NaN, enrichedEventsToday: 0 },
    { eventsToday: 0, enrichedEventsToday: Number.NaN },
    { eventsToday: Number.POSITIVE_INFINITY, enrichedEventsToday: 0 },
    { eventsToday: 1, enrichedEventsToday: Number.NEGATIVE_INFINITY },
    { eventsToday: Number.MAX_SAFE_INTEGER + 1, enrichedEventsToday: 0 },
    { eventsToday: 1, enrichedEventsToday: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(
      () => resolveTrackingEnrichmentDiagnostic(evidence),
      {
        message:
          "Tracking diagnostic counts must be non-negative safe integers",
      },
    );
  }
});

test("rejects enriched evidence greater than today's total events", () => {
  for (const evidence of [
    { eventsToday: 0, enrichedEventsToday: 1 },
    { eventsToday: 5, enrichedEventsToday: 6 },
  ]) {
    assert.throws(
      () => resolveTrackingEnrichmentDiagnostic(evidence),
      {
        message:
          "Tracking diagnostic enriched events cannot exceed total events",
      },
    );
  }
});
