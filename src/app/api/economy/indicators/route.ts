import type { NextRequest } from "next/server";
import { enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";
import { getEconomySnapshot } from "@/lib/economy/service";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "economy", 60);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  try {
    const snapshot = await getEconomySnapshot();
    const available = snapshot.indicators.filter((item) => item.latest !== null);
    if (available.length === 0) {
      return jsonError(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Economic indicators could not be retrieved from the World Bank API and no earlier copy is held. No figures are shown.",
        {
          requestId,
          rate,
          details: snapshot.indicators.map((item) => ({ code: item.code, error: item.error })),
        },
      );
    }
    return jsonOk(
      snapshot,
      {
        mode: "live-source",
        isDemo: false,
        scope: "national",
        stale: snapshot.stale,
        note:
          "National annual series from the World Bank WDI. Each indicator carries its own reference year; periods are never mixed. State and zone economic series are not integrated. These figures are independent of news-derived event counts.",
      },
      { requestId, rate, cache: snapshot.stale ? "no-store" : CACHE_CONTROL },
    );
  } catch (error) {
    console.error("economy_indicators_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load economic indicators.", { requestId, rate });
  }
}
