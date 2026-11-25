import { REVIEWER_ID_PATTERN } from "@/lib/review/decide";
import type { Category, Severity } from "@/lib/types";
import { clampExcerpt, publishedExcerptLimit } from "@/lib/publication/excerpt";

export const PUBLICATION_RULE_VERSION = "nsm-publication-2026-11-07.1";
export const MIN_PUBLICATION_RATIONALE = 10;
export const MAX_PUBLICATION_RATIONALE = 500;

export interface PublicationInput {
  candidatePublicId: string;
  reviewerId: string;
  severity: number;
  severityRationale: string;
}

export interface PublicationCandidateShape {
  publicId: string;
  status: "pending" | "needs_review" | "accepted" | "rejected";
  category: Category | null;
  stateId: string | null;
  title: string;
  excerpt: string;
}

export type PublicationErrorCode =
  | "invalid_reviewer"
  | "invalid_severity"
  | "invalid_rationale"
  | "not_accepted"
  | "unresolved_category"
  | "unresolved_state"
  | "missing_title";

export type PublicationValidationResult =
  | { ok: true; severity: Severity; severityRationale: string; reviewerId: string }
  | { ok: false; code: PublicationErrorCode; message: string };

function clean(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

/**
 * Validates reviewer publication input. The reviewer supplies the severity and
 * a rationale; the event title, excerpt, category, state and source are copied
 * from the accepted candidate and are never invented here.
 */
export function validatePublicationInput(
  candidate: PublicationCandidateShape,
  input: PublicationInput,
): PublicationValidationResult {
  if (candidate.status !== "accepted") {
    return {
      ok: false,
      code: "not_accepted",
      message: `Candidate ${candidate.publicId} must be accepted before publication.`,
    };
  }
  if (!candidate.category) {
    return {
      ok: false,
      code: "unresolved_category",
      message: `Candidate ${candidate.publicId} has no resolved category.`,
    };
  }
  if (!candidate.stateId) {
    return {
      ok: false,
      code: "unresolved_state",
      message: `Candidate ${candidate.publicId} has no resolved state.`,
    };
  }
  if (!candidate.title.trim()) {
    return {
      ok: false,
      code: "missing_title",
      message: `Candidate ${candidate.publicId} has no headline.`,
    };
  }

  const reviewerId = input.reviewerId.trim().toLowerCase();
  if (!REVIEWER_ID_PATTERN.test(reviewerId)) {
    return {
      ok: false,
      code: "invalid_reviewer",
      message: "Reviewer ID must be 3–64 characters: lowercase letters, digits, dots, underscores or hyphens.",
    };
  }

  if (!Number.isInteger(input.severity) || input.severity < 1 || input.severity > 5) {
    return {
      ok: false,
      code: "invalid_severity",
      message: "Severity must be an integer from 1 to 5.",
    };
  }

  const rationale = clean(input.severityRationale);
  if (rationale.length < MIN_PUBLICATION_RATIONALE) {
    return {
      ok: false,
      code: "invalid_rationale",
      message: `A severity rationale of at least ${MIN_PUBLICATION_RATIONALE} characters is required.`,
    };
  }
  if (rationale.length > MAX_PUBLICATION_RATIONALE) {
    return {
      ok: false,
      code: "invalid_rationale",
      message: `A severity rationale must be ${MAX_PUBLICATION_RATIONALE} characters or fewer.`,
    };
  }

  return {
    ok: true,
    reviewerId,
    severity: input.severity as Severity,
    severityRationale: rationale,
  };
}

/**
 * The summary is the publisher excerpt, or the headline when the publisher did
 * not supply a usable excerpt. Full article text is never stored.
 */
export function publicationSummary(title: string, excerpt: string, excerptLimit: number = publishedExcerptLimit()): string {
  // Publisher text is only stored in the event when allowed (default: headline only; see excerpt.ts).
  const allowed = clampExcerpt(clean(excerpt), excerptLimit);
  if (allowed) return allowed;
  return clean(title);
}

export function publicationUncertainties(hasLga: boolean): string[] {
  const values = [
    "Published from a single accepted candidate; verification has not been assessed.",
    "Reported-event details come from the linked publisher evidence and may be incomplete.",
  ];
  if (hasLga) {
    values.push("An LGA is reported, but the map marker is a state-level centroid, not an incident location.");
  } else {
    values.push("The map marker is a state-level centroid, not an incident location.");
  }
  return values;
}
