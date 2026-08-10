"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  createOverviewHref,
  overviewRangePresets,
  type OverviewRangePreset,
} from "../lib/overview-query";

const reportingRangeOptions = Object.values(overviewRangePresets);

type ReportingRangeSelectorProps = {
  selectedPreset: OverviewRangePreset;
  selectedSiteId: number;
  firstSiteId: number;
};

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

  function handleChange(value: OverviewRangePreset): void {
    setSelectedValue(value);

    startTransition(() => {
      router.push(
        createOverviewHref({
          siteId: selectedSiteId,
          firstSiteId,
          rangePreset: value,
        }),
        { scroll: false },
      );
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
          handleChange(event.target.value as OverviewRangePreset)
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
