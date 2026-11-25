import type { IndicatorDefinition } from "./types";

/**
 * Curated national indicators. Every code is a World Bank World Development
 * Indicators (WDI) series for Nigeria (NGA). Nothing here carries a value:
 * values are only ever read from the live source and validated.
 *
 * Status labels are deliberately conservative. WDI republishes national and
 * international statistics, so series built from official statistics are
 * "official"; ILO model-based series are "modelled".
 */
export const INDICATORS: readonly IndicatorDefinition[] = [
  {
    code: "FP.CPI.TOTL.ZG",
    name: "Inflation, consumer prices (annual %)",
    shortName: "Inflation (CPI)",
    unit: "% per year",
    currency: null,
    frequency: "annual",
    dataStatus: "official",
    description: "Annual percentage change in the consumer price index.",
    decimals: 1,
    display: "percent",
  },
  {
    code: "NY.GDP.MKTP.KD.ZG",
    name: "GDP growth (annual %)",
    shortName: "GDP growth",
    unit: "% per year",
    currency: null,
    frequency: "annual",
    dataStatus: "official",
    description: "Annual percentage growth of GDP at constant prices.",
    decimals: 1,
    display: "percent",
  },
  {
    code: "SL.UEM.TOTL.ZS",
    name: "Unemployment, total (% of labour force, modelled ILO estimate)",
    shortName: "Unemployment",
    unit: "% of labour force",
    currency: null,
    frequency: "annual",
    dataStatus: "modelled",
    description:
      "Share of the labour force without work but available and seeking work. A modelled estimate, not a national survey release.",
    decimals: 1,
    display: "percent",
  },
  {
    code: "PA.NUS.FCRF",
    name: "Official exchange rate (NGN per US$, period average)",
    shortName: "Exchange rate",
    unit: "NGN per US$",
    currency: "NGN",
    frequency: "annual",
    dataStatus: "official",
    description:
      "Annual average of the official nominal exchange rate. It does not capture parallel-market rates.",
    decimals: 2,
    display: "currency-rate",
  },
  {
    code: "FR.INR.LEND",
    name: "Lending interest rate (%)",
    shortName: "Lending rate",
    unit: "% per year",
    currency: null,
    frequency: "annual",
    dataStatus: "official",
    description: "Rate banks charge private-sector customers for short- and medium-term financing.",
    decimals: 2,
    display: "percent",
  },
  {
    code: "FI.RES.TOTL.CD",
    name: "Total reserves including gold (current US$)",
    shortName: "Reserves",
    unit: "current US$",
    currency: "USD",
    frequency: "annual",
    dataStatus: "official",
    description: "Year-end holdings of foreign exchange, gold and related reserve assets.",
    decimals: 1,
    display: "usd-compact",
  },
  {
    code: "BX.KLT.DINV.WD.GD.ZS",
    name: "Foreign direct investment, net inflows (% of GDP)",
    shortName: "FDI inflows",
    unit: "% of GDP",
    currency: null,
    frequency: "annual",
    dataStatus: "official",
    description: "Net inflows of direct investment as a share of GDP.",
    decimals: 2,
    display: "percent",
  },
  {
    code: "NE.TRD.GNFS.ZS",
    name: "Trade (% of GDP)",
    shortName: "Trade openness",
    unit: "% of GDP",
    currency: null,
    frequency: "annual",
    dataStatus: "official",
    description: "Sum of exports and imports of goods and services as a share of GDP.",
    decimals: 1,
    display: "percent",
  },
];

export const INDICATOR_BY_CODE = new Map(INDICATORS.map((item) => [item.code, item]));

export const WORLD_BANK_SOURCE = {
  name: "World Bank",
  dataset: "World Development Indicators (WDI)",
  licence: "CC BY 4.0",
  url: "https://data.worldbank.org/country/nigeria",
} as const;

export function indicatorSourceUrl(code: string): string {
  return `https://data.worldbank.org/indicator/${encodeURIComponent(code)}?locations=NG`;
}
