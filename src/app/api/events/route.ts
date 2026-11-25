import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { filterEvents } from "@/lib/intelligence";
import { eventQuerySchema, flattenZodError, parseSearchParams, queryToFilters } from "@/lib/validation/query";
import { CACHE, baseMeta, enforceRateLimit, facets, jsonError, jsonOk, newRequestId } from "@/lib/api/response";
import type { IntelligenceEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

function sortEvents(events: IntelligenceEvent[], sort: "latest" | "severity" | "occurrence"): IntelligenceEvent[] {
  const sorted = [...events];
  if (sort === "severity") {
    sorted.sort(
      (a, b) => b.severity - a.severity || b.lastUpdatedAt.localeCompare(a.lastUpdatedAt),
    );
  } else if (sort === "occurrence") {
    sorted.sort((a, b) =>
      (b.occurrenceAt ?? b.firstReportedAt).localeCompare(a.occurrenceAt ?? a.firstReportedAt),
    );
  } else {
    sorted.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  }
  return sorted;
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "events", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
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
    const filters = queryToFilters(parsed.data);
    const filtered = sortEvents(
      filterEvents(snapshot.events, filters, snapshot.referenceTime),
      parsed.data.sort,
    );
    const page = filtered.slice(parsed.data.offset, parsed.data.offset + parsed.data.limit);
    return jsonOk(page, baseMeta(snapshot, {
      count: page.length,
      total: filtered.length,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      filters: parsed.data,
      facets: facets(filtered, snapshot.referenceTime),
      evidenceNote: "articleCount is not a count of unique incidents; independentSourceCount counts distinct independence groups.",
    }), { requestId, rate, cache: CACHE.events });
  } catch (error) {
    console.error("events_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load events.", { requestId, rate });
  }
}
