// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MAX_PUBLICATION_RATIONALE,
  MIN_PUBLICATION_RATIONALE,
  PUBLICATION_RULE_VERSION,
  publicationSummary,
  publicationUncertainties,
  validatePublicationInput,
  type PublicationCandidateShape,
  type PublicationInput,
} from "@/lib/publication/rules";

function candidate(
  overrides: Partial<PublicationCandidateShape> = {},
): PublicationCandidateShape {
  return {
    publicId: "cand-0001",
    status: "accepted",
    category: "security",
    stateId: "NG-PL",
    title: "Gunmen abduct Plateau varsity student",
    excerpt: "Security sources said the student was later freed.",
    ...overrides,
  };
}

function input(overrides: Partial<PublicationInput> = {}): PublicationInput {
  return {
    candidatePublicId: "cand-0001",
    reviewerId: "Duty.Editor",
    severity: 3,
    severityRationale: "Reported abduction with a confirmed police response.",
    ...overrides,
  };
}

describe("publication input rules", () => {
  it("accepts a resolved, accepted candidate and normalises reviewer input", () => {
    const result = validatePublicationInput(candidate(), input());
    expect(result).toMatchObject({
      ok: true,
      reviewerId: "duty.editor",
      severity: 3,
      severityRationale: "Reported abduction with a confirmed police response.",
    });
    expect(PUBLICATION_RULE_VERSION).toMatch(/^nsm-publication-/);
  });

  it("rejects candidates that are not accepted", () => {
    for (const status of ["pending", "needs_review", "rejected"] as const) {
      expect(validatePublicationInput(candidate({ status }), input())).toMatchObject({
        ok: false,
        code: "not_accepted",
      });
    }
  });

  it("requires a resolved category, state and headline", () => {
    expect(validatePublicationInput(candidate({ category: null }), input())).toMatchObject({
      ok: false,
      code: "unresolved_category",
    });
    expect(validatePublicationInput(candidate({ stateId: null }), input())).toMatchObject({
      ok: false,
      code: "unresolved_state",
    });
    expect(validatePublicationInput(candidate({ title: "   " }), input())).toMatchObject({
      ok: false,
      code: "missing_title",
    });
  });

  it("validates the reviewer ID", () => {
    expect(validatePublicationInput(candidate(), input({ reviewerId: "X" }))).toMatchObject({
      ok: false,
      code: "invalid_reviewer",
    });
    expect(
      validatePublicationInput(candidate(), input({ reviewerId: "duty editor" })),
    ).toMatchObject({ ok: false, code: "invalid_reviewer" });
    expect(
      validatePublicationInput(candidate(), input({ reviewerId: "reviewer-01" })),
    ).toMatchObject({ ok: true, reviewerId: "reviewer-01" });
  });

  it("requires an integer severity from 1 to 5", () => {
    for (const severity of [0, 6, 2.5, Number.NaN]) {
      expect(validatePublicationInput(candidate(), input({ severity }))).toMatchObject({
        ok: false,
        code: "invalid_severity",
      });
    }
    for (const severity of [1, 2, 3, 4, 5]) {
      expect(validatePublicationInput(candidate(), input({ severity }))).toMatchObject({ ok: true });
    }
  });

  it("bounds and cleans the reviewer rationale", () => {
    expect(
      validatePublicationInput(candidate(), input({ severityRationale: "too short" })),
    ).toMatchObject({ ok: false, code: "invalid_rationale" });
    expect(
      validatePublicationInput(
        candidate(),
        input({ severityRationale: `x${"\u0000".repeat(20)}` }),
      ),
    ).toMatchObject({ ok: false, code: "invalid_rationale" });
    expect(
      validatePublicationInput(
        candidate(),
        input({ severityRationale: "x".repeat(MAX_PUBLICATION_RATIONALE + 1) }),
      ),
    ).toMatchObject({ ok: false, code: "invalid_rationale" });

    const padded = validatePublicationInput(
      candidate(),
      input({ severityRationale: `  ${"x".repeat(MIN_PUBLICATION_RATIONALE)}  ` }),
    );
    expect(padded).toMatchObject({ ok: true, severityRationale: "x".repeat(MIN_PUBLICATION_RATIONALE) });
  });

  it("uses the excerpt as the event summary and never invents content", () => {
    expect(publicationSummary("Headline", "Short excerpt", 100)).toBe("Short excerpt");
    expect(publicationSummary("Headline", "   ", 100)).toBe("Headline");
    expect(publicationSummary(" Headline ", "Ex\u0000cerpt ", 100)).toBe("Excerpt");
    // By default no publisher text is kept: the summary is the headline.
    expect(publicationSummary("Headline", "Short excerpt", 0)).toBe("Headline");
  });

  it("states that the marker is a centroid and verification is unassessed", () => {
    const withoutLga = publicationUncertainties(false);
    expect(withoutLga).toContain(
      "The map marker is a state-level centroid, not an incident location.",
    );
    expect(withoutLga[0]).toContain("verification has not been assessed");

    const withLga = publicationUncertainties(true);
    expect(withLga).toContain(
      "An LGA is reported, but the map marker is a state-level centroid, not an incident location.",
    );
  });
});
