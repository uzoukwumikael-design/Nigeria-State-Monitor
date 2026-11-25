import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { buildReviewDecision } from "@/lib/review/decide";
import type {
  ReviewCandidate,
  ReviewCandidateStatus,
  ReviewDecisionInput,
  ReviewQueueQuery,
  ReviewResult,
} from "@/lib/review/types";
import type { Category } from "@/lib/types";

interface ReviewRow {
  id: string;
  public_id: string;
  status: string;
  category: string | null;
  state_id: string | null;
  lga: string | null;
  category_confidence: unknown;
  geo_confidence: unknown;
  reasons: unknown;
  rule_version: string;
  created_at: unknown;
  reviewed_at: unknown;
  reviewed_by: string | null;
  article_id: string;
  article_public_id: string;
  original_title: string;
  canonical_url: string | null;
  excerpt: string | null;
  published_at: unknown;
  retrieved_at: unknown;
  source_slug: string;
  source_name: string;
  attribution: string | null;
}

const CANDIDATE_SELECT = `select
    c.id,
    c.public_id,
    c.status,
    c.category,
    c.state_id,
    c.lga,
    c.category_confidence,
    c.geo_confidence,
    c.reasons,
    c.rule_version,
    c.created_at,
    c.reviewed_at,
    c.reviewed_by,
    a.id as article_id,
    a.public_id as article_public_id,
    a.original_title,
    a.canonical_url,
    a.excerpt,
    a.published_at,
    a.retrieved_at,
    s.slug as source_slug,
    s.name as source_name,
    s.attribution
  from ingestion_candidates c
  join articles a on a.id = c.article_id
  join sources s on s.id = c.source_id`;

function iso(value: unknown, field: string): string | null {
  if (value == null) return null;
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${field} value in the review queue.`);
  }
  return parsed.toISOString();
}

function requireIso(value: unknown, field: string): string {
  const result = iso(value, field);
  if (!result) throw new Error(`Missing ${field} in the review queue.`);
  return result;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reasonsValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function mapCandidate(row: ReviewRow): ReviewCandidate {
  return {
    id: row.id,
    publicId: row.public_id,
    status: row.status as ReviewCandidateStatus,
    category: row.category as Category | null,
    stateId: row.state_id,
    lga: row.lga,
    categoryConfidence: numberValue(row.category_confidence),
    geoConfidence: numberValue(row.geo_confidence),
    reasons: reasonsValue(row.reasons),
    ruleVersion: row.rule_version,
    createdAt: requireIso(row.created_at, "created_at"),
    reviewedAt: iso(row.reviewed_at, "reviewed_at"),
    reviewedBy: row.reviewed_by,
    article: {
      publicId: row.article_public_id,
      title: row.original_title,
      url: row.canonical_url ?? "",
      excerpt: row.excerpt ?? "",
      publishedAt: iso(row.published_at, "published_at"),
      retrievedAt: requireIso(row.retrieved_at, "retrieved_at"),
      sourceSlug: row.source_slug,
      sourceName: row.source_name,
      attribution: row.attribution ?? "",
    },
  };
}

/**
 * Reviewer-side persistence. Listing and deciding both read only the evidence
 * queue; no method inserts or updates an event.
 */
export class PostgresReviewStore {
  constructor(private readonly driver: DatabaseDriver) {}

  async listReviewQueue(query: ReviewQueueQuery = {}): Promise<ReviewCandidate[]> {
    const filter = query.status ?? "open";
    const openOnly = filter === "open";
    const status = openOnly ? null : filter;
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const result = await this.driver.query<ReviewRow>(
      `${CANDIDATE_SELECT}
       where ($1::text is null or c.status = $1)
         and (not $2::boolean or c.status in ('pending', 'needs_review'))
       order by
         case c.status
           when 'needs_review' then 0
           when 'pending' then 1
           else 2
         end,
         c.created_at desc
       limit $3`,
      [status, openOnly, limit],
    );
    return result.rows.map(mapCandidate);
  }

  async decide(input: ReviewDecisionInput): Promise<ReviewResult> {
    return this.driver.transaction(async (tx) => {
      const found = await tx.query<ReviewRow>(
        `${CANDIDATE_SELECT} where c.public_id = $1 limit 1`,
        [input.candidatePublicId],
      );
      const row = found.rows[0];
      if (!row) {
        return {
          ok: false,
          code: "not_found",
          message: `No review candidate with public ID ${input.candidatePublicId}.`,
        };
      }

      const candidate = mapCandidate(row);
      const validation = buildReviewDecision(candidate, input, new Date());
      if (!validation.ok) return validation;
      const { decision } = validation;

      const updated = await tx.query<{ id: string }>(
        `update ingestion_candidates
         set status = $2,
             category = $3,
             state_id = $4,
             lga = $5,
             rejection_reason = $6,
             reviewed_at = $7,
             reviewed_by = $8
         where id = $1 and status = $9
         returning id`,
        [
          candidate.id,
          decision.status,
          decision.category,
          decision.stateId,
          decision.lga,
          decision.rejectionReason,
          decision.decidedAt,
          decision.reviewerId,
          candidate.status,
        ],
      );
      if (!updated.rows[0]) {
        return {
          ok: false,
          code: "already_decided",
          message: `Candidate ${candidate.publicId} changed status before this decision was applied.`,
        };
      }

      const audit = await tx.query<{ id: string }>(
        `insert into candidate_reviews (
           candidate_id, article_id, reviewer_id, action,
           previous_status, new_status, previous_category, previous_state_id,
           category, state_id, notes, created_at
         ) values (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12
         )
         returning id`,
        [
          candidate.id,
          row.article_id,
          decision.reviewerId,
          decision.action,
          decision.previousStatus,
          decision.status,
          candidate.category,
          candidate.stateId,
          decision.category,
          decision.stateId,
          decision.notes,
          decision.decidedAt,
        ],
      );
      const reviewId = audit.rows[0]?.id;
      if (!reviewId) throw new Error("Reviewer audit insert returned no row.");

      return {
        ok: true,
        reviewId,
        candidate: {
          ...candidate,
          status: decision.status,
          category: decision.category,
          stateId: decision.stateId,
          lga: decision.lga,
          reviewedAt: decision.decidedAt,
          reviewedBy: decision.reviewerId,
        },
      };
    });
  }
}
