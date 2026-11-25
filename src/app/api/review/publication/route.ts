import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth/server";
import { guardReviewRoute, parseReviewQuery, reviewOk } from "@/lib/api/review-route";
import { PostgresPublicationStore } from "@/lib/data/postgres/publication";
import { requireReviewDatabase } from "@/lib/data/postgres/review-database";
import { publicationListQuerySchema } from "@/lib/validation/review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guarded = await guardReviewRoute(request, { scope: "review-publication", mutation: false });
  if (!guarded.ok) return guarded.response;

  const query = parseReviewQuery(request, publicationListQuerySchema);
  if (!query.ok) return query.response;

  try {
    const store = new PostgresPublicationStore(requireReviewDatabase());
    const candidates = await store.listPublishable(query.data.limit);
    return reviewOk({ candidates }, guarded.context.requestId, {
      count: candidates.length,
    });
  } catch (error) {
    console.error("review_publication_list_failed", error);
    return errorResponse(
      "internal",
      "Publishable candidates could not be read.",
      500,
      guarded.context.requestId,
    );
  }
}
