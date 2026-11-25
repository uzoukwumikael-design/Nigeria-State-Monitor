import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import { guardReviewRoute, parseReviewQuery, reviewOk } from "@/lib/api/review-route";
import { PostgresClusterStore } from "@/lib/data/postgres/clusters";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { clusterScanSchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

/**
 * Re-runs the deterministic cluster assessment. This can auto-attach only when
 * the hard gates and independence checks already passed; it never publishes.
 */
export async function POST(request: NextRequest) {
  const guarded = await guardReviewRoute(request, { scope: "review-cluster-scan", mutation: true, limit: 6 });
  if (!guarded.ok) return guarded.response;

  const query = parseReviewQuery(request, clusterScanSchema);
  if (!query.ok) return query.response;

  try {
    const store = new PostgresClusterStore(requireReviewDatabase());
    const result = await store.scan(query.data.limit);
    return reviewOk(result, guarded.context.requestId);
  } catch (error) {
    console.error("review_cluster_scan_failed", error);
    return errorResponse(
      "internal",
      "The cluster scan could not be completed.",
      500,
      guarded.context.requestId,
    );
  }
}
