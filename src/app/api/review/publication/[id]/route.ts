import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import {
  guardReviewRoute,
  parseReviewBody,
  reviewFailure,
  reviewOk,
} from "@/lib/api/review-route";
import { PostgresPublicationStore } from "@/lib/data/postgres/publication";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { publicationSchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guarded = await guardReviewRoute(request, { scope: "review-publication-publish", mutation: true, limit: 30 });
  if (!guarded.ok) return guarded.response;

  const { id } = await context.params;
  if (!PUBLIC_ID.test(id)) {
    return errorResponse("invalid_request", "Invalid candidate public ID.", 400, guarded.context.requestId);
  }

  const body = await parseReviewBody(request, publicationSchema);
  if (!body.ok) return body.response;

  try {
    const store = new PostgresPublicationStore(requireReviewDatabase());
    const result = await store.publish({
      candidatePublicId: id,
      reviewerId: guarded.context.reviewerId,
      severity: body.data.severity,
      severityRationale: body.data.rationale,
    });
    if (!result.ok) return reviewFailure(result.code, result.message);
    return reviewOk(result, guarded.context.requestId);
  } catch (error) {
    console.error("review_publication_failed", error);
    return errorResponse(
      "internal",
      "The candidate could not be published.",
      500,
      guarded.context.requestId,
    );
  }
}
