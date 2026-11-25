import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import { guardReviewRoute, parseReviewQuery, reviewOk } from "@/lib/api/review-route";
import { PostgresReviewStore } from "@/lib/data/postgres/review";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { reviewQueueQuerySchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guarded = await guardReviewRoute(request, { scope: "review-candidates", mutation: false });
  if (!guarded.ok) return guarded.response;

  const query = parseReviewQuery(request, reviewQueueQuerySchema);
  if (!query.ok) return query.response;

  try {
    const store = new PostgresReviewStore(requireReviewDatabase());
    const candidates = await store.listReviewQueue(query.data);
    return reviewOk({ candidates }, guarded.context.requestId, {
      count: candidates.length,
      status: query.data.status,
    });
  } catch (error) {
    console.error("review_candidates_list_failed", error);
    return errorResponse(
      "internal",
      "The review queue could not be read.",
      500,
      guarded.context.requestId,
    );
  }
}
