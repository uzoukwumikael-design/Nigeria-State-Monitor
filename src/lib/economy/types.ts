export const ECONOMY_DATA_STATUSES = ["official", "modelled", "estimated", "market"] as const;
export type EconomyDataStatus = (typeof ECONOMY_DATA_STATUSES)[number];

export interface IndicatorDefinition {
  /** World Bank series code, e.g. FP.CPI.TOTL.ZG. Also the stable public identifier. */
  code: string;
  name: string;
  shortName: string;
  /** Human unit as published, e.g. "% per year" or "NGN per US$". */
  unit: string;
  currency: string | null;
  frequency: "annual";
  /** How the underlying series is produced. Modelled series are never labelled official. */
  dataStatus: EconomyDataStatus;
  /** One factual sentence about what the series measures. */
  description: string;
  /** Number of decimals to show. */
  decimals: number;
  /** "percent" values display with a % sign; "number" values use compact notation. */
  display: "percent" | "number" | "currency-rate" | "usd-compact";
}

export interface EconomyObservation {
  /** Four-digit reference year as published. */
  year: number;
  value: number;
  referencePeriodStart: string;
  referencePeriodEnd: string;
}

export interface IndicatorSeries {
  definition: IndicatorDefinition;
  /** Oldest first; years without a published value are omitted, never filled. */
  observations: EconomyObservation[];
  /** Date the World Bank says the series was last updated (YYYY-MM-DD), when provided. */
  sourceLastUpdated: string | null;
  retrievedAt: string;
}

export interface IndicatorLatest {
  code: string;
  name: string;
  shortName: string;
  description: string;
  unit: string;
  currency: string | null;
  dataStatus: EconomyDataStatus;
  decimals: number;
  display: IndicatorDefinition["display"];
  latest: EconomyObservation | null;
  previous: EconomyObservation | null;
  /** Latest minus previous, only when both are consecutive-or-earlier published periods. */
  change: number | null;
  observationCount: number;
  firstYear: number | null;
  sourceLastUpdated: string | null;
  sourceUrl: string;
  /** Set when this indicator could not be refreshed. */
  error: string | null;
}

export interface EconomySnapshot {
  indicators: IndicatorLatest[];
  retrievedAt: string;
  /** True when any series is being served from an older successful fetch. */
  stale: boolean;
  source: {
    name: string;
    dataset: string;
    licence: string;
    url: string;
  };
}
