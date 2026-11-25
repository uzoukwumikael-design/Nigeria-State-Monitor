import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { stateById } from "@/lib/geo/states";
import { filterEvents } from "@/lib/intelligence";
import { eventQuerySchema, flattenZodError, parseSearchParams, queryToFilters } from "@/lib/validation/query";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "state-events", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const { id } = await context.params;
  const state = stateById(id.toUpperCase());
  if (!state) {
    return jsonError(404, "NOT_FOUND", "State not found.", { requestId, rate });
  }
  const parsed = parseSearchParams(eventQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid event query parameters", {
      requestId,
      rate,
      details: flattenZodError(parsed.error),
    });
  }
  try {
    const snapshot = await getSnapshot();
    const filters = { ...queryToFilters(parsed.data), stateId: state.id };
    const filtered = filterEvents(snapshot.events, filters, snapshot.referenceTime);
    const page = filtered.slice(parsed.data.offset, parsed.data.offset + parsed.data.limit);
    return jsonOk(
      page,
      baseMeta(snapshot, {
        state: state.id,
        count: page.length,
        total: filtered.length,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      }),
      { requestId, rate, cache: CACHE.events },
    );
  } catch (error) {
    console.error("state_events_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load state events.", { requestId, rate });
  }
}
