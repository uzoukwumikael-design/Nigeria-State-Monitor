import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "sources", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  try {
    const snapshot = await getSnapshot();
    const demo = snapshot.mode === "demo";
    return jsonOk(
      snapshot.sources,
      baseMeta(snapshot, {
        count: snapshot.sources.length,
        note: demo
          ? "All sources listed here are fictional demo sources. No live publication is connected."
          : "Sources listed here come from the active production registry. Ingestion health is reported separately.",
        ingestion: "not_connected",
        disclaimer: demo ? "DEMO SOURCES — NOT REAL PUBLICATIONS" : null,
      }),
      { requestId, rate, cache: CACHE.states },
    );
  } catch (error) {
    console.error("sources_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load sources.", { requestId, rate });
  }
}
