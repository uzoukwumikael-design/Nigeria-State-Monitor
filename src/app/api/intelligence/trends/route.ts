import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { filterEvents, trendSeries } from "@/lib/intelligence";
import { trendsQuerySchema, flattenZodError, parseSearchParams } from "@/lib/validation/query";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";
import type { Filters } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "trends", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const parsed = parseSearchParams(trendsQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid trend query parameters", {
      requestId,
      rate,
      details: flattenZodError(parsed.error),
    });
  }
  try {
    const snapshot = await getSnapshot();
    const filtered = filterEvents(
      snapshot.events,
      {
        category: parsed.data.category ?? "all",
        zone: parsed.data.zone ?? "all",
        stateId: parsed.data.state ?? null,
        severity: (parsed.data.severity ?? "all") as Filters["severity"],
        verification: parsed.data.verification ?? "all",
        window: "all",
        q: parsed.data.q ?? "",
      },
      snapshot.referenceTime,
    );
    const series = trendSeries(filtered, snapshot.referenceTime, parsed.data.days);
    return jsonOk(
      {
        days: parsed.data.days,
        series,
        total: series.reduce((sum, point) => sum + point.total, 0),
        basis: "occurrence_time",
        coverage: snapshot.coverage,
      },
      baseMeta(snapshot, {
        note: "Daily buckets use event occurrence time in Africa/Lagos. Missing buckets are zero-filled, not omitted.",
      }),
      { requestId, rate, cache: CACHE.events },
    );
  } catch (error) {
    console.error("trends_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load trends.", { requestId, rate });
  }
}
