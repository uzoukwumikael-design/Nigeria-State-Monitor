import type {
  Category,
  SourceRelationship,
  SourceType,
  VerificationStatus,
} from "@/lib/types";

export const VERIFICATION_RULE_VERSION = "nsm-verification-2026-11-06.1";
export const MIN_VERIFICATION_RATIONALE = 10;
export const MAX_VERIFICATION_RATIONALE = 1_000;

/** Evidence attached to an existing event. Independence is evaluated by group. */
export interface VerificationEvidence {
  publisher: string;
  independenceGroup: string;
  relationship: SourceRelationship;
  sourceType: SourceType;
}

export interface VerificationContext {
  eventPublicId: string;
  status: VerificationStatus;
  evidence: readonly VerificationEvidence[];
}

export interface VerificationTransitionInput {
  target: VerificationStatus;
  reviewerId: string;
  rationale: string;
  /**
   * Required for `corroborated`. The reviewer explicitly asserts that the
   * independent reports agree beyond the automatic evidence count.
   */
  approveCorroboration?: boolean;
}

export interface VerificationEvidenceSummary {
  total: number;
  supporting: number;
  conflicting: number;
  retracted: number;
  background: number;
  official: number;
  independentGroups: number;
  conflictGroups: number;
  officialGroups: number;
  credibleConflict: boolean;
}

export interface VerificationTransition {
  ruleVersion: string;
  eventPublicId: string;
  previousStatus: VerificationStatus;
  status: VerificationStatus;
  reviewerId: string;
  rationale: string;
  decidedAt: string;
  evidence: VerificationEvidenceSummary;
  /** Safe timeline text. Reviewer identity and rationale stay in the audit log. */
  description: string;
}

/** Reviewer-facing summary of a published production event. */
export interface VerificationEventSummary {
  eventPublicId: string;
  title: string;
  category: Category;
  stateId: string | null;
  severity: number;
  verificationStatus: VerificationStatus;
  firstReportedAt: string;
  lastUpdatedAt: string;
  articleCount: number;
  independentSourceCount: number;
  conflictGroups: number;
  retractedCount: number;
  allowedTargets: readonly VerificationStatus[];
}

export type VerificationErrorCode =
  | "invalid_reviewer"
  | "invalid_rationale"
  | "unknown_status"
  | "no_change"
  | "terminal_retracted"
  | "invalid_transition"
  | "insufficient_evidence"
  | "conflicting_evidence"
  | "corroboration_approval_required";

export type VerificationResult =
  | { ok: true; transition: VerificationTransition }
  | { ok: false; code: VerificationErrorCode; message: string };

/** Allowed state changes. `retracted` is terminal; `unassessed` is never a target. */
export const ALLOWED_VERIFICATION_TRANSITIONS: Record<
  VerificationStatus,
  readonly VerificationStatus[]
> = {
  unassessed: [
    "single_source",
    "multiple_sources",
    "corroborated",
    "official_confirmation",
    "disputed",
    "retracted",
  ],
  single_source: [
    "multiple_sources",
    "official_confirmation",
    "disputed",
    "retracted",
  ],
  multiple_sources: [
    "corroborated",
    "official_confirmation",
    "disputed",
    "retracted",
  ],
  corroborated: ["disputed", "official_confirmation", "retracted"],
  official_confirmation: ["disputed", "retracted"],
  disputed: ["official_confirmation", "retracted"],
  retracted: [],
};
