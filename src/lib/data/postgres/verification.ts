import { randomUUID } from "node:crypto";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import {
  ALLOWED_VERIFICATION_TRANSITIONS,
  buildVerificationTransition,
  type VerificationContext,
  type VerificationErrorCode,
  type VerificationEvidence,
  type VerificationEventSummary,
  type VerificationTransition,
  type VerificationTransitionInput,
} from "@/lib/verification";
import type { Category, SourceRelationship, SourceType, VerificationStatus } from "@/lib/types";

export interface VerificationTransitionRequest extends VerificationTransitionInput {
  eventPublicId: string;
}

export type VerificationStoreErrorCode =
  | VerificationErrorCode
  | "not_found"
  | "stale_status";

export type VerificationStoreResult =
  | {
      ok: true;
      transition: VerificationTransition;
      updateId: string;
      auditId: string;
    }
  | { ok: false; code: VerificationStoreErrorCode; message: string };

interface EventSummaryRow {
  public_id: string;
  title: string;
  category: string;
  state_id: string | null;
  severity: number;
  verification_status: string;
  first_reported_at: unknown;
  last_updated_at: unknown;
  article_count: number;
  independent_source_count: number;
  conflict_groups: number;
  retracted_count: number;
}

function requiredDate(value: unknown, label: string): string {
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

interface EventRow {
  id: string;
  public_id: string;
  verification_status: string;
  is_demo: boolean;
  published: boolean;
}

interface EvidenceRow {
  publisher: string;
  independence_group: string;
  relationship: string;
  source_type: string;
}

function evidenceFrom(row: EvidenceRow): VerificationEvidence {
  return {
    publisher: row.publisher,
    independenceGroup: row.independence_group,
    relationship: row.relationship as SourceRelationship,
    sourceType: row.source_type as SourceType,
  };
}

/**
 * Applies a reviewer-approved verification transition to an existing event.
 * It never creates an event and never changes `published`. In one transaction
 * it updates the event status, appends a timeline entry and writes an audit row.
 */
export class PostgresVerificationStore {
  constructor(private readonly driver: DatabaseDriver) {}

  /**
   * Published production events a reviewer can transition. Evidence counts are
   * aggregated in one query; the event status remains the source of truth.
   */
  async listEvents(limit = 50): Promise<VerificationEventSummary[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    const result = await this.driver.query<EventSummaryRow>(
      `select
         e.public_id,
         e.title,
         e.category,
         e.state_id,
         e.severity,
         e.verification_status,
         e.first_reported_at,
         e.last_updated_at,
         (select count(*)::integer from event_sources es
            where es.event_id = e.id) as article_count,
         (select count(distinct es.independence_group)::integer from event_sources es
            where es.event_id = e.id and es.relationship <> 'retracted') as independent_source_count,
         (select count(distinct es.independence_group)::integer from event_sources es
            where es.event_id = e.id and es.relationship = 'conflicting') as conflict_groups,
         (select count(*)::integer from event_sources es
            where es.event_id = e.id and es.relationship = 'retracted') as retracted_count
       from events e
       where e.published = true and e.is_demo = false
       order by e.last_updated_at desc, e.public_id
       limit $1`,
      [cap],
    );

    return result.rows.map((row) => {
      const status = row.verification_status as VerificationStatus;
      return {
        eventPublicId: row.public_id,
        title: row.title,
        category: row.category as Category,
        stateId: row.state_id,
        severity: row.severity,
        verificationStatus: status,
        firstReportedAt: requiredDate(row.first_reported_at, "event first reported time"),
        lastUpdatedAt: requiredDate(row.last_updated_at, "event updated time"),
        articleCount: row.article_count,
        independentSourceCount: row.independent_source_count,
        conflictGroups: row.conflict_groups,
        retractedCount: row.retracted_count,
        allowedTargets: ALLOWED_VERIFICATION_TRANSITIONS[status],
      };
    });
  }

  async transition(input: VerificationTransitionRequest): Promise<VerificationStoreResult> {
    return this.driver.transaction(async (tx) => {
      const found = await tx.query<EventRow>(
        `select id, public_id, verification_status, is_demo, published
         from events
         where public_id = $1
         limit 1`,
        [input.eventPublicId],
      );
      const event = found.rows[0];
      if (!event) {
        return {
          ok: false,
          code: "not_found",
          message: `No event with public ID ${input.eventPublicId}.`,
        };
      }

      const evidenceRows = await tx.query<EvidenceRow>(
        `select
           s.slug as publisher,
           es.independence_group,
           es.relationship,
           s.source_type
         from event_sources es
         join articles a on a.id = es.article_id
         join sources s on s.id = a.source_id
         where es.event_id = $1
         order by es.added_at, es.public_id`,
        [event.id],
      );

      const context: VerificationContext = {
        eventPublicId: event.public_id,
        status: event.verification_status as VerificationStatus,
        evidence: evidenceRows.rows.map(evidenceFrom),
      };

      const validation = buildVerificationTransition(context, input, new Date());
      if (!validation.ok) return validation;
      const { transition } = validation;

      const updated = await tx.query<{ id: string }>(
        `update events
         set verification_status = $2,
             last_updated_at = $3,
             updated_at = $3
         where id = $1 and verification_status = $4
         returning id`,
        [event.id, transition.status, transition.decidedAt, transition.previousStatus],
      );
      if (!updated.rows[0]) {
        return {
          ok: false,
          code: "stale_status",
          message: `Event ${event.public_id} changed verification status before this transition was applied.`,
        };
      }

      const updatePublicId = `nsm-verification-${randomUUID()}`;
      const appended = await tx.query<{ id: string }>(
        `insert into event_updates (
           public_id, event_id, update_type, description, actor, created_at
         ) values ($1, $2, 'verification_change', $3, 'reviewer', $4)
         returning id`,
        [updatePublicId, event.id, transition.description, transition.decidedAt],
      );
      const updateId = appended.rows[0]?.id;
      if (!updateId) throw new Error("Verification timeline insert returned no row.");

      const audit = await tx.query<{ id: string | number | bigint }>(
        `insert into audit_logs (
           actor_id, actor_type, action, entity_type, entity_id, before, after, created_at
         ) values (
           null, 'user', 'verification_transition', 'event', $1, $2::jsonb, $3::jsonb, $4
         )
         returning id`,
        [
          event.public_id,
          JSON.stringify({
            verification_status: transition.previousStatus,
            evidence: transition.evidence,
          }),
          JSON.stringify({
            verification_status: transition.status,
            reviewer_id: transition.reviewerId,
            rationale: transition.rationale,
            rule_version: transition.ruleVersion,
            event_update_public_id: updatePublicId,
            evidence: transition.evidence,
          }),
          transition.decidedAt,
        ],
      );
      const auditId = audit.rows[0]?.id;
      if (auditId == null) throw new Error("Verification audit insert returned no row.");

      return {
        ok: true,
        transition,
        updateId,
        auditId: String(auditId),
      };
    });
  }
}
