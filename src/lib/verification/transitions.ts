import { REVIEWER_ID_PATTERN } from "@/lib/review/decide";
import { VERIFICATION_STATUSES, type VerificationStatus } from "@/lib/types";
import {
  ALLOWED_VERIFICATION_TRANSITIONS,
  MAX_VERIFICATION_RATIONALE,
  MIN_VERIFICATION_RATIONALE,
  VERIFICATION_RULE_VERSION,
  type VerificationContext,
  type VerificationErrorCode,
  type VerificationEvidence,
  type VerificationEvidenceSummary,
  type VerificationResult,
  type VerificationTransition,
  type VerificationTransitionInput,
} from "./types";

function failure(code: VerificationErrorCode, message: string): VerificationResult {
  return { ok: false, code, message };
}

function normalizeRationale(
  raw: string,
): { ok: true; value: string } | { ok: false; code: VerificationErrorCode; message: string } {
  const value = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (value.length < MIN_VERIFICATION_RATIONALE) {
    return {
      ok: false,
      code: "invalid_rationale",
      message: `A verification rationale of at least ${MIN_VERIFICATION_RATIONALE} characters is required.`,
    };
  }
  if (value.length > MAX_VERIFICATION_RATIONALE) {
    return {
      ok: false,
      code: "invalid_rationale",
      message: `A verification rationale must be ${MAX_VERIFICATION_RATIONALE} characters or fewer.`,
    };
  }
  return { ok: true, value };
}

function knownStatus(value: string): value is VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Counts distinct evidence groups after collapsing every publisher to one
 * group. This prevents two articles from one publisher, or two publishers in a
 * shared syndication group, from being counted as independent corroboration.
 */
function effectiveGroups(entries: readonly VerificationEvidence[]): number {
  const groupByPublisher = new Map<string, string>();
  for (const entry of entries) {
    const publisherKey = normalizeKey(entry.publisher);
    const suppliedGroup = normalizeKey(entry.independenceGroup);
    const effectivePublisher = publisherKey || `group:${suppliedGroup}`;
    const effectiveGroup = suppliedGroup || effectivePublisher;
    if (!effectivePublisher || !effectiveGroup) continue;
    if (!groupByPublisher.has(effectivePublisher)) {
      groupByPublisher.set(effectivePublisher, effectiveGroup);
    }
  }
  return new Set(groupByPublisher.values()).size;
}

export function summarizeVerificationEvidence(
  evidence: readonly VerificationEvidence[],
): VerificationEvidenceSummary {
  let supporting = 0;
  let conflicting = 0;
  let retracted = 0;
  let background = 0;
  const supportingEntries: VerificationEvidence[] = [];
  const conflictingEntries: VerificationEvidence[] = [];

  for (const entry of evidence) {
    switch (entry.relationship) {
      case "primary":
      case "supporting":
        supporting += 1;
        supportingEntries.push(entry);
        break;
      case "conflicting":
        conflicting += 1;
        conflictingEntries.push(entry);
        break;
      case "retracted":
        retracted += 1;
        break;
      case "background":
        background += 1;
        break;
    }
  }

  const officialEntries = supportingEntries.filter((entry) => entry.sourceType === "official");
  const conflictGroups = effectiveGroups(conflictingEntries);
  const contestedGroups = effectiveGroups([...supportingEntries, ...conflictingEntries]);

  return {
    total: evidence.length,
    supporting,
    conflicting,
    retracted,
    background,
    official: officialEntries.length,
    independentGroups: effectiveGroups(supportingEntries),
    conflictGroups,
    officialGroups: effectiveGroups(officialEntries),
    credibleConflict: conflictGroups > 0 && contestedGroups >= 2,
  };
}

function describe(
  previous: VerificationStatus,
  target: VerificationStatus,
  evidence: VerificationEvidenceSummary,
): string {
  const groups = `${evidence.independentGroups} independent source group${
    evidence.independentGroups === 1 ? "" : "s"
  }`;
  const conflicts =
    evidence.conflicting > 0
      ? `, ${evidence.conflicting} conflicting report${evidence.conflicting === 1 ? "" : "s"}`
      : "";
  return `Verification status changed from ${previous} to ${target}: ${groups}${conflicts}.`;
}

