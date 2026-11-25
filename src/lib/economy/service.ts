import { INDICATORS, WORLD_BANK_SOURCE, indicatorSourceUrl } from "./indicators";
import { fetchWorldBankSeries, EconomySourceError, type FetchSeriesOptions } from "./worldbank";
import type { EconomySnapshot, IndicatorLatest, IndicatorSeries } from "./types";

/** Annual series change rarely; refresh at most every six hours per instance. */
export const FRESH_MS = 6 * 60 * 60 * 1000;
/** If a refresh fails, keep serving the last good series for up to a week, flagged stale. */
export const STALE_IF_ERROR_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  series: IndicatorSeries;
  fetchedAtMs: number;
}

const cache = new Map<string, CacheEntry>();

export function clearEconomyCache(): void {
  cache.clear();
}

export interface ServiceOptions extends FetchSeriesOptions {
  nowMs?: number;
}

interface SeriesResult {
  series: IndicatorSeries | null;
  stale: boolean;
  error: string | null;
}

async function loadSeries(code: string, options: ServiceOptions): Promise<SeriesResult> {
  const nowMs = options.nowMs ?? Date.now();
  const cached = cache.get(code);
  if (cached && nowMs - cached.fetchedAtMs < FRESH_MS) {
    return { series: cached.series, stale: false, error: null };
  }
  try {
    const series = await fetchWorldBankSeries(code, { ...options, now: new Date(nowMs) });
    cache.set(code, { series, fetchedAtMs: nowMs });
    return { series, stale: false, error: null };
  } catch (error) {
    const message =
      error instanceof EconomySourceError ? error.message : "Unexpected error while loading the series.";
    if (cached && nowMs - cached.fetchedAtMs < STALE_IF_ERROR_MS) {
      return { series: cached.series, stale: true, error: message };
    }
    return { series: null, stale: false, error: message };
  }
}

export function summariseSeries(series: IndicatorSeries, error: string | null = null): IndicatorLatest {
  const { definition, observations } = series;
  const latest = observations.at(-1) ?? null;
  const previous = observations.length > 1 ? (observations.at(-2) ?? null) : null;
  return {
    code: definition.code,
    name: definition.name,
    shortName: definition.shortName,
    description: definition.description,
    unit: definition.unit,
    currency: definition.currency,
    dataStatus: definition.dataStatus,
    decimals: definition.decimals,
    display: definition.display,
    latest,
    previous,
    change: latest && previous ? latest.value - previous.value : null,
    observationCount: observations.length,
    firstYear: observations[0]?.year ?? null,
    sourceLastUpdated: series.sourceLastUpdated,
    sourceUrl: indicatorSourceUrl(definition.code),
    error,
  };
}

function failedIndicator(code: string, error: string): IndicatorLatest {
  const definition = INDICATORS.find((item) => item.code === code);
  if (!definition) throw new Error(`Unknown indicator ${code}`);
  return summariseSeries(
    { definition, observations: [], sourceLastUpdated: null, retrievedAt: new Date(0).toISOString() },
    error,
  );
}

/** Fetches every curated indicator; one failing series never hides the others. */
export async function getEconomySnapshot(options: ServiceOptions = {}): Promise<EconomySnapshot> {
  const results = await Promise.all(INDICATORS.map((item) => loadSeries(item.code, options)));
  let stale = false;
  const indicators = results.map((result, index) => {
    const code = INDICATORS[index]!.code;
    if (result.stale) stale = true;
    if (!result.series) return failedIndicator(code, result.error ?? "Unavailable");
    return summariseSeries(result.series, result.error);
  });
  return {
    indicators,
    retrievedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    stale,
    source: { ...WORLD_BANK_SOURCE },
  };
}

export interface TrendResult {
  series: IndicatorSeries | null;
  stale: boolean;
  error: string | null;
}

export async function getIndicatorTrend(code: string, options: ServiceOptions = {}): Promise<TrendResult> {
  return loadSeries(code, options);
}
