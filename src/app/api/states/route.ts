import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { allStateStats } from "@/lib/intelligence/aggregate";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "states", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  try {
    const snapshot = await getSnapshot();
    const stats = allStateStats(snapshot.events, snapshot.states, snapshot.referenceTime);
    const data = snapshot.states.map((state) => ({
      ...state,
      stats: stats[state.id] ?? null,
    }));
    return jsonOk(
      data,
      baseMeta(snapshot, {
        count: data.length,
        total: 37,
        note: "Statistics are derived from the active published snapshot. Reported volume is not risk.",
      }),
      { requestId, rate, cache: CACHE.states },
    );
  } catch (error) {
    console.error("states_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load states.", { requestId, rate });
  }
}
