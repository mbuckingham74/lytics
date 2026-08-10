"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  createOverviewHref,
  resolveOverviewRangePreset,
} from "../lib/overview-query";

export type SiteSelectorOption = {
  id: number;
  name: string;
  domain: string;
};

type SiteSelectorProps = {
  options: SiteSelectorOption[];
  selectedSiteId: number;
  pathname?: string;
  preserveRange?: boolean;
};

export function SiteSelector({
  options,
  selectedSiteId,
  pathname = "/",
  preserveRange = true,
}: SiteSelectorProps) {
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
    const rangePreset = preserveRange
      ? resolveOverviewRangePreset(searchParams.getAll("range"))
      : "7d";
    const href = createOverviewHref({
      siteId: selectedId,
      firstSiteId: options[0].id,
      rangePreset,
      pathname,
    });

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
