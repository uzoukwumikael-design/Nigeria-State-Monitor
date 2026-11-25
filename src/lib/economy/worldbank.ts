import { z } from "zod";
import { INDICATOR_BY_CODE } from "./indicators";
import type { EconomyObservation, IndicatorSeries } from "./types";

export const WORLD_BANK_HOST = "api.worldbank.org";
const DEFAULT_BASE_URL = `https://${WORLD_BANK_HOST}/v2`;
const COUNTRY = "NGA";
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_YEARS = 60;

export class EconomySourceError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "network" | "http" | "format" | "unknown_indicator",
  ) {
    super(message);
    this.name = "EconomySourceError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Only the official World Bank API host is ever contacted. */
export function resolveWorldBankBaseUrl(raw: string | undefined = process.env.WORLD_BANK_BASE_URL): string {
  const value = raw?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EconomySourceError("WORLD_BANK_BASE_URL must be an absolute HTTPS URL.", "config");
  }
  if (url.protocol !== "https:" || url.hostname !== WORLD_BANK_HOST || url.username || url.password) {
    throw new EconomySourceError(
      `WORLD_BANK_BASE_URL must be https://${WORLD_BANK_HOST}/… ; other hosts are not permitted.`,
      "config",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

const metaSchema = z.object({
  lastupdated: z.string().nullable().optional(),
  total: z.coerce.number().optional(),
});

const rowSchema = z.object({
  indicator: z.object({ id: z.string() }),
  countryiso3code: z.string().optional(),
  country: z.object({ id: z.string().optional() }).optional(),
  date: z.string().regex(/^\d{4}$/),
  value: z.number().finite().nullable(),
});

function iso(date: Date): string {
  return date.toISOString();
}

function normaliseUpdated(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * Parses a World Bank v2 indicator response: `[ meta, rows[] ]`.
 * Years without a published value are dropped, never interpolated.
 */
export function parseWorldBankSeries(
  code: string,
  payload: unknown,
  retrievedAt: Date = new Date(),
): IndicatorSeries {
  const definition = INDICATOR_BY_CODE.get(code);
  if (!definition) throw new EconomySourceError(`Unknown indicator ${code}.`, "unknown_indicator");

  if (!Array.isArray(payload) || payload.length < 1) {
    throw new EconomySourceError("Unexpected World Bank response shape.", "format");
  }
  // The API signals errors as [ { message: [...] } ] with no data array.
  const metaParsed = metaSchema.safeParse(payload[0]);
  // A valid series with no published values comes back as [ meta(total=0), null ].
  const rowsRaw =
    payload[1] === null && metaParsed.success && metaParsed.data.total === 0 ? [] : payload[1];
  if (!metaParsed.success || !Array.isArray(rowsRaw)) {
    throw new EconomySourceError("World Bank response did not contain a data array.", "format");
  }

  const byYear = new Map<number, EconomyObservation>();
  for (const raw of rowsRaw) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) {
      throw new EconomySourceError("World Bank response contained a malformed observation.", "format");
    }
    if (row.data.indicator.id !== code) {
      throw new EconomySourceError(
        `World Bank returned series ${row.data.indicator.id} when ${code} was requested.`,
        "format",
      );
    }
    const iso3 = row.data.countryiso3code || row.data.country?.id;
    if (iso3 && iso3 !== COUNTRY && iso3 !== "NG") {
      throw new EconomySourceError(`World Bank returned data for ${iso3}, not Nigeria.`, "format");
    }
    if (row.data.value === null) continue;
    const year = Number.parseInt(row.data.date, 10);
    byYear.set(year, {
      year,
      value: row.data.value,
      referencePeriodStart: `${year}-01-01`,
      referencePeriodEnd: `${year}-12-31`,
    });
  }

  const observations = [...byYear.values()].sort((a, b) => a.year - b.year);
  return {
    definition,
    observations,
    sourceLastUpdated: normaliseUpdated(metaParsed.data.lastupdated),
    retrievedAt: iso(retrievedAt),
  };
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new EconomySourceError("World Bank response is too large.", "format");
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new EconomySourceError("World Bank response is too large.", "format");
  return text;
}

export interface FetchSeriesOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  now?: Date;
  timeoutMs?: number;
}

export async function fetchWorldBankSeries(
  code: string,
  options: FetchSeriesOptions = {},
): Promise<IndicatorSeries> {
  if (!INDICATOR_BY_CODE.has(code)) {
    throw new EconomySourceError(`Unknown indicator ${code}.`, "unknown_indicator");
  }
  const base = options.baseUrl ?? resolveWorldBankBaseUrl();
  const url = `${base}/country/${COUNTRY}/indicator/${encodeURIComponent(code)}?format=json&per_page=${MAX_YEARS}`;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "NigeriaStateMonitor/0.3 (+economic-indicators)",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    throw new EconomySourceError(
      `Could not reach the World Bank API: ${error instanceof Error ? error.message : "unknown error"}`,
      "network",
    );
  }
  if (!response.ok) {
    throw new EconomySourceError(`World Bank API responded ${response.status}.`, "http");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readLimited(response));
  } catch (error) {
    if (error instanceof EconomySourceError) throw error;
    throw new EconomySourceError("World Bank response was not valid JSON.", "format");
  }
  return parseWorldBankSeries(code, payload, options.now);
}
