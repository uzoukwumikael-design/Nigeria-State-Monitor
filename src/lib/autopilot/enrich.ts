import { runEnrichment } from "@/lib/ai/runner";
import type { EnrichmentCandidate, EnrichmentProvider, EnrichmentStore } from "@/lib/ai/types";

export interface EnrichPendingSummary {
  enabled: boolean;
  attempted: number;
  stored: number;
  failed: number;
  /** Count per outcome (stored, skipped, invalid, provider_error), for diagnosing a model that misbehaves. */
  byStatus: Record<string, number>;
  /** The first few failure messages. */
  problems: string[];
  timeBudgetReached: boolean;
}

export interface EnrichPendingInput {
  provider: EnrichmentProvider;
  store: EnrichmentStore & { listCandidates(limit: number): Promise<EnrichmentCandidate[]> };
  /** Candidates to classify this run; bounded because each one is a paid model call. */
  limit: number;
  deadlineMs?: number;
  now?: () => number;
}

/**
 * Asks the configured AI model about candidates that have no proposal yet, one at a time, and stores each
 * validated proposal. A failing or invalid response is counted and skipped; it never stops the run, and the
 * deterministic classifier still decides for that candidate.
 */
export async function enrichPending(input: EnrichPendingInput): Promise<EnrichPendingSummary> {
  const summary: EnrichPendingSummary = { enabled: input.provider.enabled, attempted: 0, stored: 0, failed: 0, byStatus: {}, problems: [], timeBudgetReached: false };
  if (!input.provider.enabled) return summary;
  const clock = input.now ?? Date.now;
  const candidates = await input.store.listCandidates(input.limit);
  for (const candidate of candidates) {
    if (input.deadlineMs !== undefined && clock() > input.deadlineMs) {
      summary.timeBudgetReached = true;
      break;
    }
    summary.attempted += 1;
    const result = await runEnrichment({ provider: input.provider, candidate, store: input.store });
    summary.byStatus[result.status] = (summary.byStatus[result.status] ?? 0) + 1;
    if (result.status === "stored") summary.stored += 1;
    else if (result.status !== "skipped") {
      summary.failed += 1;
      if (summary.problems.length < 3 && "message" in result) summary.problems.push(`${result.status}: ${result.message}`);
    }
  }
  return summary;
}
