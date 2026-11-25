import { createHash, randomUUID } from "node:crypto";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { REVIEWER_ID_PATTERN } from "@/lib/review/decide";
import { assessClusterPair } from "@/lib/clustering/assess";
import type {
  ClusterAssessment,
  ClusterQueueItem,
  ClusterQueueStatus,
  ClusterReviewInput,
  ClusterReviewResult,
  ClusterScanResult,
  ClusterStoreErrorCode,
} from "@/lib/clustering/types";
import type { Category } from "@/lib/types";

const MIN_CLUSTER_NOTES = 10;
const MAX_CLUSTER_NOTES = 1_000;

interface CandidateRow {
  id: string;
  public_id: string;
  category: string | null;
  state_id: string | null;
  lga: string | null;
  article_id: string;
  article_public_id: string;
  original_title: string;
  canonical_url: string | null;
  excerpt: string | null;
  published_at: unknown;
  source_id: string;
  source_slug: string;
  source_name: string;
  independence_group: string;
}

interface EventRow {
  id: string;
  public_id: string;
  title: string;
  summary: string;
  category: string | null;
  state_id: string | null;
  lga: string | null;
  first_reported_at: unknown;
  source_slug: string;
  independence_group: string;
  article_id: string;
  source_published_at: unknown;
}

interface QueueRow {
  id: string;
  cluster_reference: string;
  decision: string;
  similarity: unknown;
  reasons: unknown;
  rule_version: string | null;
  created_at: unknown;
  reviewed_at: unknown;
  reviewed_by: string | null;
  candidate_public_id: string;
  candidate_title: string;
  candidate_excerpt: string | null;
  candidate_url: string | null;
  candidate_category: string;
  candidate_state_id: string;
  candidate_lga: string | null;
  candidate_published_at: unknown;
  source_slug: string;
  source_name: string;
  event_public_id: string;
  event_title: string;
  event_category: string;
  event_state_id: string;
  event_first_reported_at: unknown;
}

interface ClusterForReviewRow {
  id: string;
  decision: string;
  event_id: string;
  event_public_id: string;
  event_published: boolean;
  event_is_demo: boolean;
  article_id: string;
  candidate_id: string;
  candidate_status: string;
  source_id: string;
  independence_group: string;
}

