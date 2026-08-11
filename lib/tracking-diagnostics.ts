export type TrackingEnrichmentDiagnostic =
  | Readonly<{
      state: "awaiting-events";
      label: "Awaiting events";
    }>
  | Readonly<{
      state: "receiving-enriched-data";
      label: "Receiving enriched data";
    }>
  | Readonly<{
      state: "no-enriched-data-today";
      label: "No enriched data today";
    }>;

export type TrackingEnrichmentEvidence = Readonly<{
  eventsToday: number;
  enrichedEventsToday: number;
}>;

export function resolveTrackingEnrichmentDiagnostic(
  evidence: TrackingEnrichmentEvidence,
): TrackingEnrichmentDiagnostic {
  if (
    !Number.isSafeInteger(evidence.eventsToday) ||
    evidence.eventsToday < 0 ||
    !Number.isSafeInteger(evidence.enrichedEventsToday) ||
    evidence.enrichedEventsToday < 0
  ) {
    throw new Error(
      "Tracking diagnostic counts must be non-negative safe integers",
    );
  }

  if (evidence.enrichedEventsToday > evidence.eventsToday) {
    throw new Error(
      "Tracking diagnostic enriched events cannot exceed total events",
    );
  }

  if (evidence.eventsToday === 0) {
    return {
      state: "awaiting-events",
      label: "Awaiting events",
    };
  }

  if (evidence.enrichedEventsToday > 0) {
    return {
      state: "receiving-enriched-data",
      label: "Receiving enriched data",
    };
  }

  return {
    state: "no-enriched-data-today",
    label: "No enriched data today",
  };
}
