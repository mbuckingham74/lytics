"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export type SiteSelectorOption = {
  id: number;
  name: string;
  domain: string;
};

type SiteSelectorProps = {
  options: SiteSelectorOption[];
  selectedSiteId: number;
};

type ReportingRangePreset = "today" | "7d" | "30d" | "90d";

const reportingRangePresets = new Set<ReportingRangePreset>([
  "today",
  "7d",
  "30d",
  "90d",
]);

function resolveReportingRangePreset(
  values: string[],
): ReportingRangePreset {
  if (
    values.length !== 1 ||
    !reportingRangePresets.has(values[0] as ReportingRangePreset)
  ) {
    return "7d";
  }

  return values[0] as ReportingRangePreset;
}

function createOverviewHref(
  selectedId: number,
  firstSiteId: number,
  rangePreset: ReportingRangePreset,
): string {
  const parameters = new URLSearchParams();

  if (selectedId !== firstSiteId) {
    parameters.set("site", String(selectedId));
  }

  if (rangePreset !== "7d") {
    parameters.set("range", rangePreset);
  }

  const query = parameters.toString();
  return query ? `/?${query}` : "/";
}

export function SiteSelector({ options, selectedSiteId }: SiteSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedValue, setSelectedValue] = useState(String(selectedSiteId));
  const [isPending, startTransition] = useTransition();
  const selectedSite =
    options.find((option) => option.id === Number(selectedValue)) ?? options[0];

  useEffect(() => {
    setSelectedValue(String(selectedSiteId));
  }, [selectedSiteId]);

  function handleChange(value: string): void {
    setSelectedValue(value);
    const selectedId = Number(value);
    const rangePreset = resolveReportingRangePreset(
      searchParams.getAll("range"),
    );
    const href = createOverviewHref(selectedId, options[0].id, rangePreset);

    startTransition(() => {
      router.push(href, { scroll: false });
    });
  }

  return (
    <div className="site-selector interactive-site-selector" aria-busy={isPending}>
      <span className="site-mark" aria-hidden="true">
        {selectedSite.domain.charAt(0)}
      </span>
      <span className="site-copy" aria-hidden="true">
        <span className="site-caption">Website</span>
        <span className="site-selection-name">{selectedSite.name}</span>
        <span className="site-selection-domain">{selectedSite.domain}</span>
      </span>
      <span className="selector-chevron" aria-hidden="true">⌄</span>
      <select
        className="site-selector-select"
        aria-label="Select website"
        value={selectedValue}
        onChange={(event) => handleChange(event.target.value)}
      >
        {options.map((option) => (
          <option value={option.id} key={option.id}>
            {option.name} — {option.domain}
          </option>
        ))}
      </select>
    </div>
  );
}