function iso(value: unknown, label: string): string {
  if (value == null) throw new Error(`Missing ${label}.`);
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label}.`);
  return parsed.toISOString();
}

function nullableIso(value: unknown, label: string): string | null {
  return value == null ? null : iso(value, label);
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}

function clusterReference(candidatePublicId: string, eventPublicId: string): string {
  return `clu-${createHash("sha256")
    .update(`${candidatePublicId}|${eventPublicId}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function evidenceSourcePublicId(eventPublicId: string, articlePublicId: string): string {
  return `esrc-${createHash("sha256")
    .update(`${eventPublicId}|${articlePublicId}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function rank(decision: ClusterAssessment["decision"]): number {
  if (decision === "auto_attach") return 2;
  if (decision === "review") return 1;
  return 0;
}

function cleanNotes(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function failure(code: ClusterStoreErrorCode, message: string): ClusterReviewResult {
  return { ok: false, code, message };
}

/**
 * Clustering persistence and review. Hard gates and scoring live in the pure
 * `assessClusterPair`; this store only records the assessment and, for an
 * accepted or automatically safe pair, attaches the candidate article as
 * supporting evidence. It never creates an event or publishes anything.
 */
export class PostgresClusterStore {
  constructor(private readonly driver: DatabaseDriver) {}

  async scan(limit = 50): Promise<ClusterScanResult> {
    const cap = Math.min(Math.max(limit, 1), 200);
    const [candidateResult, eventResult] = await Promise.all([
      this.driver.query<CandidateRow>(
        `select c.id, c.public_id, c.category, c.state_id, c.lga,
                a.id as article_id, a.public_id as article_public_id,
                a.original_title, a.canonical_url, a.excerpt, a.published_at,
                c.source_id, s.slug as source_slug, s.name as source_name, s.independence_group
         from ingestion_candidates c
         join articles a on a.id = c.article_id
         join sources s on s.id = c.source_id
         where c.status = 'accepted'
           and a.is_demo = false and s.is_demo = false
           and not exists (
             select 1 from candidate_event_links l where l.candidate_id = c.id
           )
         order by c.reviewed_at asc nulls last, c.created_at asc
         limit $1`,
        [cap],
      ),
      this.driver.query<EventRow>(
        `select e.id, e.public_id, e.title, e.summary, e.category, e.state_id, e.lga,
                e.first_reported_at,
                src.slug as source_slug, src.independence_group,
                src.article_id, src.source_published_at
         from events e
         join lateral (
           select s.slug, es.independence_group, a.id as article_id, a.published_at as source_published_at
           from event_sources es
           join articles a on a.id = es.article_id
           join sources s on s.id = a.source_id
           where es.event_id = e.id and a.is_demo = false and s.is_demo = false
           order by
             case es.relationship
               when 'primary' then 0
               when 'supporting' then 1
               else 2
             end,
             es.added_at,
             es.public_id
           limit 1
         ) src on true
         where e.published = true
           and e.is_demo = false
           and e.category is not null
           and e.state_id is not null
         order by e.last_updated_at desc
         limit 250`,
      ),
    ]);

    let comparedEvents = 0;
    let queuedForReview = 0;
    let autoAttached = 0;
    let skipped = 0;

    for (const candidate of candidateResult.rows) {
      if (
        !candidate.category ||
        !candidate.state_id ||
        !candidate.article_id
      ) {
        skipped += 1;
        continue;
      }
      const candidateRecord = {
        id: candidate.public_id,
        title: candidate.original_title,
        excerpt: candidate.excerpt,
        category: candidate.category as Category,
        stateId: candidate.state_id,
        lga: candidate.lga,
        publishedAt: nullableIso(candidate.published_at, "candidate publication time"),
        publisher: candidate.source_slug,
        independenceGroup: candidate.independence_group,
      };

      let best: { assessment: ClusterAssessment; event: EventRow } | null = null;
      for (const event of eventResult.rows) {
        comparedEvents += 1;
        const assessment = assessClusterPair(candidateRecord, {
          id: event.public_id,
          title: event.title,
          excerpt: event.summary,
          category: event.category as Category,
          stateId: event.state_id as string,
          lga: event.lga,
          publishedAt: nullableIso(
            event.source_published_at ?? event.first_reported_at,
            "event report time",
          ),
          publisher: event.source_slug,
          independenceGroup: event.independence_group,
        });
        if (assessment.decision === "no_match") continue;
        if (!best) {
          best = { assessment, event };
          continue;
        }
        const currentRank = rank(assessment.decision);
        const bestRank = rank(best.assessment.decision);
        if (
          currentRank > bestRank ||
          (currentRank === bestRank &&
            (assessment.similarity ?? -1) > (best.assessment.similarity ?? -1))
        ) {
          best = { assessment, event };
        }
      }

      if (!best) continue;

      if (best.assessment.decision === "auto_attach") {
        const attached = await this.autoAttach(candidate, best.event, best.assessment);
        if (attached) autoAttached += 1;
        else skipped += 1;
      } else {
        const queued = await this.queueForReview(candidate, best.event, best.assessment);
        if (queued) queuedForReview += 1;
        else skipped += 1;
      }
    }

    return {
      scannedCandidates: candidateResult.rows.length,
      comparedEvents,
      queuedForReview,
      autoAttached,
      skipped,
    };
  }

  private async queueForReview(
    candidate: CandidateRow,
    event: EventRow,
    assessment: ClusterAssessment,
  ): Promise<boolean> {
    return this.driver.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(
        "select id from candidate_event_links where candidate_id = $1 or article_id = $2 limit 1",
        [candidate.id, candidate.article_id],
      );
      if (existing.rows[0]) return false;
      const inserted = await tx.query<{ id: string }>(
        `insert into event_clusters (
           cluster_reference, event_id, article_id, clustering_method,
           similarity, confidence, decision, reasons, score_components, rule_version
         ) values (
           $1, $2, $3, 'deterministic',
           $4, $5, 'pending', $6::jsonb, $7::jsonb, $8
         )
         on conflict do nothing
         returning id`,
        [
          clusterReference(candidate.public_id, event.public_id),
          event.id,
          candidate.article_id,
          assessment.similarity,
          assessment.similarity,
          JSON.stringify(assessment.reasons),
          assessment.components ? JSON.stringify(assessment.components) : null,
          assessment.scoreVersion,
        ],
      );
      return Boolean(inserted.rows[0]);
    });
  }

  private async autoAttach(
    candidate: CandidateRow,
    event: EventRow,
    assessment: ClusterAssessment,
  ): Promise<boolean> {
    return this.driver.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(
        "select id from candidate_event_links where candidate_id = $1 or article_id = $2 limit 1",
        [candidate.id, candidate.article_id],
      );
      if (existing.rows[0]) return false;
      const attached = await tx.query<{ id: string }>(
        `select id from event_sources where event_id = $1 and article_id = $2 limit 1`,
        [event.id, candidate.article_id],
      );
      if (attached.rows[0]) return false;

      const now = new Date().toISOString();
      const cluster = await tx.query<{ id: string }>(
        `insert into event_clusters (
           cluster_reference, event_id, article_id, clustering_method,
           similarity, confidence, decision, reviewed_by, reviewed_at,
           reasons, score_components, rule_version, created_at
         ) values (
           $1, $2, $3, 'deterministic',
           $4, $5, 'accepted', 'system.auto-cluster', $6,
           $7::jsonb, $8::jsonb, $9, $6
         )
         on conflict do nothing
         returning id`,
        [
          clusterReference(candidate.public_id, event.public_id),
          event.id,
          candidate.article_id,
          assessment.similarity,
          assessment.similarity,
          now,
          JSON.stringify(assessment.reasons),
          assessment.components ? JSON.stringify(assessment.components) : null,
          assessment.scoreVersion,
        ],
      );
      const clusterId = cluster.rows[0]?.id;
      if (!clusterId) return false;

      const source = await tx.query<{ id: string }>(
        `insert into event_sources (
           public_id, event_id, article_id, relationship, independence_group, added_at
         ) values ($1, $2, $3, 'supporting', $4, $5)
         on conflict (event_id, article_id) do nothing
         returning id`,
        [
          evidenceSourcePublicId(event.public_id, candidate.article_public_id),
          event.id,
          candidate.article_id,
          candidate.independence_group,
          now,
        ],
      );
      if (!source.rows[0]) throw new Error("Auto-attach source insert conflicted.");

      await tx.query(
        `insert into candidate_event_links (
           candidate_id, article_id, event_id, link_type, cluster_id, reviewer_id, linked_at
         ) values ($1, $2, $3, 'supporting', $4, 'system.auto-cluster', $5)`,
        [candidate.id, candidate.article_id, event.id, clusterId, now],
      );

      await tx.query(
        "update events set last_updated_at = $2, updated_at = $2 where id = $1",
        [event.id, now],
      );

      await tx.query(
        `insert into event_updates (
           public_id, event_id, update_type, description, source_id, article_id, actor, created_at
         ) values ($1, $2, 'context', $3, $4, $5, 'pipeline', $6)`,
        [
          `nsm-cluster-${randomUUID()}`,
          event.id,
          "Supporting evidence attached automatically after a deterministic cluster assessment.",
          candidate.source_id,
          candidate.article_id,
          now,
        ],
      );

      await tx.query(
        `insert into audit_logs (
           actor_id, actor_type, action, entity_type, entity_id, before, after, created_at
         ) values (null, 'system', 'cluster_auto_attach', 'event', $1, null, $2::jsonb, $3)`,
        [
          event.public_id,
          JSON.stringify({
            candidate_public_id: candidate.public_id,
            article_public_id: candidate.article_public_id,
            cluster_id: clusterId,
            similarity: assessment.similarity,
            rule_version: assessment.scoreVersion,
          }),
          now,
        ],
      );

      return true;
    });
  }

  async listQueue(
    status: ClusterQueueStatus = "pending",
    limit = 50,
  ): Promise<ClusterQueueItem[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    const result = await this.driver.query<QueueRow>(
      `select ec.id, ec.cluster_reference, ec.decision, ec.similarity, ec.reasons,
              ec.rule_version, ec.created_at, ec.reviewed_at, ec.reviewed_by,
              c.public_id as candidate_public_id, a.original_title as candidate_title,
              a.excerpt as candidate_excerpt, a.canonical_url as candidate_url,
              c.category as candidate_category, c.state_id as candidate_state_id,
              c.lga as candidate_lga, a.published_at as candidate_published_at,
              s.slug as source_slug, s.name as source_name,
              e.public_id as event_public_id, e.title as event_title,
              e.category as event_category, e.state_id as event_state_id,
              e.first_reported_at as event_first_reported_at
       from event_clusters ec
       join articles a on a.id = ec.article_id
       join ingestion_candidates c on c.article_id = ec.article_id
       join sources s on s.id = a.source_id
       join events e on e.id = ec.event_id
       where ($1::text = 'all' or ec.decision = $1)
       order by ec.created_at desc
       limit $2`,
      [status, cap],
    );

    return result.rows.map((row) => ({
      id: row.id,
      clusterReference: row.cluster_reference,
      decision: row.decision as ClusterQueueItem["decision"],
      similarity: numberOrNull(row.similarity),
      reasons: stringArray(row.reasons),
      ruleVersion: row.rule_version,
      createdAt: iso(row.created_at, "cluster created time"),
      reviewedAt: nullableIso(row.reviewed_at, "cluster review time"),
      reviewedBy: row.reviewed_by,
      candidate: {
        publicId: row.candidate_public_id,
        title: row.candidate_title,
        excerpt: row.candidate_excerpt ?? "",
        url: row.candidate_url,
        category: row.candidate_category as Category,
        stateId: row.candidate_state_id,
        lga: row.candidate_lga,
        publishedAt: nullableIso(row.candidate_published_at, "candidate publication time"),
        sourceSlug: row.source_slug,
        sourceName: row.source_name,
      },
      event: {
        publicId: row.event_public_id,
        title: row.event_title,
        category: row.event_category as Category,
        stateId: row.event_state_id,
        firstReportedAt: iso(row.event_first_reported_at, "event first reported time"),
      },
    }));
  }

  async review(input: ClusterReviewInput): Promise<ClusterReviewResult> {
    const reviewerId = input.reviewerId.trim().toLowerCase();
    if (!REVIEWER_ID_PATTERN.test(reviewerId)) {
      return failure(
        "invalid_reviewer",
        "Reviewer ID must be 3–64 characters: lowercase letters, digits, dots, underscores or hyphens.",
      );
    }
    const notes = cleanNotes(input.notes);
    if (notes.length < MIN_CLUSTER_NOTES || notes.length > MAX_CLUSTER_NOTES) {
      return failure(
        "invalid_notes",
        `Cluster review notes must be ${MIN_CLUSTER_NOTES}–${MAX_CLUSTER_NOTES} characters.`,
      );
    }

    return this.driver.transaction(async (tx) => {
      const found = await tx.query<ClusterForReviewRow>(
        `select ec.id, ec.decision, ec.event_id,
                e.public_id as event_public_id, e.published as event_published,
                e.is_demo as event_is_demo,
                ec.article_id, c.id as candidate_id, c.status as candidate_status,
                c.source_id, s.independence_group
         from event_clusters ec
         join events e on e.id = ec.event_id
         join ingestion_candidates c on c.article_id = ec.article_id
         join sources s on s.id = c.source_id
         where ec.id = $1
         limit 1
         for update of ec`,
        [input.clusterId],
      );
      const row = found.rows[0];
      if (!row) {
        return failure("not_found", `No cluster with ID ${input.clusterId}.`);
      }
      if (row.decision !== "pending") {
        return failure("already_decided", `Cluster ${input.clusterId} is already ${row.decision}.`);
      }
      if (!row.event_published || row.event_is_demo) {
        return failure("event_unavailable", "The target event is not a published production event.");
      }
      if (row.candidate_status !== "accepted") {
        return failure("candidate_unavailable", "The candidate is no longer accepted.");
      }

      const now = new Date().toISOString();

      if (input.action === "reject") {
        await tx.query(
          `update event_clusters
           set decision = 'rejected', reviewed_by = $2, reviewed_at = $3
           where id = $1 and decision = 'pending'`,
          [row.id, reviewerId, now],
        );
        const audit = await tx.query<{ id: string | number | bigint }>(
          `insert into audit_logs (
             actor_id, actor_type, action, entity_type, entity_id, before, after, created_at
           ) values (null, 'user', 'cluster_reject', 'event_cluster', $1, $2::jsonb, $3::jsonb, $4)
           returning id`,
          [
            row.id,
            JSON.stringify({ decision: "pending" }),
            JSON.stringify({ decision: "rejected", reviewer_id: reviewerId, notes }),
            now,
          ],
        );
        const auditId = audit.rows[0]?.id;
        if (auditId == null) throw new Error("Cluster rejection audit insert returned no row.");
        return {
          ok: true,
          action: "reject",
          clusterId: row.id,
          eventPublicId: row.event_public_id,
          auditId: String(auditId),
        };
      }

      const linked = await tx.query<{ id: string }>(
        "select id from candidate_event_links where candidate_id = $1 or article_id = $2 limit 1",
        [row.candidate_id, row.article_id],
      );
      if (linked.rows[0]) {
        return failure("already_linked", "The candidate is already linked to an event.");
      }

      const source = await tx.query<{ id: string }>(
        `insert into event_sources (
           public_id, event_id, article_id, relationship, independence_group, added_at
         ) values ($1, $2, $3, 'supporting', $4, $5)
         on conflict (event_id, article_id) do nothing
         returning id`,
        [
          evidenceSourcePublicId(row.event_public_id, row.article_id),
          row.event_id,
          row.article_id,
          row.independence_group,
          now,
        ],
      );
      if (!source.rows[0]) {
        return failure("already_linked", "The article is already attached to the event.");
      }

      const updated = await tx.query<{ id: string }>(
        `update event_clusters
         set decision = 'accepted', reviewed_by = $2, reviewed_at = $3
         where id = $1 and decision = 'pending'
         returning id`,
        [row.id, reviewerId, now],
      );
      if (!updated.rows[0]) {
        return failure("already_decided", "The cluster changed before this review was applied.");
      }

      await tx.query(
        `insert into candidate_event_links (
           candidate_id, article_id, event_id, link_type, cluster_id, reviewer_id, linked_at
         ) values ($1, $2, $3, 'supporting', $4, $5, $6)`,
        [row.candidate_id, row.article_id, row.event_id, row.id, reviewerId, now],
      );

      await tx.query(
        "update events set last_updated_at = $2, updated_at = $2 where id = $1",
        [row.event_id, now],
      );

      await tx.query(
        `insert into event_updates (
           public_id, event_id, update_type, description, article_id, actor, created_at
         ) values ($1, $2, 'context', $3, $4, 'reviewer', $5)`,
        [
          `nsm-cluster-${randomUUID()}`,
          row.event_id,
          "Supporting evidence attached after reviewer cluster approval. Verification has not been reassessed.",
          row.article_id,
          now,
        ],
      );

      const audit = await tx.query<{ id: string | number | bigint }>(
        `insert into audit_logs (
           actor_id, actor_type, action, entity_type, entity_id, before, after, created_at
         ) values (null, 'user', 'cluster_accept', 'event_cluster', $1, $2::jsonb, $3::jsonb, $4)
         returning id`,
        [
          row.id,
          JSON.stringify({ decision: "pending" }),
          JSON.stringify({
            decision: "accepted",
            reviewer_id: reviewerId,
            notes,
            event_public_id: row.event_public_id,
          }),
          now,
        ],
      );
      const auditId = audit.rows[0]?.id;
      if (auditId == null) throw new Error("Cluster acceptance audit insert returned no row.");

      return {
        ok: true,
        action: "accept",
        clusterId: row.id,
        eventPublicId: row.event_public_id,
        auditId: String(auditId),
      };
    });
  }
}
