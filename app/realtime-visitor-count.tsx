"use client";

import { useEffect, useState } from "react";

const refreshIntervalMilliseconds = 15_000;

type RealtimeVisitorCountProps = {
  endpoint: string;
  initialVisitors: number;
};

type VisitorState = {
  endpoint: string;
  initialVisitors: number;
  visitors: number;
};

function isVisitorPayload(value: unknown): value is { visitors: number } {
  if (!value || typeof value !== "object" || !("visitors" in value)) {
    return false;
  }

  const visitors = value.visitors;
  return (
    typeof visitors === "number" &&
    Number.isSafeInteger(visitors) &&
    visitors >= 0
  );
}

export function RealtimeVisitorCount({
  endpoint,
  initialVisitors,
}: RealtimeVisitorCountProps) {
  const [state, setState] = useState<VisitorState>({
    endpoint,
    initialVisitors,
    visitors: initialVisitors,
  });
  const visitors =
    state.endpoint === endpoint && state.initialVisitors === initialVisitors
      ? state.visitors
      : initialVisitors;

  useEffect(() => {
    let disposed = false;
    let timeoutId: number | undefined;
    let activeController: AbortController | undefined;

    setState({ endpoint, initialVisitors, visitors: initialVisitors });

    const scheduleRefresh = () => {
      timeoutId = window.setTimeout(refresh, refreshIntervalMilliseconds);
    };

    const refresh = async () => {
      const controller = new AbortController();
      activeController = controller;

      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (response.ok) {
          const payload: unknown = await response.json();

          if (!disposed && isVisitorPayload(payload)) {
            setState({
              endpoint,
              initialVisitors,
              visitors: payload.visitors,
            });
          }
        }
      } catch {
        // Keep the last good value and retry on the next normal interval.
      } finally {
        activeController = undefined;

        if (!disposed) {
          scheduleRefresh();
        }
      }
    };

    scheduleRefresh();

    return () => {
      disposed = true;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }

      activeController?.abort();
    };
  }, [endpoint, initialVisitors]);

  return (
    <span className="realtime-status" aria-live="polite">
      <span className="live-dot" aria-hidden="true" />
      {visitors.toLocaleString("en-US")} live now
    </span>
  );
}
