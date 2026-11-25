import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import { guardReviewRoute, parseReviewQuery, reviewOk } from "@/lib/api/review-route";
import { PostgresClusterStore } from "@/lib/data/postgres/clusters";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { clusterQueueQuerySchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guarded = await guardReviewRoute(request, { scope: "review-clusters", mutation: false });
  if (!guarded.ok) return guarded.response;

  const query = parseReviewQuery(request, clusterQueueQuerySchema);
  if (!query.ok) return query.response;

  try {
    const store = new PostgresClusterStore(requireReviewDatabase());
    const clusters = await store.listQueue(query.data.status, query.data.limit);
    return reviewOk({ clusters }, guarded.context.requestId, {
      count: clusters.length,
      status: query.data.status,
    });
  } catch (error) {
    console.error("review_clusters_list_failed", error);
    return errorResponse(
      "internal",
      "The cluster queue could not be read.",
      500,
      guarded.context.requestId,
    );
  }
}
