import type { NextRequest } from "next/server";
import { enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";
import { getPostgresDriver } from "@/lib/data/postgres/client";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { buildSourceStatus } from "@/lib/ingestion/source-status";
import { INGESTION_SOURCES, SOURCE_EVIDENCE, disabledSourceSlugs } from "@/lib/ingestion/sources";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "sources-status", 60);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  try {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    const live = process.env.NSM_REPOSITORY?.trim().toLowerCase() === "postgres" && Boolean(databaseUrl);
    let health = null;
    let activity = null;
    if (live && databaseUrl) {
      const store = new PostgresIngestionStore(getPostgresDriver(databaseUrl));
      [health, activity] = await Promise.all([store.listSourceHealth(), store.listSourceActivity()]);
    }
    const { rows, summary } = buildSourceStatus({ sources: INGESTION_SOURCES, evidence: SOURCE_EVIDENCE, health, activity, disabled: disabledSourceSlugs() });
    return jsonOk(
      { sources: rows, summary, healthAvailable: live },
      {
        isDemo: false,
        note: live
          ? "Health and activity come from recorded ingestion runs. A source with repeated failures is paused and retried automatically."
          : "No database is connected, so run health and activity are unknown. The list shows the registered sources and the evidence for each.",
      },
      { requestId, rate, cache: "no-store" },
    );
  } catch (error) {
    console.error("sources_status_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load source status.", { requestId, rate });
  }
}
