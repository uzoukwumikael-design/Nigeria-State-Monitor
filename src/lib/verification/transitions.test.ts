import { describe, expect, it } from "vitest";
import type { VerificationStatus } from "@/lib/types";
import {
  buildVerificationTransition,
  MAX_VERIFICATION_RATIONALE,
  summarizeVerificationEvidence,
  type VerificationContext,
  type VerificationEvidence,
  type VerificationResult,
  type VerificationTransitionInput,
} from "@/lib/verification";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const RATIONALE = "Reviewed the attached evidence and confirmed the transition.";

function evidence(overrides: Partial<VerificationEvidence> = {}): VerificationEvidence {
  return {
    publisher: "premium-times",
    independenceGroup: "premium-times",
    relationship: "primary",
    sourceType: "news",
    ...overrides,
  };
}

function context(
  status: VerificationStatus,
  entries: readonly VerificationEvidence[],
): VerificationContext {
  return { eventPublicId: "evt-test-001", status, evidence: entries };
}

function input(
  overrides: Partial<VerificationTransitionInput> = {},
): VerificationTransitionInput {
  return {
    target: "single_source",
    reviewerId: "reviewer-01",
    rationale: RATIONALE,
    ...overrides,
  };
}

function expectOk(result: VerificationResult) {
  if (!result.ok) throw new Error(result.message);
  return result.transition;
}

