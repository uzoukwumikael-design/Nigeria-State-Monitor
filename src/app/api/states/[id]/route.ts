import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { stateById, STATES } from "@/lib/geo/states";
import {
  categoryBreakdown,
  getStateStats,
  severityBreakdown,
  verificationBreakdown,
} from "@/lib/intelligence/aggregate";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "state-detail", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const { id } = await context.params;
  const state = stateById(id.toUpperCase());
  if (!state) {
    return jsonError(404, "NOT_FOUND", "State not found.", {
      requestId,
      rate,
      details: { available: STATES.map((entry) => entry.id) },
    });
  }
  try {
    const snapshot = await getSnapshot();
    const stateEvents = snapshot.events.filter((event) => event.stateId === state.id);
    const latest = [...stateEvents]
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
      .slice(0, 5);
    return jsonOk(
      {
        state,
        stats: getStateStats(snapshot.events, state, snapshot.referenceTime),
        categories: categoryBreakdown(stateEvents),
        severity: severityBreakdown(stateEvents),
        verification: verificationBreakdown(stateEvents),
        latestEvents: latest,
      },
      baseMeta(snapshot, {
        note: "State statistics cover the active published snapshot; reported volume is not risk.",
      }),
      { requestId, rate, cache: CACHE.states },
    );
  } catch (error) {
    console.error("state_detail_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load state.", { requestId, rate });
  }
}
