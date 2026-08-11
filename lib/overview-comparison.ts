export type OverviewComparison = Readonly<{
  visibleText: string;
  screenReaderText: string;
}>;

const invalidComparisonMessage =
  "Overview comparison values must be non-negative finite numbers";

export function createOverviewComparison(
  currentValue: number,
  previousValue: number,
): OverviewComparison {
  if (
    !Number.isFinite(currentValue) ||
    currentValue < 0 ||
    !Number.isFinite(previousValue) ||
    previousValue < 0
  ) {
    throw new Error(invalidComparisonMessage);
  }

  if (previousValue === 0) {
    return currentValue > 0
      ? {
          visibleText: "New",
          screenReaderText: "New compared with the previous period.",
        }
      : {
          visibleText: "No change",
          screenReaderText: "No change compared with the previous period.",
        };
  }

  if (currentValue === previousValue) {
    return {
      visibleText: "→ 0%",
      screenReaderText:
        "No percentage change compared with the previous period.",
    };
  }

  const percentageMagnitude = Math.round(
    Math.abs(((currentValue - previousValue) / previousValue) * 100),
  );

  if (currentValue > previousValue) {
    return {
      visibleText: `↑ +${percentageMagnitude}%`,
      screenReaderText: percentageMagnitude === 0
        ? "Increased by less than 1% compared with the previous period."
        : `Increased by ${percentageMagnitude}% compared with the previous period.`,
    };
  }

  return {
    visibleText: percentageMagnitude === 0
      ? "↓ 0%"
      : `↓ -${percentageMagnitude}%`,
    screenReaderText: percentageMagnitude === 0
      ? "Decreased by less than 1% compared with the previous period."
      : `Decreased by ${percentageMagnitude}% compared with the previous period.`,
  };
}