describe("verification evidence summary", () => {
  it("counts one publisher once even when it has several articles", () => {
    const summary = summarizeVerificationEvidence([
      evidence({ publisher: "Premium Times", independenceGroup: "premium-times" }),
      evidence({
        publisher: "premium-times",
        independenceGroup: "a-different-group",
        relationship: "supporting",
      }),
    ]);

    expect(summary.supporting).toBe(2);
    expect(summary.independentGroups).toBe(1);
  });

  it("counts syndicated publishers as one independence group", () => {
    const summary = summarizeVerificationEvidence([
      evidence({ publisher: "daily-trust", independenceGroup: "wire-service" }),
      evidence({ publisher: "the-guardian-ng", independenceGroup: "wire-service" }),
    ]);

    expect(summary.independentGroups).toBe(1);
  });

  it("ignores background evidence and counts retractions separately", () => {
    const summary = summarizeVerificationEvidence([
      evidence(),
      evidence({ publisher: "background-desk", relationship: "background" }),
      evidence({ publisher: "retracting-desk", relationship: "retracted" }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.supporting).toBe(1);
    expect(summary.background).toBe(1);
    expect(summary.retracted).toBe(1);
    expect(summary.independentGroups).toBe(1);
  });

  it("requires conflicts from distinct groups to be credible", () => {
    const samePublisher = summarizeVerificationEvidence([
      evidence({ publisher: "premium-times", independenceGroup: "premium-times" }),
      evidence({
        publisher: "premium-times",
        independenceGroup: "premium-times",
        relationship: "conflicting",
      }),
    ]);
    expect(samePublisher.conflictGroups).toBe(1);
    expect(samePublisher.credibleConflict).toBe(false);

    const distinctPublisher = summarizeVerificationEvidence([
      evidence({ publisher: "premium-times", independenceGroup: "premium-times" }),
      evidence({
        publisher: "daily-trust",
        independenceGroup: "daily-trust",
        relationship: "conflicting",
      }),
    ]);
    expect(distinctPublisher.conflictGroups).toBe(1);
    expect(distinctPublisher.credibleConflict).toBe(true);
  });
});

describe("verification state machine", () => {
  it("moves an unassessed event to single source", () => {
    const transition = expectOk(
      buildVerificationTransition(
        context("unassessed", [evidence()]),
        input({ target: "single_source" }),
        NOW,
      ),
    );

    expect(transition.previousStatus).toBe("unassessed");
    expect(transition.status).toBe("single_source");
    expect(transition.reviewerId).toBe("reviewer-01");
    expect(transition.decidedAt).toBe(NOW.toISOString());
    expect(transition.evidence.independentGroups).toBe(1);
    expect(transition.description).toBe(
      "Verification status changed from unassessed to single_source: 1 independent source group.",
    );
  });

  it("moves an unassessed event to multiple sources with two groups", () => {
    const transition = expectOk(
      buildVerificationTransition(
        context("unassessed", [
          evidence(),
          evidence({ publisher: "daily-trust", independenceGroup: "daily-trust" }),
        ]),
        input({ target: "multiple_sources" }),
        NOW,
      ),
    );

    expect(transition.status).toBe("multiple_sources");
    expect(transition.evidence.independentGroups).toBe(2);
  });

  it("refuses multiple sources when only one publisher is represented", () => {
    const result = buildVerificationTransition(
      context("unassessed", [
        evidence(),
        evidence({ independenceGroup: "a-second-group-from-the-same-publisher" }),
      ]),
      input({ target: "multiple_sources" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("refuses multiple sources for a syndicated copy", () => {
    const result = buildVerificationTransition(
      context("unassessed", [
        evidence({ publisher: "daily-trust", independenceGroup: "wire-service" }),
        evidence({ publisher: "the-guardian-ng", independenceGroup: "wire-service" }),
      ]),
      input({ target: "multiple_sources" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("marks credible conflicting reports as disputed", () => {
    const transition = expectOk(
      buildVerificationTransition(
        context("multiple_sources", [
          evidence(),
          evidence({
            publisher: "daily-trust",
            independenceGroup: "daily-trust",
            relationship: "conflicting",
          }),
        ]),
        input({ target: "disputed" }),
        NOW,
      ),
    );

    expect(transition.status).toBe("disputed");
    expect(transition.evidence.conflictGroups).toBe(1);
    expect(transition.evidence.credibleConflict).toBe(true);
  });

  it("does not treat a publisher contradicting itself as credible conflict", () => {
    const result = buildVerificationTransition(
      context("unassessed", [
        evidence(),
        evidence({ relationship: "conflicting" }),
      ]),
      input({ target: "disputed" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("allows official confirmation from an official source group", () => {
    const transition = expectOk(
      buildVerificationTransition(
        context("single_source", [
          evidence(),
          evidence({
            publisher: "federal-ministry",
            independenceGroup: "federal-ministry",
            relationship: "supporting",
            sourceType: "official",
          }),
        ]),
        input({ target: "official_confirmation" }),
        NOW,
      ),
    );

    expect(transition.status).toBe("official_confirmation");
    expect(transition.evidence.officialGroups).toBe(1);
  });

  it("refuses official confirmation without an official source group", () => {
    const result = buildVerificationTransition(
      context("multiple_sources", [
        evidence(),
        evidence({ publisher: "daily-trust", independenceGroup: "daily-trust" }),
      ]),
      input({ target: "official_confirmation" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("refuses official confirmation when the official source is conflicting", () => {
    const result = buildVerificationTransition(
      context("single_source", [
        evidence(),
        evidence({
          publisher: "federal-ministry",
          independenceGroup: "federal-ministry",
          relationship: "conflicting",
          sourceType: "official",
        }),
      ]),
      input({ target: "official_confirmation" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("requires explicit reviewer approval for corroboration", () => {
    const evidenceSet = [
      evidence(),
      evidence({ publisher: "daily-trust", independenceGroup: "daily-trust" }),
    ];

    expect(
      buildVerificationTransition(
        context("multiple_sources", evidenceSet),
        input({ target: "corroborated" }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: "corroboration_approval_required" });

    const transition = expectOk(
      buildVerificationTransition(
        context("multiple_sources", evidenceSet),
        input({ target: "corroborated", approveCorroboration: true }),
        NOW,
      ),
    );
    expect(transition.status).toBe("corroborated");
  });

  it("refuses corroboration when fewer than two independent groups exist", () => {
    const result = buildVerificationTransition(
      context("multiple_sources", [evidence()]),
      input({ target: "corroborated", approveCorroboration: true }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("refuses corroboration with conflicting evidence", () => {
    const result = buildVerificationTransition(
      context("multiple_sources", [
        evidence(),
        evidence({
          publisher: "daily-trust",
          independenceGroup: "daily-trust",
          relationship: "conflicting",
        }),
      ]),
      input({ target: "corroborated", approveCorroboration: true }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "conflicting_evidence" });
  });

  it("retracts an event only when a retraction is recorded, then stays terminal", () => {
    const transition = expectOk(
      buildVerificationTransition(
        context("multiple_sources", [
          evidence({ relationship: "retracted" }),
          evidence({ publisher: "daily-trust", independenceGroup: "daily-trust" }),
        ]),
        input({ target: "retracted" }),
        NOW,
      ),
    );
    expect(transition.status).toBe("retracted");
    expect(transition.evidence.retracted).toBe(1);

    const terminal = buildVerificationTransition(
      context("retracted", [evidence({ relationship: "retracted" })]),
      input({ target: "disputed" }),
      NOW,
    );
    expect(terminal).toMatchObject({ ok: false, code: "terminal_retracted" });
  });

  it("refuses retraction without retraction evidence", () => {
    const result = buildVerificationTransition(
      context("multiple_sources", [
        evidence(),
        evidence({ publisher: "daily-trust", independenceGroup: "daily-trust" }),
      ]),
      input({ target: "retracted" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("refuses a no-change transition", () => {
    const result = buildVerificationTransition(
      context("single_source", [evidence()]),
      input({ target: "single_source" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "no_change" });
  });

  it("refuses transitions that skip or reverse the state machine", () => {
    expect(
      buildVerificationTransition(
        context("single_source", [
          evidence(),
          evidence({ publisher: "daily-trust", independenceGroup: "daily-trust" }),
        ]),
        input({ target: "corroborated", approveCorroboration: true }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: "invalid_transition" });

    expect(
      buildVerificationTransition(
        context("official_confirmation", [evidence()]),
        input({ target: "multiple_sources" }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: "invalid_transition" });

    expect(
      buildVerificationTransition(
        context("disputed", [evidence()]),
        input({ target: "multiple_sources" }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: "invalid_transition" });
  });

  it("refuses unassessed as a target", () => {
    const result = buildVerificationTransition(
      context("single_source", [evidence()]),
      input({ target: "unassessed" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_transition" });
  });

  it("ignores background evidence when proposing a status", () => {
    const result = buildVerificationTransition(
      context("unassessed", [evidence({ relationship: "background" })]),
      input({ target: "single_source" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "insufficient_evidence" });
  });

  it("requires a stable reviewer ID", () => {
    const result = buildVerificationTransition(
      context("unassessed", [evidence()]),
      input({ reviewerId: "x" }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_reviewer" });
  });

  it("requires a bounded rationale and strips control characters", () => {
    expect(
      buildVerificationTransition(
        context("unassessed", [evidence()]),
        input({ rationale: "too short" }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: "invalid_rationale" });

    expect(
      buildVerificationTransition(
        context("unassessed", [evidence()]),
        input({ rationale: "x".repeat(MAX_VERIFICATION_RATIONALE + 1) }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: "invalid_rationale" });

    const transition = expectOk(
      buildVerificationTransition(
        context("unassessed", [evidence()]),
        input({ rationale: `\u0007${RATIONALE}\u0007` }),
        NOW,
      ),
    );
    expect(transition.rationale).toBe(RATIONALE);
  });

  it("does not mutate the context or evidence", () => {
    const evidenceSet = [evidence(), evidence({ publisher: "daily-trust", independenceGroup: "daily-trust" })];
    const before = JSON.stringify(evidenceSet);
    const ctx = context("multiple_sources", evidenceSet);

    buildVerificationTransition(ctx, input({ target: "corroborated", approveCorroboration: true }), NOW);

    expect(JSON.stringify(evidenceSet)).toBe(before);
    expect(ctx.status).toBe("multiple_sources");
  });
});
