import { NextResponse, type NextRequest } from "next/server";
import type { DashboardSnapshot, IntelligenceEvent } from "@/lib/types";
import { categoryBreakdown, zoneSummaries } from "@/lib/intelligence/aggregate";
import { checkRateLimit, clientKey, type RateLimitResult } from "@/lib/api/rate-limit";

export type { RateLimitResult };

export async function enforceRateLimit(
  request: NextRequest,
  scope: string,
  limit = 120,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  return checkRateLimit(clientKey(request, scope), limit, windowMs);
}

export function newRequestId(): string {
  return `req_${globalThis.crypto.randomUUID()}`;
}

export function baseMeta(snapshot: DashboardSnapshot, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: snapshot.mode,
    datasetVersion: snapshot.datasetVersion,
    generatedAt: snapshot.generatedAt,
    referenceTime: snapshot.referenceTime,
    coverage: snapshot.coverage,
    disclaimer: snapshot.disclaimer,
    limitations: snapshot.limitations,
    volumeIsRisk: false,
    ...extra,
  };
}

export function facets(events: readonly IntelligenceEvent[], referenceIso: string): Record<string, unknown> {
  return {
    categories: categoryBreakdown(events).map((entry) => ({
      category: entry.category,
      count: entry.count,
      share: entry.share,
    })),
    zones: zoneSummaries(events, referenceIso).map((zone) => ({
      zone: zone.zone,
      count: zone.reportedEvents,
      share: zone.share,
    })),
  };
}

const RATE_HEADERS = (rate: RateLimitResult) => ({
  "X-RateLimit-Limit": String(rate.limit),
  "X-RateLimit-Remaining": String(rate.remaining),
  "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
});

export function jsonOk(
  data: unknown,
  meta: Record<string, unknown>,
  options: { requestId: string; rate: RateLimitResult; cache?: string; status?: number },
): NextResponse {
  const headers = new Headers({
    "X-Request-Id": options.requestId,
    ...RATE_HEADERS(options.rate),
  });
  if (options.cache) headers.set("Cache-Control", options.cache);
  return NextResponse.json(
    { data, meta, requestId: options.requestId },
    { status: options.status ?? 200, headers },
  );
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  options: {
    requestId: string;
    rate?: RateLimitResult;
    details?: unknown;
    cache?: string;
  },
): NextResponse {
  const headers = new Headers({ "X-Request-Id": options.requestId });
  if (options.rate) {
    for (const [key, value] of Object.entries(RATE_HEADERS(options.rate))) headers.set(key, value);
    if (status === 429) headers.set("Retry-After", String(options.rate.retryAfterSeconds));
  }
  headers.set("Cache-Control", options.cache ?? "no-store");
  return NextResponse.json(
    { error: { code, message, ...(options.details ? { details: options.details } : {}) }, requestId: options.requestId },
    { status, headers },
  );
}

export const CACHE = {
  states: "public, max-age=300, stale-while-revalidate=600",
  events: "public, max-age=30, stale-while-revalidate=120",
  health: "no-store",
  search: "no-store",
};
