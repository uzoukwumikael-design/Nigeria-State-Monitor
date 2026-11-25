import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { buildHistory, resolveHistoryRange, type HistoryRangeRequest } from "@/lib/intelligence";
import { flattenZodError, historyQuerySchema, parseSearchParams } from "@/lib/validation/query";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "history", 60);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const parsed = parseSearchParams(historyQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid history query parameters", {
      requestId,
      rate,
      details: flattenZodError(parsed.error),
    });
  }
  try {
    const snapshot = await getSnapshot();
    const query = parsed.data;
    const rangeRequest: HistoryRangeRequest =
      query.from && query.to
        ? { kind: "custom", from: query.from, to: query.to }
        : { kind: "window", window: query.window ?? "90d" };
    const resolved = resolveHistoryRange(rangeRequest, snapshot.referenceTime, snapshot.coverage);
    if (!resolved.ok) {
      return jsonError(400, "VALIDATION_ERROR", resolved.message, { requestId, rate });
    }
    const history = buildHistory({
      events: snapshot.events,
      states: snapshot.states,
      coverage: snapshot.coverage,
      referenceIso: snapshot.referenceTime,
      range: resolved.range,
      scope: {
        stateId: query.state ?? null,
        zone: query.zone ?? null,
        category: query.category ?? null,
      },
    });
    return jsonOk(
      history,
      baseMeta(snapshot, {
        note:
          "Buckets use event occurrence time (first report time when occurrence is unknown) in Africa/Lagos. Counts are reported volume, not incidence or risk. Dates outside held records are unobserved.",
      }),
      { requestId, rate, cache: CACHE.events },
    );
  } catch (error) {
    console.error("history_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load history.", { requestId, rate });
  }
}
