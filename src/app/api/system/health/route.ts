import type { NextRequest } from "next/server";
import { getDataRuntime, getSnapshot } from "@/lib/data";
import { enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";
import { summariseSourceHealth } from "@/lib/intelligence/source-health";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "health", 300);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  try {
    const [snapshot, runtime] = await Promise.all([getSnapshot(), getDataRuntime()]);
    const demo = snapshot.mode === "demo";
    const sourceHealth = summariseSourceHealth(snapshot.sources);
    return jsonOk(
      {
        status: demo ? "demo" : "degraded",
        mode: snapshot.mode,
        repository: runtime.repository,
        database: runtime.database,
        ingestion: "not_connected",
        aiEnrichment: "not_connected",
        realtime: "not_connected",
        lastSuccessfulSync: sourceHealth.lastSuccessfulSync,
        datasetVersion: snapshot.datasetVersion,
        datasetGeneratedAt: snapshot.generatedAt,
        referenceTime: snapshot.referenceTime,
        coverage: snapshot.coverage,
        sources: {
          total: sourceHealth.total,
          live: sourceHealth.live,
          demo: sourceHealth.demo,
          healthy: sourceHealth.healthy,
        },
        counts: {
          events: snapshot.events.length,
          states: snapshot.states.length,
        },
        limitations: snapshot.limitations,
        disclaimer: snapshot.disclaimer,
      },
      {
        mode: snapshot.mode,
        repository: runtime.repository,
        datasetVersion: snapshot.datasetVersion,
        checkedAt: new Date().toISOString(),
        note:
          snapshot.mode === "demo"
            ? "This endpoint reports the active demo dataset. Capture is CLI-only and not connected to this dashboard; AI enrichment and realtime are not connected."
            : "This endpoint reports the active production dataset. Scheduled ingestion, AI enrichment and realtime are not connected; status remains degraded.",
      },
      { requestId, rate, cache: "no-store" },
    );
  } catch (error) {
    console.error("health_api_error", error);
    return jsonError(503, "SERVICE_UNAVAILABLE", "Intelligence data is unavailable.", { requestId, rate });
  }
}
