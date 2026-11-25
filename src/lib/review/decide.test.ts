import { describe, expect, it } from "vitest";
import { buildReviewDecision, MAX_REVIEW_NOTES } from "@/lib/review/decide";
import type { ReviewCandidate } from "@/lib/review/types";
import type { Category } from "@/lib/types";

const NOW = new Date("2026-11-05T10:00:00.000Z");

function makeCandidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    publicId: "cand-aaaaaaaaaaaaaaaaaaaaaaaa",
    status: "pending",
    category: "security",
    stateId: "NG-PL",
    lga: "Jos North",
    categoryConfidence: 0.8,
    geoConfidence: 0.9,
    reasons: ["title:gunmen", "state:Plateau"],
    ruleVersion: "nsm-priors-2026-11-05.1",
    createdAt: "2026-11-05T09:00:00.000Z",
    reviewedAt: null,
    reviewedBy: null,
    article: {
      publicId: "art-aaaaaaaaaaaaaaaaaaaaaaaa",
      title: "Gunmen abduct Plateau varsity student",
      url: "https://www.premiumtimesng.com/news/more-news/910001-a.html",
      excerpt: "Security sources said the student was later freed.",
      publishedAt: "2026-11-05T06:00:00.000Z",
      retrievedAt: "2026-11-05T09:00:00.000Z",
      sourceSlug: "premium-times",
      sourceName: "Premium Times",
      attribution: "Premium Times Nigeria",
    },
    ...overrides,
  };
}

describe("review decisions", () => {
  it("accepts a fully resolved candidate and records identity and time", () => {
    const result = buildReviewDecision(
      makeCandidate(),
      {
        candidatePublicId: "cand-aaaaaaaaaaaaaaaaaaaaaaaa",
        action: "accept",
        reviewerId: "Reviewer-01",
      },
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      decision: {
        action: "accept",
        previousStatus: "pending",
        status: "accepted",
        category: "security",
        stateId: "NG-PL",
        lga: "Jos North",
        rejectionReason: null,
        reviewerId: "reviewer-01",
        notes: null,
        decidedAt: NOW.toISOString(),
      },
    });
  });

  it("requires explicit category and state when the priors are unresolved", () => {
    const unresolved = makeCandidate({ category: null, stateId: null, lga: null });

    const withoutState = buildReviewDecision(
      unresolved,
      { candidatePublicId: unresolved.publicId, action: "accept", reviewerId: "reviewer-01" },
      NOW,
    );
    expect(withoutState).toMatchObject({ ok: false, code: "missing_category" });

    const withoutCategory = buildReviewDecision(
      { ...unresolved, category: "security" },
      { candidatePublicId: unresolved.publicId, action: "accept", reviewerId: "reviewer-01" },
      NOW,
    );
    expect(withoutCategory).toMatchObject({ ok: false, code: "missing_state" });

    const corrected = buildReviewDecision(
      unresolved,
      {
        candidatePublicId: unresolved.publicId,
        action: "accept",
        reviewerId: "reviewer-01",
        category: "security",
        stateId: "NG-PL",
      },
      NOW,
    );
    expect(corrected).toMatchObject({
      ok: true,
      decision: { status: "accepted", category: "security", stateId: "NG-PL", lga: null },
    });
  });

  it("clears the deterministic LGA when the reviewer changes state", () => {
    const result = buildReviewDecision(
      makeCandidate(),
      {
        candidatePublicId: "cand-aaaaaaaaaaaaaaaaaaaaaaaa",
        action: "accept",
        reviewerId: "reviewer-01",
        stateId: "NG-KN",
      },
      NOW,
    );

    expect(result).toMatchObject({ ok: true, decision: { stateId: "NG-KN", lga: null } });
  });

  it("rejects unknown states and categories", () => {
    const candidate = makeCandidate();
    const badState = buildReviewDecision(
      candidate,
      {
        candidatePublicId: candidate.publicId,
        action: "accept",
        reviewerId: "reviewer-01",
        stateId: "NG-ZZ",
      },
      NOW,
    );
    expect(badState).toMatchObject({ ok: false, code: "unknown_state" });

    const badCategory = buildReviewDecision(
      candidate,
      {
        candidatePublicId: candidate.publicId,
        action: "accept",
        reviewerId: "reviewer-01",
        category: "foreign" as Category,
      },
      NOW,
    );
    expect(badCategory).toMatchObject({ ok: false, code: "unknown_category" });
  });

  it("requires a rationale for rejection and stores a stable reason code", () => {
    const candidate = makeCandidate();

    const missing = buildReviewDecision(
      candidate,
      { candidatePublicId: candidate.publicId, action: "reject", reviewerId: "reviewer-01" },
      NOW,
    );
    expect(missing).toMatchObject({ ok: false, code: "missing_notes" });

    const rejected = buildReviewDecision(
      candidate,
      {
        candidatePublicId: candidate.publicId,
        action: "reject",
        reviewerId: "reviewer-01",
        notes: "  Duplicate of an earlier report.  ",
      },
      NOW,
    );
    expect(rejected).toEqual({
      ok: true,
      decision: {
        action: "reject",
        previousStatus: "pending",
        status: "rejected",
        category: "security",
        stateId: "NG-PL",
        lga: "Jos North",
        rejectionReason: "reviewer_rejected",
        reviewerId: "reviewer-01",
        notes: "Duplicate of an earlier report.",
        decidedAt: NOW.toISOString(),
      },
    });
  });

  it("rejects invalid reviewer identifiers and overlong notes", () => {
    const candidate = makeCandidate();
    const noIdentity = buildReviewDecision(
      candidate,
      { candidatePublicId: candidate.publicId, action: "accept", reviewerId: "x" },
      NOW,
    );
    expect(noIdentity).toMatchObject({ ok: false, code: "invalid_reviewer" });

    const email = buildReviewDecision(
      candidate,
      { candidatePublicId: candidate.publicId, action: "accept", reviewerId: "person@example.com" },
      NOW,
    );
    expect(email).toMatchObject({ ok: false, code: "invalid_reviewer" });

    const longNotes = buildReviewDecision(
      candidate,
      {
        candidatePublicId: candidate.publicId,
        action: "reject",
        reviewerId: "reviewer-01",
        notes: "x".repeat(MAX_REVIEW_NOTES + 1),
      },
      NOW,
    );
    expect(longNotes).toMatchObject({ ok: false, code: "invalid_notes" });
  });

  it("refuses to decide an already accepted or rejected candidate", () => {
    const accepted = buildReviewDecision(
      makeCandidate({ status: "accepted" }),
      { candidatePublicId: "cand-aaaaaaaaaaaaaaaaaaaaaaaa", action: "reject", reviewerId: "reviewer-01", notes: "Changed my mind." },
      NOW,
    );
    expect(accepted).toMatchObject({ ok: false, code: "already_decided" });

    const rejected = buildReviewDecision(
      makeCandidate({ status: "rejected" }),
      { candidatePublicId: "cand-aaaaaaaaaaaaaaaaaaaaaaaa", action: "accept", reviewerId: "reviewer-01" },
      NOW,
    );
    expect(rejected).toMatchObject({ ok: false, code: "already_decided" });
  });
});
