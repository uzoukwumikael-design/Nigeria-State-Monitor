import type { Category } from "@/lib/types";

export type EnrichmentCandidateStatus = "pending" | "needs_review" | "accepted" | "rejected";

export interface EnrichmentArticle {
  title: string;
  excerpt: string;
  publishedAt: string | null;
  retrievedAt: string;
  sourceSlug: string;
  sourceName: string;
  attribution: string;
}

/**
 * The minimum evidence shape needed to build a proposal. A ReviewCandidate is
 * structurally compatible: enrichment reads captured evidence, never events.
 */
export interface EnrichmentCandidate {
  publicId: string;
  status: EnrichmentCandidateStatus;
  category: Category | null;
  stateId: string | null;
  lga: string | null;
  article: EnrichmentArticle;
}

export interface EnrichmentRequest {
  candidate: {
    publicId: string;
    category: Category | null;
    stateId: string | null;
    lga: string | null;
  };
  article: {
    title: string;
    excerpt: string;
    publishedAt: string | null;
    retrievedAt: string;
    sourceSlug: string;
    sourceName: string;
  };
}

/** The only shape accepted from a model after validation. */
export interface EnrichmentProposal {
  category: Category | null;
  stateId: string | null;
  lga: string | null;
  confidence: number;
  locationEvidence: string[];
  summary: string;
  entities: string[];
  uncertainties: string[];
  analysis: string | null;
}

export interface EnrichmentMetadata {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  processedAt: string;
  rawResponseHash: string;
}

export interface EnrichmentMessages {
  system: string;
  user: string;
}

/**
 * Transport boundary for a model. A provider receives bounded messages and
 * returns raw text; it never receives a database handle and cannot write an
 * event. Validation and persistence happen outside the provider.
 */
export interface EnrichmentProvider {
  readonly id: string;
  readonly model: string;
  readonly enabled: boolean;
  complete(messages: EnrichmentMessages): Promise<string>;
}

export type EnrichmentValidationCode =
  | "empty_response"
  | "invalid_json"
  | "schema_invalid"
  | "unknown_state"
  | "lga_without_state"
  | "unknown_lga"
  | "missing_location_evidence"
  | "unsupported_location_evidence"
  | "unsupported_url"
  | "unsupported_content";

export type EnrichmentValidationResult =
  | { ok: true; proposal: EnrichmentProposal }
  | { ok: false; code: EnrichmentValidationCode; message: string };

export type EnrichmentStoreCode = "not_found" | "rejected_candidate";

export type EnrichmentStoreResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; code: EnrichmentStoreCode; message: string };

export interface EnrichmentStore {
  record(input: {
    candidatePublicId: string;
    proposal: EnrichmentProposal;
    metadata: EnrichmentMetadata;
  }): Promise<EnrichmentStoreResult>;
}

export type EnrichmentRunResult =
  | { status: "disabled"; provider: string }
  | { status: "provider_error"; provider: string; message: string }
  | {
      status: "invalid";
      provider: string;
      code: EnrichmentValidationCode;
      message: string;
      metadata: EnrichmentMetadata;
    }
  | {
      status: "skipped";
      provider: string;
      code: EnrichmentStoreCode;
      message: string;
    }
  | {
      status: "stored";
      provider: string;
      enrichmentId: string;
      duplicate: boolean;
      proposal: EnrichmentProposal;
      metadata: EnrichmentMetadata;
    };
