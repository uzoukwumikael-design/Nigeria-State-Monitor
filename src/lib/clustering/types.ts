import type { Category } from "@/lib/types";

/** A near-duplicate pair must fall inside this window before it is scored. */
export const CLUSTER_TIME_WINDOW_HOURS = 72;
/** At or above this score, independent evidence may be attached automatically. */
export const CLUSTER_AUTO_ATTACH_THRESHOLD = 0.86;
/** At or above this score, a reviewer must decide. Below it, records stay separate. */
export const CLUSTER_REVIEW_THRESHOLD = 0.7;
export const CLUSTER_SCORE_VERSION = "nsm-cluster-2026-11-06.1";

/**
 * Evidence-level input to the clustering gate. It is deliberately independent
 * of the database so the same rules can be reused by a worker or a test.
 */
export interface ClusterRecord {
  /** Stable candidate/article public ID. */
  id: string;
  title: string;
  excerpt: string | null;
  category: Category | null;
  stateId: string | null;
  lga: string | null;
  /** Publication/report time used for the 72-hour gate. */
  publishedAt: string | null;
  /** Publisher identity. Multiple articles from one publisher are not independent. */
  publisher: string;
  /** Syndication/ownership group. Copies in one group are not independent. */
  independenceGroup: string;
}

export type ClusterGateFailure =
  | "same_record"
  | "unresolved_category"
  | "category_mismatch"
  | "unresolved_geography"
  | "geography_mismatch"
  | "invalid_time"
  | "outside_time_window";

export type ClusterDecision = "auto_attach" | "review" | "no_match";

export interface ClusterGateState {
  distinct: boolean;
  category: boolean;
  geography: boolean;
  time: boolean;
  /** Both records name different LGAs in the same state. Auto-attach is blocked. */
  lgaConflict: boolean;
  /** Both headlines carry different numbers (for example casualty counts). */
  numericConflict: boolean;
  /** Neither the publisher nor the independence group is shared. */
  independent: boolean;
}

export interface ClusterScoreComponents {
  title: number;
  entity: number;
  geography: number;
  time: number;
}

export interface ClusterAssessment {
  scoreVersion: string;
  candidateId: string;
  existingId: string;
  decision: ClusterDecision;
  /** Null when a hard gate failed before similarity was scored. */
  similarity: number | null;
  components: ClusterScoreComponents | null;
  gates: ClusterGateState;
  independent: boolean;
  failure: ClusterGateFailure | null;
  reasons: string[];
}

export type ClusterQueueStatus = "pending" | "accepted" | "rejected" | "all";

export interface ClusterQueueItem {
  id: string;
  clusterReference: string;
  decision: Exclude<ClusterQueueStatus, "all">;
  similarity: number | null;
  reasons: string[];
  ruleVersion: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  candidate: {
    publicId: string;
    title: string;
    excerpt: string;
    url: string | null;
    category: Category;
    stateId: string;
    lga: string | null;
    publishedAt: string | null;
    sourceSlug: string;
    sourceName: string;
  };
  event: {
    publicId: string;
    title: string;
    category: Category;
    stateId: string;
    firstReportedAt: string;
  };
}

export type ClusterReviewAction = "accept" | "reject";

export interface ClusterReviewInput {
  clusterId: string;
  action: ClusterReviewAction;
  reviewerId: string;
  notes: string;
}

export type ClusterStoreErrorCode =
  | "not_found"
  | "already_decided"
  | "already_linked"
  | "invalid_reviewer"
  | "invalid_notes"
  | "event_unavailable"
  | "candidate_unavailable";

export type ClusterReviewResult =
  | {
      ok: true;
      action: ClusterReviewAction;
      clusterId: string;
      eventPublicId: string;
      auditId: string;
    }
  | { ok: false; code: ClusterStoreErrorCode; message: string };

export interface ClusterScanResult {
  scannedCandidates: number;
  comparedEvents: number;
  queuedForReview: number;
  autoAttached: number;
  skipped: number;
}
