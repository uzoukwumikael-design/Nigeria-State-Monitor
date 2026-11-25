import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import {
  guardReviewRoute,
  parseReviewBody,
  reviewFailure,
  reviewOk,
} from "@/lib/api/review-route";
import { PostgresVerificationStore } from "@/lib/data/postgres/verification";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { verificationTransitionSchema } from "@/lib/validation/review";
import type { VerificationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guarded = await guardReviewRoute(request, { scope: "review-verification-transition", mutation: true });
  if (!guarded.ok) return guarded.response;

  const { id } = await context.params;
  if (!PUBLIC_ID.test(id)) {
    return errorResponse("invalid_request", "Invalid event public ID.", 400, guarded.context.requestId);
  }

  const body = await parseReviewBody(request, verificationTransitionSchema);
  if (!body.ok) return body.response;

  try {
    const store = new PostgresVerificationStore(requireReviewDatabase());
    const result = await store.transition({
      eventPublicId: id,
      target: body.data.target as VerificationStatus,
      reviewerId: guarded.context.reviewerId,
      rationale: body.data.rationale,
      approveCorroboration: body.data.approveCorroboration ?? false,
    });
    if (!result.ok) return reviewFailure(result.code, result.message);
    return reviewOk(result, guarded.context.requestId);
  } catch (error) {
    console.error("review_verification_transition_failed", error);
    return errorResponse(
      "internal",
      "The verification transition could not be applied.",
      500,
      guarded.context.requestId,
    );
  }
}
