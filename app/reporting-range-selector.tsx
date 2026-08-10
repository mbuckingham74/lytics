"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export type ReportingRangePreset = "today" | "7d" | "30d" | "90d";

const reportingRangeOptions: Array<{
  value: ReportingRangePreset;
  label: string;
}> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

type ReportingRangeSelectorProps = {
  selectedPreset: ReportingRangePreset;
  selectedSiteId: number;
  firstSiteId: number;
};

function createOverviewHref(
  siteId: number,
  firstSiteId: number,
  preset: ReportingRangePreset,
): string {
  const parameters = new URLSearchParams();

  if (siteId !== firstSiteId) {
    parameters.set("site", String(siteId));
  }

  if (preset !== "7d") {
    parameters.set("range", preset);
  }

  const query = parameters.toString();
  return query ? `/?${query}` : "/";
}

export function ReportingRangeSelector({
  selectedPreset,
  selectedSiteId,
  firstSiteId,
}: ReportingRangeSelectorProps) {
  const router = useRouter();
  const [selectedValue, setSelectedValue] = useState(selectedPreset);
  const [isPending, startTransition] = useTransition();
  const selectedOption = reportingRangeOptions.find(
    (option) => option.value === selectedValue,
  ) ?? reportingRangeOptions[1];

  useEffect(() => {
    setSelectedValue(selectedPreset);
  }, [selectedPreset]);

  function handleChange(value: ReportingRangePreset): void {
    setSelectedValue(value);

    startTransition(() => {
      router.push(createOverviewHref(selectedSiteId, firstSiteId, value), {
        scroll: false,
      });
    });
  }

  return (
    <div className="reporting-range-selector" aria-busy={isPending}>
      <span aria-hidden="true">{selectedOption.label}</span>
      <span className="range-selector-chevron" aria-hidden="true">⌄</span>
      <select
        className="reporting-range-select"
        aria-label="Select reporting range"
        value={selectedValue}
        onChange={(event) =>
          handleChange(event.target.value as ReportingRangePreset)
        }
      >
        {reportingRangeOptions.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
