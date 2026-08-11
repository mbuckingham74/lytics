"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import {
  createOverviewHref,
  overviewRangePresets,
  type OverviewRangePreset,
  type OverviewRangeSelection,
} from "../lib/overview-query";

const reportingRangeOptions = Object.values(overviewRangePresets);

type CommonReportingRangeSelectorProps = {
  selectedSiteId: number;
  firstSiteId: number;
  pathname?: string;
};

type PresetReportingRangeSelectorProps = CommonReportingRangeSelectorProps & {
  customEnabled?: false;
  selectedPreset: OverviewRangePreset;
  selectedRange?: never;
  resolvedStartDate?: never;
  resolvedEndDate?: never;
};

type CustomReportingRangeSelectorProps = CommonReportingRangeSelectorProps & {
  customEnabled: true;
  selectedPreset?: never;
  selectedRange: OverviewRangeSelection;
  resolvedStartDate: string;
  resolvedEndDate: string;
};

type ReportingRangeSelectorProps =
  | PresetReportingRangeSelectorProps
  | CustomReportingRangeSelectorProps;

type RangeOptionValue = OverviewRangePreset | "custom";

export function ReportingRangeSelector(props: ReportingRangeSelectorProps) {
  const router = useRouter();
  const generatedId = useId();
  const customPanelId = `custom-range-panel-${generatedId}`;
  const customTitleId = `custom-range-title-${generatedId}`;
  const customHelpId = `custom-range-help-${generatedId}`;
  const startInputId = `custom-range-start-${generatedId}`;
  const endInputId = `custom-range-end-${generatedId}`;
  const pathname = props.pathname ?? "/";
  const customEnabled = props.customEnabled === true;
  const selectedRange: OverviewRangeSelection = customEnabled
    ? props.selectedRange
    : { type: "preset", preset: props.selectedPreset };
  const currentValue: RangeOptionValue = selectedRange.type === "custom"
    ? "custom"
    : selectedRange.preset;
  const resolvedStartDate = customEnabled ? props.resolvedStartDate : "";
  const resolvedEndDate = customEnabled ? props.resolvedEndDate : "";
  const [selectedValue, setSelectedValue] = useState<RangeOptionValue>(currentValue);
  const [draftStartDate, setDraftStartDate] = useState(resolvedStartDate);
  const [draftEndDate, setDraftEndDate] = useState(resolvedEndDate);
  const [customExpanded, setCustomExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const datesAreMissing = draftStartDate.length === 0 || draftEndDate.length === 0;
  const datesAreReversed = !datesAreMissing && draftStartDate > draftEndDate;
  const customDatesAreValid = !datesAreMissing && !datesAreReversed;
  const selectedOption = reportingRangeOptions.find(
    (option) => option.value === selectedValue,
  );
  const selectedLabel = selectedValue === "custom"
    ? selectedRange.type === "custom"
      ? `Custom · ${resolvedStartDate}–${resolvedEndDate}`
      : "Custom range"
    : selectedOption?.label ?? overviewRangePresets["7d"].label;
  const validationMessage = datesAreMissing
    ? "Choose both a start date and an end date."
    : datesAreReversed
      ? "Start date must not be after end date."
      : "";

  useEffect(() => {
    setSelectedValue(currentValue);
    setDraftStartDate(resolvedStartDate);
    setDraftEndDate(resolvedEndDate);
    setCustomExpanded(false);
  }, [currentValue, resolvedEndDate, resolvedStartDate]);

  function closeCustomPicker(): void {
    setDraftStartDate(resolvedStartDate);
    setDraftEndDate(resolvedEndDate);
    setSelectedValue(currentValue);
    setCustomExpanded(false);
  }

  function openCustomPicker(): void {
    setDraftStartDate(resolvedStartDate);
    setDraftEndDate(resolvedEndDate);
    setSelectedValue("custom");
    setCustomExpanded(true);
  }

  function handleChange(value: RangeOptionValue): void {
    if (value === "custom") {
      openCustomPicker();
      return;
    }

    setSelectedValue(value);
    setCustomExpanded(false);

    startTransition(() => {
      router.push(
        createOverviewHref({
          siteId: props.selectedSiteId,
          firstSiteId: props.firstSiteId,
          rangePreset: value,
          pathname,
        }),
        { scroll: false },
      );
    });
  }

  function applyCustomRange(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!customEnabled || !customDatesAreValid) {
      return;
    }

    setCustomExpanded(false);

    startTransition(() => {
      router.push(
        createOverviewHref({
          siteId: props.selectedSiteId,
          firstSiteId: props.firstSiteId,
          rangeSelection: {
            type: "custom",
            startDate: draftStartDate,
            endDate: draftEndDate,
          },
          pathname,
        }),
        { scroll: false },
      );
    });
  }

  return (
    <div className="reporting-range-control" aria-busy={isPending}>
      <div className="reporting-range-selector" aria-busy={isPending}>
        <span aria-hidden="true">{selectedLabel}</span>
        <span className="range-selector-chevron" aria-hidden="true">⌄</span>
        <select
          className="reporting-range-select"
          aria-label="Select reporting range"
          value={selectedValue}
          disabled={isPending}
          onChange={(event) =>
            handleChange(event.target.value as RangeOptionValue)
          }
        >
          {reportingRangeOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
          {customEnabled ? <option value="custom">Custom range</option> : null}
        </select>
      </div>

      {customEnabled ? (
        <>
          <button
            className="custom-range-toggle"
            type="button"
            aria-expanded={customExpanded}
            aria-controls={customPanelId}
            aria-label={customExpanded ? "Close custom date picker" : "Open custom date picker"}
            onClick={() => {
              if (customExpanded) {
                closeCustomPicker();
              } else {
                openCustomPicker();
              }
            }}
          >
            {customExpanded ? "Close dates" : "Dates"}
          </button>
          <div
            id={customPanelId}
            className="custom-range-panel"
            hidden={!customExpanded}
            aria-labelledby={customTitleId}
          >
            <p id={customTitleId} className="custom-range-title">
              Custom reporting range
            </p>
            <form onSubmit={applyCustomRange}>
              <div className="custom-range-fields">
                <label htmlFor={startInputId}>
                  Start date
                  <input
                    id={startInputId}
                    type="date"
                    value={draftStartDate}
                    max={draftEndDate || undefined}
                    required
                    aria-describedby={customHelpId}
                    aria-invalid={datesAreMissing || datesAreReversed}
                    onChange={(event) => setDraftStartDate(event.target.value)}
                  />
                </label>
                <label htmlFor={endInputId}>
                  End date
                  <input
                    id={endInputId}
                    type="date"
                    value={draftEndDate}
                    min={draftStartDate || undefined}
                    required
                    aria-describedby={customHelpId}
                    aria-invalid={datesAreMissing || datesAreReversed}
                    onChange={(event) => setDraftEndDate(event.target.value)}
                  />
                </label>
              </div>
              <p
                id={customHelpId}
                className={`custom-range-help ${validationMessage ? "error" : ""}`}
                role={validationMessage ? "alert" : "status"}
                aria-live="polite"
              >
                {validationMessage || "Start and end dates are both included."}
              </p>
              <div className="custom-range-actions">
                <button type="submit" disabled={!customDatesAreValid || isPending}>
                  {isPending ? "Applying…" : "Apply"}
                </button>
                <button type="button" onClick={closeCustomPicker}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}
