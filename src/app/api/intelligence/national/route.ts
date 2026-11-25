import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { filterEvents, nationalSummary } from "@/lib/intelligence";
import { eventQuerySchema, flattenZodError, parseSearchParams, queryToFilters } from "@/lib/validation/query";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "national", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const parsed = parseSearchParams(eventQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid intelligence query parameters", {
      requestId,
      rate,
      details: flattenZodError(parsed.error),
    });
  }
  try {
    const snapshot = await getSnapshot();
    const filters = queryToFilters(parsed.data);
    const filtered = filterEvents(snapshot.events, filters, snapshot.referenceTime);
    const summary = nationalSummary(filtered, filters, snapshot.referenceTime, snapshot.mode);
    return jsonOk(
      {
        ...summary,
        latest: filtered.slice(0, 8),
        coverage: snapshot.coverage,
        limitations: snapshot.limitations,
      },
      baseMeta(snapshot, {
        count: summary.totals.reportedEvents,
        filters: parsed.data,
        note: "Reported event volume is not incidence, danger or a regional safety ranking.",
      }),
      { requestId, rate, cache: CACHE.events },
    );
  } catch (error) {
    console.error("national_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load national intelligence.", { requestId, rate });
  }
}
