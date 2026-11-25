import { STATE_BY_ID } from "@/lib/geo/states";
import { CATEGORY_IDS, type Category } from "@/lib/types";
import type {
  ReviewCandidate,
  ReviewDecisionInput,
  ReviewDecisionResult,
  ReviewErrorCode,
} from "@/lib/review/types";

/** Stable operator identifier, not a personal email address. */
export const REVIEWER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const MAX_REVIEW_NOTES = 1_000;
export const REVIEWER_REJECTION_REASON = "reviewer_rejected";

function failure(code: ReviewErrorCode, message: string): ReviewDecisionResult {
  return { ok: false, code, message };
}

function normalizeNotes(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; code: ReviewErrorCode; message: string } {
  if (raw == null) return { ok: true, value: null };
  // Strip control characters, then collapse surrounding whitespace. Notes are
  // reviewer rationale, never article body text.
  const value = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > MAX_REVIEW_NOTES) {
    return {
      ok: false,
      code: "invalid_notes",
      message: `Review notes must be ${MAX_REVIEW_NOTES} characters or fewer.`,
    };
  }
  return { ok: true, value };
}

function knownCategory(value: string): value is Category {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}

function knownState(value: string): boolean {
  return STATE_BY_ID.has(value);
}

/**
 * Validates a reviewer decision without touching the database. A decision is
 * evidence review only: it never publishes an event. Acceptance requires a
 * category and a state; unresolved geography must be corrected by the reviewer
 * rather than guessed.
 */
export function buildReviewDecision(
  candidate: ReviewCandidate,
  input: ReviewDecisionInput,
  now: Date,
): ReviewDecisionResult {
  if (candidate.status === "accepted" || candidate.status === "rejected") {
    return failure("already_decided", `Candidate ${candidate.publicId} is already ${candidate.status}.`);
  }

  const reviewerId = input.reviewerId.trim().toLowerCase();
  if (!REVIEWER_ID_PATTERN.test(reviewerId)) {
    return failure(
      "invalid_reviewer",
      "Reviewer ID must be 3–64 characters: lowercase letters, digits, dots, underscores or hyphens.",
    );
  }

  const notes = normalizeNotes(input.notes);
  if (!notes.ok) return failure(notes.code, notes.message);

  const decidedAt = now.toISOString();

  if (input.action === "reject") {
    if (!notes.value || notes.value.length < 3) {
      return failure("missing_notes", "Rejection requires a short reviewer note explaining why.");
    }
    return {
      ok: true,
      decision: {
        action: "reject",
        previousStatus: candidate.status,
        status: "rejected",
        category: candidate.category,
        stateId: candidate.stateId,
        lga: candidate.lga,
        rejectionReason: REVIEWER_REJECTION_REASON,
        reviewerId,
        notes: notes.value,
        decidedAt,
      },
    };
  }

  const category = (input.category ?? candidate.category) as string | null;
  if (!category) {
    return failure(
      "missing_category",
      "Acceptance requires a category. Supply --category after reviewing the article.",
    );
  }
  if (!knownCategory(category)) {
    return failure("unknown_category", `Unknown category: ${category}.`);
  }

  const stateId = (input.stateId ?? candidate.stateId)?.trim().toUpperCase() ?? null;
  if (!stateId) {
    return failure(
      "missing_state",
      "Acceptance requires a state. Supply --state after reviewing the article; unresolved geography is not guessed.",
    );
  }
  if (!knownState(stateId)) {
    return failure("unknown_state", `Unknown state: ${stateId}.`);
  }

  // An LGA is only meaningful for the state it came from. A state correction
  // clears the deterministic LGA instead of silently carrying it across.
  const lga = stateId === candidate.stateId ? candidate.lga : null;

  return {
    ok: true,
    decision: {
      action: "accept",
      previousStatus: candidate.status,
      status: "accepted",
      category,
      stateId,
      lga,
      rejectionReason: null,
      reviewerId,
      notes: notes.value,
      decidedAt,
    },
  };
}
