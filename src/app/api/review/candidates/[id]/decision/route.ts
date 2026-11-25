import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import {
  guardReviewRoute,
  parseReviewBody,
  reviewFailure,
  reviewOk,
} from "@/lib/api/review-route";
import { PostgresReviewStore } from "@/lib/data/postgres/review";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { candidateDecisionSchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guarded = await guardReviewRoute(request, { scope: "review-candidate-decision", mutation: true });
  if (!guarded.ok) return guarded.response;

  const { id } = await context.params;
  if (!PUBLIC_ID.test(id)) {
    return errorResponse("invalid_request", "Invalid candidate public ID.", 400, guarded.context.requestId);
  }

  const body = await parseReviewBody(request, candidateDecisionSchema);
  if (!body.ok) return body.response;

  try {
    const store = new PostgresReviewStore(requireReviewDatabase());
    const result = await store.decide({
      candidatePublicId: id,
      action: body.data.action,
      reviewerId: guarded.context.reviewerId,
      category: body.data.category ?? null,
      stateId: body.data.stateId ?? null,
      notes: body.data.notes ?? null,
    });
    if (!result.ok) return reviewFailure(result.code, result.message);
    return reviewOk(
      { candidate: result.candidate, reviewId: result.reviewId },
      guarded.context.requestId,
    );
  } catch (error) {
    console.error("review_candidate_decision_failed", error);
    return errorResponse(
      "internal",
      "The candidate decision could not be applied.",
      500,
      guarded.context.requestId,
    );
  }
}
