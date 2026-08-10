"use client";

import { useRouter } from "next/navigation";
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

export function SiteSelector({ options, selectedSiteId }: SiteSelectorProps) {
  const router = useRouter();
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
    const href = selectedId === options[0].id ? "/" : `/?site=${selectedId}`;

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
