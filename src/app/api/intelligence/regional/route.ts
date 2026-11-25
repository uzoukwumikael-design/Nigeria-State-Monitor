import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { buildRegionalIntelligence, filterEvents } from "@/lib/intelligence";
import {
  flattenZodError,
  parseSearchParams,
  queryToFilters,
  regionalQuerySchema,
} from "@/lib/validation/query";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "regional", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const parsed = parseSearchParams(regionalQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid regional query parameters", {
      requestId,
      rate,
      details: flattenZodError(parsed.error),
    });
  }
  try {
    const snapshot = await getSnapshot();
    // A dashboard state selection is deliberately excluded so all six zones remain comparable.
    const filters = { ...queryToFilters(parsed.data), zone: "all" as const, stateId: null };
    const filtered = filterEvents(snapshot.events, filters, snapshot.referenceTime);
    const regional = buildRegionalIntelligence(
      filtered,
      filters,
      snapshot.referenceTime,
      parsed.data.zone ?? null,
      parsed.data.days,
      snapshot.mode,
    );
    return jsonOk(
      regional,
      baseMeta(snapshot, {
        requiresCaveat: "Regional reported volume must not be interpreted as actual security risk.",
        filters: parsed.data,
      }),
      { requestId, rate, cache: CACHE.events },
    );
  } catch (error) {
    console.error("regional_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load regional intelligence.", { requestId, rate });
  }
}
