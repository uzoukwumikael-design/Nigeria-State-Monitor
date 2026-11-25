import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { searchSnapshot } from "@/lib/intelligence/search";
import { searchQuerySchema, flattenZodError, parseSearchParams } from "@/lib/validation/query";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "search", 30);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many searches. Try again shortly.", { requestId, rate });
  }
  const parsed = parseSearchParams(searchQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid search query", {
      requestId,
      rate,
      details: flattenZodError(parsed.error),
    });
  }
  try {
    const snapshot = await getSnapshot();
    const results = searchSnapshot(parsed.data.q, snapshot.events, snapshot.referenceTime, parsed.data.limit);
    return jsonOk(
      { ...results, query: parsed.data.q },
      baseMeta(snapshot, {
        count: results.states.length + results.events.length + results.categories.length + results.zones.length,
        note: "Search runs over the active published snapshot only; no external search provider is used.",
      }),
      { requestId, rate, cache: CACHE.search },
    );
  } catch (error) {
    console.error("search_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to complete search.", { requestId, rate });
  }
}
