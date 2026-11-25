import type { IndicatorLatest } from "./types";

type Displayable = Pick<IndicatorLatest, "display" | "decimals">;

const compactUsd = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatIndicatorValue(item: Displayable, value: number): string {
  const fixed = value.toLocaleString("en-NG", {
    minimumFractionDigits: item.decimals,
    maximumFractionDigits: item.decimals,
  });
  switch (item.display) {
    case "percent":
      return `${fixed}%`;
    case "currency-rate":
      return `₦${fixed} / US$`;
    case "usd-compact":
      return `US$${compactUsd.format(value)}`;
    default:
      return fixed;
  }
}

/**
 * Change between two published annual values. Rates in percent change by
 * percentage points; level series change by relative percent.
 */
export function formatIndicatorChange(
  item: Pick<IndicatorLatest, "display" | "decimals" | "latest" | "previous">,
): string | null {
  const { latest, previous } = item;
  if (!latest || !previous) return null;
  const delta = latest.value - previous.value;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  if (item.display === "percent") {
    return `${sign}${Math.abs(delta).toFixed(item.decimals)} pp vs ${previous.year}`;
  }
  if (previous.value === 0) return `no % change available vs ${previous.year}`;
  const relative = (delta / Math.abs(previous.value)) * 100;
  return `${sign}${Math.abs(relative).toFixed(1)}% vs ${previous.year}`;
}

export const DATA_STATUS_LABEL = {
  official: "Official",
  modelled: "Modelled",
  estimated: "Estimated",
  market: "Market-reported",
} as const;