function evidenceFailure(
  target: VerificationStatus,
  evidence: VerificationEvidenceSummary,
  input: VerificationTransitionInput,
): VerificationResult | null {
  switch (target) {
    case "single_source":
      if (evidence.conflicting > 0) {
        return failure(
          "conflicting_evidence",
          "A single-source status cannot be set while conflicting evidence is attached.",
        );
      }
      if (evidence.independentGroups !== 1) {
        return failure(
          "insufficient_evidence",
          `Single-source status requires exactly one independent group; found ${evidence.independentGroups}.`,
        );
      }
      return null;

    case "multiple_sources":
      if (evidence.conflicting > 0) {
        return failure(
          "conflicting_evidence",
          "Multiple-source status cannot be set while conflicting evidence is attached; use disputed.",
        );
      }
      if (evidence.independentGroups < 2) {
        return failure(
          "insufficient_evidence",
          `Multiple-source status requires at least two independent groups; found ${evidence.independentGroups}.`,
        );
      }
      return null;

    case "corroborated":
      if (evidence.conflicting > 0) {
        return failure(
          "conflicting_evidence",
          "Corroboration cannot be set while conflicting evidence is attached.",
        );
      }
      if (evidence.independentGroups < 2) {
        return failure(
          "insufficient_evidence",
          `Corroboration requires at least two independent groups; found ${evidence.independentGroups}.`,
        );
      }
      if (input.approveCorroboration !== true) {
        return failure(
          "corroboration_approval_required",
          "Corroboration requires an explicit reviewer approval flag.",
        );
      }
      return null;

    case "official_confirmation":
      if (evidence.officialGroups < 1) {
        return failure(
          "insufficient_evidence",
          "Official confirmation requires at least one official source group.",
        );
      }
      return null;

    case "disputed":
      if (!evidence.credibleConflict) {
        return failure(
          "insufficient_evidence",
          "Disputed status requires conflicting reports from at least two independent groups.",
        );
      }
      return null;

    case "retracted":
      if (evidence.retracted < 1) {
        return failure(
          "insufficient_evidence",
          "Retraction requires at least one source relationship marked retracted.",
        );
      }
      return null;

    case "unassessed":
      return failure("invalid_transition", "An event cannot be returned to unassessed.");
  }
}

/**
 * Validates a reviewer-approved verification transition without touching the
 * database. Evidence only proposes a state; this function never creates,
 * edits or publishes an event by itself.
 */
export function buildVerificationTransition(
  context: VerificationContext,
  input: VerificationTransitionInput,
  now: Date,
): VerificationResult {
  const reviewerId = input.reviewerId.trim().toLowerCase();
  if (!REVIEWER_ID_PATTERN.test(reviewerId)) {
    return failure(
      "invalid_reviewer",
      "Reviewer ID must be 3–64 characters: lowercase letters, digits, dots, underscores or hyphens.",
    );
  }

  const rationale = normalizeRationale(input.rationale);
  if (!rationale.ok) return failure(rationale.code, rationale.message);

  if (!knownStatus(input.target)) {
    return failure("unknown_status", `Unknown verification status: ${String(input.target)}.`);
  }

  if (input.target === context.status) {
    return failure(
      "no_change",
      `Event ${context.eventPublicId} is already ${context.status}.`,
    );
  }
  if (context.status === "retracted") {
    return failure(
      "terminal_retracted",
      `Event ${context.eventPublicId} is retracted; retraction is terminal.`,
    );
  }
  if (!ALLOWED_VERIFICATION_TRANSITIONS[context.status].includes(input.target)) {
    return failure(
      "invalid_transition",
      `Cannot move event ${context.eventPublicId} from ${context.status} to ${input.target}.`,
    );
  }

  const evidence = summarizeVerificationEvidence(context.evidence);
  const refusal = evidenceFailure(input.target, evidence, input);
  if (refusal) return refusal;

  const transition: VerificationTransition = {
    ruleVersion: VERIFICATION_RULE_VERSION,
    eventPublicId: context.eventPublicId,
    previousStatus: context.status,
    status: input.target,
    reviewerId,
    rationale: rationale.value,
    decidedAt: now.toISOString(),
    evidence,
    description: describe(context.status, input.target, evidence),
  };

  return { ok: true, transition };
}
