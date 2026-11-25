import { createHash } from "node:crypto";
import { buildEnrichmentPrompt, buildEnrichmentRequest } from "@/lib/ai/prompt";
import { validateEnrichmentText } from "@/lib/ai/schema";
import {
  ENRICHMENT_PROMPT_VERSION,
  ENRICHMENT_SCHEMA_VERSION,
} from "@/lib/ai/constants";
import type {
  EnrichmentCandidate,
  EnrichmentMetadata,
  EnrichmentProvider,
  EnrichmentRunResult,
  EnrichmentStore,
} from "@/lib/ai/types";

export interface RunEnrichmentInput {
  provider: EnrichmentProvider;
  candidate: EnrichmentCandidate;
  store: EnrichmentStore;
  now?: Date;
}

function safeProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const message = clean || "The provider failed without an error message.";
  return message.length <= 300 ? message : `${message.slice(0, 299)}…`;
}

/**
 * The enrichment boundary. A provider only returns text; this function builds
 * bounded input, validates the response, hashes the raw text and asks the store
 * to persist a validated proposal. It never updates a candidate or creates an
 * event.
 */
export async function runEnrichment(input: RunEnrichmentInput): Promise<EnrichmentRunResult> {
  const { provider, candidate, store } = input;
  if (!provider.enabled) {
    return { status: "disabled", provider: provider.id };
  }
  if (candidate.status === "rejected") {
    return {
      status: "skipped",
      provider: provider.id,
      code: "rejected_candidate",
      message: `Candidate ${candidate.publicId} is rejected; no enrichment was attempted.`,
    };
  }

  const request = buildEnrichmentRequest(candidate);
  const messages = buildEnrichmentPrompt(request);

  let rawText: string;
  try {
    rawText = await provider.complete(messages);
  } catch (error) {
    return {
      status: "provider_error",
      provider: provider.id,
      message: safeProviderError(error),
    };
  }

  const processedAt = (input.now ?? new Date()).toISOString();
  const metadata: EnrichmentMetadata = {
    provider: provider.id,
    model: provider.model,
    promptVersion: ENRICHMENT_PROMPT_VERSION,
    schemaVersion: ENRICHMENT_SCHEMA_VERSION,
    processedAt,
    rawResponseHash: createHash("sha256").update(rawText, "utf8").digest("hex"),
  };

  const validation = validateEnrichmentText(rawText, request);
  if (!validation.ok) {
    return {
      status: "invalid",
      provider: provider.id,
      code: validation.code,
      message: validation.message,
      metadata,
    };
  }

  const stored = await store.record({
    candidatePublicId: candidate.publicId,
    proposal: validation.proposal,
    metadata,
  });
  if (!stored.ok) {
    return {
      status: "skipped",
      provider: provider.id,
      code: stored.code,
      message: stored.message,
    };
  }

  return {
    status: "stored",
    provider: provider.id,
    enrichmentId: stored.id,
    duplicate: stored.duplicate,
    proposal: validation.proposal,
    metadata,
  };
}
