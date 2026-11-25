import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import { guardReviewRoute, parseReviewQuery, reviewOk } from "@/lib/api/review-route";
import { PostgresVerificationStore } from "@/lib/data/postgres/verification";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { verificationListQuerySchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guarded = await guardReviewRoute(request, { scope: "review-verification", mutation: false });
  if (!guarded.ok) return guarded.response;

  const query = parseReviewQuery(request, verificationListQuerySchema);
  if (!query.ok) return query.response;

  try {
    const store = new PostgresVerificationStore(requireReviewDatabase());
    const events = await store.listEvents(query.data.limit);
    return reviewOk({ events }, guarded.context.requestId, {
      count: events.length,
    });
  } catch (error) {
    console.error("review_verification_list_failed", error);
    return errorResponse(
      "internal",
      "Published events could not be read.",
      500,
      guarded.context.requestId,
    );
  }
}
