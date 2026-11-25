import type { Category } from "@/lib/types";

export type ReviewAction = "accept" | "reject";

/**
 * Candidate status as seen by the reviewer. Capture can only produce
 * pending/needs_review/rejected; accepted is reachable only through this path.
 */
export type ReviewCandidateStatus = "pending" | "needs_review" | "accepted" | "rejected";

export type ReviewQueueFilter = ReviewCandidateStatus | "open";

export interface ReviewArticle {
  publicId: string;
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string | null;
  retrievedAt: string;
  sourceSlug: string;
  sourceName: string;
  attribution: string;
}

export interface ReviewCandidate {
  id: string;
  publicId: string;
  status: ReviewCandidateStatus;
  category: Category | null;
  stateId: string | null;
  lga: string | null;
  categoryConfidence: number;
  geoConfidence: number;
  reasons: string[];
  ruleVersion: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  article: ReviewArticle;
}

export interface ReviewDecisionInput {
  candidatePublicId: string;
  action: ReviewAction;
  reviewerId: string;
  notes?: string | null;
  /** A reviewer correction. Omitted values keep the deterministic proposal. */
  category?: Category | null;
  stateId?: string | null;
}

export type ReviewErrorCode =
  | "not_found"
  | "already_decided"
  | "invalid_reviewer"
  | "missing_category"
  | "missing_state"
  | "unknown_category"
  | "unknown_state"
  | "missing_notes"
  | "invalid_notes";

export interface ReviewDecision {
  action: ReviewAction;
  previousStatus: ReviewCandidateStatus;
  status: "accepted" | "rejected";
  category: Category | null;
  stateId: string | null;
  lga: string | null;
  rejectionReason: string | null;
  reviewerId: string;
  notes: string | null;
  decidedAt: string;
}

export type ReviewDecisionResult =
  | { ok: true; decision: ReviewDecision }
  | { ok: false; code: ReviewErrorCode; message: string };

export type ReviewResult =
  | { ok: true; candidate: ReviewCandidate; reviewId: string }
  | { ok: false; code: ReviewErrorCode; message: string };

export interface ReviewQueueQuery {
  status?: ReviewQueueFilter;
  limit?: number;
}
