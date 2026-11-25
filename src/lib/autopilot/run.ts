import {
  AUTOPILOT_ACTOR,
  deriveSeverity,
  evaluateCandidate,
  type AiProposalLite,
  type AutopilotConfig,
  type SkipReason,
} from "@/lib/autopilot/rules";
import type { ClusterQueueItem, ClusterReviewInput, ClusterReviewResult, ClusterScanResult } from "@/lib/clustering/types";
import type { PublicationInput } from "@/lib/publication/rules";
import type { PublicationResult, PublishableCandidate } from "@/lib/publication/types";
import type { ReviewCandidate, ReviewDecisionInput, ReviewQueueQuery, ReviewResult } from "@/lib/review/types";
import type { Category } from "@/lib/types";

/** The slice of each store the autopilot needs, so it can be tested without a database. */
export interface AutopilotDeps {
  review: {
    listReviewQueue(query: ReviewQueueQuery): Promise<ReviewCandidate[]>;
    decide(input: ReviewDecisionInput): Promise<ReviewResult>;
  };
  publication: {
    listPublishable(limit: number): Promise<PublishableCandidate[]>;
    publish(input: PublicationInput): Promise<PublicationResult>;
  };
  clusters: {
    scan(limit: number): Promise<ClusterScanResult>;
    listQueue(status: "pending", limit: number): Promise<ClusterQueueItem[]>;
    review(input: ClusterReviewInput): Promise<ClusterReviewResult>;
  };
  proposals: { latest(publicIds: string[]): Promise<Map<string, AiProposalLite>> };
}

export interface AutopilotSummary {
  enabled: boolean;
  considered: number;
  accepted: number;
  declined: Record<SkipReason, number>;
  published: number;
  /** Articles attached to an existing event instead of becoming a duplicate event. */
  attached: number;
  /** Stopped early because the time budget ran out; the rest wait for the next run. */
  timeBudgetReached: boolean;
  errors: string[];
}

export interface AutopilotOptions {
  config: AutopilotConfig;
  /** Absolute time (ms since epoch) after which no new work is started. */
  deadlineMs?: number;
  now?: () => number;
}

const MAX_ERRORS = 10;

function emptySummary(enabled: boolean): AutopilotSummary {
  return {
    enabled,
    considered: 0,
    accepted: 0,
    declined: { opinion: 0, unresolved: 0, low_confidence: 0, ai_disagrees: 0 },
    published: 0,
    attached: 0,
    timeBudgetReached: false,
    errors: [],
  };
}

/**
 * Hands-off pipeline: accept what passes the rules, decline what does not, then publish one article at a
 * time, checking for an existing event first. Order matters: if every article became its own event before
 * the duplicate check, one story from three outlets would appear three times.
 */
export async function runAutopilot(deps: AutopilotDeps, options: AutopilotOptions): Promise<AutopilotSummary> {
  const { config } = options;
  const summary = emptySummary(config.enabled);
  if (!config.enabled) return summary;
  const clock = options.now ?? Date.now;
  const outOfTime = () => options.deadlineMs !== undefined && clock() > options.deadlineMs;
  const note = (message: string) => {
    if (summary.errors.length < MAX_ERRORS) summary.errors.push(message);
  };

  // 1. Accept eligible candidates; decline the rest so they never crowd out newer ones.
  const open = await deps.review.listReviewQueue({ status: "open", limit: 100 });
  const proposals = await deps.proposals.latest(open.map((candidate) => candidate.publicId));
  for (const candidate of open) {
    if (summary.accepted >= config.maxPerRun) break;
    if (outOfTime()) {
      summary.timeBudgetReached = true;
      break;
    }
    summary.considered += 1;
    const decision = evaluateCandidate(
      {
        publicId: candidate.publicId,
        category: candidate.category,
        stateId: candidate.stateId,
        categoryConfidence: candidate.categoryConfidence,
        geoConfidence: candidate.geoConfidence,
        title: candidate.article.title,
        excerpt: candidate.article.excerpt,
      },
      proposals.get(candidate.publicId) ?? null,
      config,
    );
    if (decision.action === "skip") {
      const declined = await deps.review.decide({
        candidatePublicId: candidate.publicId,
        action: "reject",
        reviewerId: AUTOPILOT_ACTOR,
        notes: `Automatic decline (${decision.reason}): ${decision.detail}`,
      });
      if (declined.ok) summary.declined[decision.reason] += 1;
      else note(`${candidate.publicId}: decline failed (${declined.code})`);
      continue;
    }
    const accepted = await deps.review.decide({
      candidatePublicId: candidate.publicId,
      action: "accept",
      reviewerId: AUTOPILOT_ACTOR,
      notes: decision.notes,
      category: decision.category as Category,
      stateId: decision.stateId,
    });
    if (accepted.ok) summary.accepted += 1;
    else note(`${candidate.publicId}: accept failed (${accepted.code})`);
  }

  // 2. Publish one at a time, attaching duplicates to existing events first.
  const clusterRound = async () => {
    try {
      const scanned = await deps.clusters.scan(50);
      summary.attached += scanned.autoAttached;
      const queue = await deps.clusters.listQueue("pending", 100);
      for (const item of queue) {
        const result = await deps.clusters.review({
          clusterId: item.id,
          action: "accept",
          reviewerId: AUTOPILOT_ACTOR,
          notes: `Automatic attach: same category, state and 72-hour window as an existing event (similarity ${
            item.similarity === null ? "n/a" : item.similarity.toFixed(2)
          }). Not reviewed by a person.`,
        });
        if (result.ok) summary.attached += 1;
        else if (result.code !== "already_decided" && result.code !== "already_linked") note(`cluster ${item.id}: ${result.code}`);
      }
    } catch (error) {
      note(`cluster round failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  for (let i = 0; i < config.maxPerRun; i += 1) {
    if (outOfTime()) {
      summary.timeBudgetReached = true;
      break;
    }
    await clusterRound();
    const [next] = await deps.publication.listPublishable(1);
    if (!next) break;
    const { severity, reason } = deriveSeverity(next.title, next.excerpt, next.category as Category);
    const result = await deps.publication.publish({
      candidatePublicId: next.publicId,
      reviewerId: AUTOPILOT_ACTOR,
      severity,
      severityRationale: `Automatic: ${reason}. Software-assigned, capped at level 3, not assessed by a person.`,
    });
    if (result.ok) {
      summary.published += 1;
    } else {
      note(`${next.publicId}: publish failed (${result.code})`);
      // A candidate that cannot publish would be returned again and again; stop rather than spin.
      break;
    }
  }
  if (!summary.timeBudgetReached) await clusterRound();
  return summary;
}
