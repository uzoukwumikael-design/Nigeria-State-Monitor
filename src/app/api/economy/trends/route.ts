import type { NextRequest } from "next/server";
import { enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";
import { getIndicatorTrend } from "@/lib/economy/service";
import { flattenZodError, parseSearchParams } from "@/lib/validation/query";
import { economyTrendQuerySchema } from "@/lib/validation/economy";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "economy-trends", 60);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const parsed = parseSearchParams(economyTrendQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid economy trend query parameters", {
      requestId,
      rate,
      details: flattenZodError(parsed.error),
    });
  }
  try {
    const result = await getIndicatorTrend(parsed.data.code);
    if (!result.series) {
      return jsonError(
        503,
        "UPSTREAM_UNAVAILABLE",
        "This indicator could not be retrieved from the World Bank API and no earlier copy is held.",
        { requestId, rate, details: { error: result.error } },
      );
    }
    const { definition, observations, sourceLastUpdated, retrievedAt } = result.series;
    return jsonOk(
      {
        code: definition.code,
        name: definition.name,
        unit: definition.unit,
        currency: definition.currency,
        dataStatus: definition.dataStatus,
        frequency: definition.frequency,
        observations: observations.slice(-parsed.data.years),
        sourceLastUpdated,
        retrievedAt,
        stale: result.stale,
        error: result.error,
      },
      {
        mode: "live-source",
        isDemo: false,
        scope: "national",
        note: "Annual observations, oldest first. Years without a published value are omitted, not interpolated.",
      },
      { requestId, rate, cache: result.stale ? "no-store" : CACHE_CONTROL },
    );
  } catch (error) {
    console.error("economy_trends_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load the indicator trend.", { requestId, rate });
  }
}
