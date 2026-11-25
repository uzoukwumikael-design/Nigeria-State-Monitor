import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import {
  guardReviewRoute,
  parseReviewBody,
  reviewFailure,
  reviewOk,
} from "@/lib/api/review-route";
import { PostgresClusterStore } from "@/lib/data/postgres/clusters";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { clusterDecisionSchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guarded = await guardReviewRoute(request, { scope: "review-cluster-decision", mutation: true });
  if (!guarded.ok) return guarded.response;

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return errorResponse("invalid_request", "Invalid cluster ID.", 400, guarded.context.requestId);
  }

  const body = await parseReviewBody(request, clusterDecisionSchema);
  if (!body.ok) return body.response;

  try {
    const store = new PostgresClusterStore(requireReviewDatabase());
    const result = await store.review({
      clusterId: id,
      action: body.data.action,
      reviewerId: guarded.context.reviewerId,
      notes: body.data.notes,
    });
    if (!result.ok) return reviewFailure(result.code, result.message);
    return reviewOk(result, guarded.context.requestId);
  } catch (error) {
    console.error("review_cluster_decision_failed", error);
    return errorResponse(
      "internal",
      "The cluster decision could not be applied.",
      500,
      guarded.context.requestId,
    );
  }
}
