import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/data";
import { baseMeta, CACHE, enforceRateLimit, jsonError, jsonOk, newRequestId } from "@/lib/api/response";
import { stateById } from "@/lib/geo/states";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const rate = await enforceRateLimit(request, "event-detail", 120);
  if (!rate.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { requestId, rate });
  }
  const { id } = await context.params;
  try {
    const snapshot = await getSnapshot();
    const event = snapshot.events.find((candidate) => candidate.id === id);
    if (!event) {
      return jsonError(404, "NOT_FOUND", "Event not found.", { requestId, rate });
    }
    const state = stateById(event.stateId);
    const eventsById = new Map(snapshot.events.map((entry) => [entry.id, entry]));
    const related = event.relatedEventIds
      .map((relatedId) => eventsById.get(relatedId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        category: candidate.category,
        stateId: candidate.stateId,
        stateName: candidate.stateName,
        severity: candidate.severity,
      }));
    return jsonOk(
      { ...event, state, related },
      baseMeta(snapshot, {
        evidenceNote:
          snapshot.mode === "demo"
            ? "Sources are fictional demo records. Independent source count is based on independence groups, not article count."
            : "Independent source count is based on independence groups, not article count.",
        limitations: [
          ...snapshot.limitations,
          ...event.uncertainties,
        ],
      }),
      { requestId, rate, cache: CACHE.events },
    );
  } catch (error) {
    console.error("event_detail_api_error", error);
    return jsonError(500, "INTERNAL_ERROR", "Unable to load event.", { requestId, rate });
  }
}
