import { randomUUID } from "node:crypto";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import {
  publicationSummary,
  publicationUncertainties,
  validatePublicationInput,
  type PublicationInput,
} from "@/lib/publication/rules";
import type {
  PublishableCandidate,
  PublicationResult,
  PublishedEvent,
} from "@/lib/publication/types";
import type { Category } from "@/lib/types";

interface CandidateRow {
  id: string;
  public_id: string;
  status: string;
  category: string | null;
  state_id: string | null;
  state_name: string | null;
  lga: string | null;
  geo_confidence: unknown;
  article_id: string;
  article_public_id: string;
  original_title: string;
  excerpt: string | null;
  published_at: unknown;
  retrieved_at: unknown;
  article_is_demo: boolean;
  source_id: string;
  source_slug: string;
  source_name: string;
  independence_group: string;
  source_is_demo: boolean;
  label_lng: number | null;
  label_lat: number | null;
}

interface ListRow {
  public_id: string;
  category: string;
  state_id: string;
  state_name: string;
  lga: string | null;
  original_title: string;
  excerpt: string | null;
  published_at: unknown;
  retrieved_at: unknown;
  source_slug: string;
  source_name: string;
  reviewed_at: unknown;
  reviewed_by: string | null;
}

function requiredIso(value: unknown, label: string): string {
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
  return value == null ? null : requiredIso(value, label);
}

/**
 * Reviewer-driven candidate publication. In one transaction it creates the
 * event, its primary evidence link, an immutable candidate/event link, a
 * public timeline entry, an audit record and a fresh production snapshot.
 * AI and capture paths cannot call this class.
 */
export class PostgresPublicationStore {
  constructor(private readonly driver: DatabaseDriver) {}

  async listPublishable(limit = 50): Promise<PublishableCandidate[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    const result = await this.driver.query<ListRow>(
      `select c.public_id, c.category, c.state_id, st.name as state_name, c.lga,
              a.original_title, a.excerpt, a.published_at, a.retrieved_at,
              s.slug as source_slug, s.name as source_name,
              c.reviewed_at, c.reviewed_by
       from ingestion_candidates c
       join articles a on a.id = c.article_id
       join sources s on s.id = c.source_id
       join states st on st.id = c.state_id
       where c.status = 'accepted'
         and c.category is not null
         and c.state_id is not null
         and a.is_demo = false
         and s.is_demo = false
         and not exists (
           select 1 from candidate_event_links l
           where l.candidate_id = c.id or l.article_id = c.article_id
         )
         and not exists (
           select 1 from event_sources es where es.article_id = c.article_id
         )
       order by c.reviewed_at asc nulls last, c.created_at asc
       limit $1`,
      [cap],
    );

    return result.rows.map((row) => ({
      publicId: row.public_id,
      status: "accepted" as const,
      category: row.category as Category,
      stateId: row.state_id,
      stateName: row.state_name,
      lga: row.lga,
      title: row.original_title,
      excerpt: row.excerpt ?? "",
      sourceSlug: row.source_slug,
      sourceName: row.source_name,
      publishedAt: nullableIso(row.published_at, "article publication time"),
      retrievedAt: requiredIso(row.retrieved_at, "article retrieval time"),
      reviewedAt: nullableIso(row.reviewed_at, "candidate review time"),
      reviewedBy: row.reviewed_by,
    }));
  }

  async publish(input: PublicationInput): Promise<PublicationResult> {
    return this.driver.transaction(async (tx) => {
      const found = await tx.query<CandidateRow>(
        `select c.id, c.public_id, c.status, c.category, c.state_id, st.name as state_name,
                c.lga, c.geo_confidence,
                a.id as article_id, a.public_id as article_public_id,
                a.original_title, a.excerpt, a.published_at, a.retrieved_at,
                a.is_demo as article_is_demo,
                s.id as source_id, s.slug as source_slug, s.name as source_name,
                s.independence_group, s.is_demo as source_is_demo,
                extensions.ST_X(st.label_point)::float8 as label_lng,
                extensions.ST_Y(st.label_point)::float8 as label_lat
         from ingestion_candidates c
         join articles a on a.id = c.article_id
         join sources s on s.id = c.source_id
         left join states st on st.id = c.state_id
         where c.public_id = $1
         limit 1
         for update of c`,
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
      if (row.article_is_demo || row.source_is_demo) {
        return {
          ok: false,
          code: "not_accepted",
          message: "Demo evidence cannot be published to a production event.",
        };
      }

      const validation = validatePublicationInput(
        {
          publicId: row.public_id,
          status: row.status as "pending" | "needs_review" | "accepted" | "rejected",
          category: row.category as Category | null,
          stateId: row.state_id,
          title: row.original_title,
          excerpt: row.excerpt ?? "",
        },
        input,
      );
      if (!validation.ok) return validation;

      const existing = await tx.query<{ id: string }>(
        `select id from candidate_event_links
         where candidate_id = $1 or article_id = $2
         union all
         select id from event_sources where article_id = $2
         limit 1`,
        [row.id, row.article_id],
      );
      if (existing.rows[0]) {
        return {
          ok: false,
          code: "already_linked",
          message: `Candidate ${row.public_id} is already linked to an event.`,
        };
      }
      if (!row.state_id || row.label_lng == null || row.label_lat == null) {
        return {
          ok: false,
          code: "unresolved_state",
          message: "The candidate state has no authoritative label point.",
        };
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const eventPublicId = `evt-${randomUUID()}`;
      const eventSlug = `event-${randomUUID()}`;
      const firstReportedAt = requiredIso(
        row.published_at ?? row.retrieved_at,
        "first reported time",
      );
      const summary = publicationSummary(row.original_title, row.excerpt ?? "");
      const uncertainties = publicationUncertainties(Boolean(row.lga));

      await tx.query(
        `insert into events (
           public_id, slug, title, summary, category, subcategory, severity,
           severity_rationale, state_id, lga, location, geo_precision,
           geo_confidence, occurrence_at, first_reported_at, last_updated_at,
           verification_status, confidence, uncertainties, analysis, analysis_kind,
           is_demo, published, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, '', $6,
           $7, $8, $9,
           extensions.ST_SetSRID(extensions.ST_MakePoint($10, $11), 4326)::extensions.geography,
           'state', 0, null, $12, $13,
           'unassessed', 0, $14::jsonb, '', 'none',
           false, true, $13, $13
         )`,
        [
          eventPublicId,
          eventSlug,
          row.original_title,
          summary,
          row.category,
          validation.severity,
          validation.severityRationale,
          row.state_id,
          row.lga,
          row.label_lng,
          row.label_lat,
          firstReportedAt,
          nowIso,
          JSON.stringify(uncertainties),
        ],
      );

      const sourcePublicId = `esrc-${randomUUID()}`;
      await tx.query(
        `insert into event_sources (
           public_id, event_id, article_id, relationship, independence_group, added_at
         ) values ($1, (select id from events where public_id = $2), $3, 'primary', $4, $5)`,
        [sourcePublicId, eventPublicId, row.article_id, row.independence_group, nowIso],
      );

      const link = await tx.query<{ id: string }>(
        `insert into candidate_event_links (
           candidate_id, article_id, event_id, link_type, cluster_id, reviewer_id,
           severity, severity_rationale, linked_at
         ) values (
           $1, $2, (select id from events where public_id = $3), 'published', null, $4,
           $5, $6, $7
         )
         returning id`,
        [
          row.id,
          row.article_id,
          eventPublicId,
          validation.reviewerId,
          validation.severity,
          validation.severityRationale,
          nowIso,
        ],
      );
      const linkId = link.rows[0]?.id;
      if (!linkId) throw new Error("Candidate publication link insert returned no row.");

      await tx.query(
        `insert into event_updates (
           public_id, event_id, update_type, description, source_id, article_id, actor, created_at
         ) values ($1, (select id from events where public_id = $2), 'new_report', $3, $4, $5, 'reviewer', $6)`,
        [
          `nsm-publication-${randomUUID()}`,
          eventPublicId,
          "Event published from accepted candidate evidence. Verification status is unassessed.",
          row.source_id,
          row.article_id,
          nowIso,
        ],
      );

      await tx.query(
        "update dataset_snapshots set is_active = false where mode = 'production' and is_active = true",
      );
      const coverage = await tx.query<{ coverage_from: unknown; coverage_to: unknown }>(
        `select min(first_reported_at) as coverage_from, max(last_updated_at) as coverage_to
         from events
         where published = true and is_demo = false`,
      );
      const coverageFromRaw = nullableIso(
        coverage.rows[0]?.coverage_from,
        "coverage start",
      );
      const coverageToRaw = nullableIso(coverage.rows[0]?.coverage_to, "coverage end");
      // Publisher timestamps can be ahead of this server's clock. The active
      // snapshot must still describe a valid range that includes publication
      // time, so clamp both ends rather than violating the coverage-order
      // constraint on a future-dated report.
      const coverageFrom =
        coverageFromRaw && coverageFromRaw < nowIso ? coverageFromRaw : nowIso;
      const coverageTo = coverageToRaw && coverageToRaw > nowIso ? coverageToRaw : nowIso;
      const snapshotVersion = `production-${nowIso
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z")}-${eventPublicId.slice(-8)}`;
      await tx.query(
        `insert into dataset_snapshots (
           mode, version, reference_time, generated_at, coverage_from, coverage_to,
           coverage_basis, coverage_label, disclaimer, limitations, is_active
         ) values (
           'production', $1, $2, $2, $3, $4,
           'live_ingestion', 'Source reports', null, $5::jsonb, true
         )`,
        [
          snapshotVersion,
          nowIso,
          coverageFrom,
          coverageTo,
          JSON.stringify([
            "Coverage begins when ingestion began and is not a complete record of incidents.",
            "Events are built from publisher reports and may be single-source.",
            "Verification status is shown per event and stays unassessed until a transition is recorded.",
          ]),
        ],
      );

      const audit = await tx.query<{ id: string | number | bigint }>(
        `insert into audit_logs (
           actor_id, actor_type, action, entity_type, entity_id, before, after, created_at
         ) values (null, 'user', 'event_publish', 'event', $1, $2::jsonb, $3::jsonb, $4)
         returning id`,
        [
          eventPublicId,
          JSON.stringify({
            candidate_public_id: row.public_id,
            candidate_status: row.status,
            article_public_id: row.article_public_id,
          }),
          JSON.stringify({
            event_public_id: eventPublicId,
            candidate_public_id: row.public_id,
            article_public_id: row.article_public_id,
            reviewer_id: validation.reviewerId,
            severity: validation.severity,
            severity_rationale: validation.severityRationale,
            snapshot_version: snapshotVersion,
            rule_version: "nsm-publication-2026-11-07.1",
          }),
          nowIso,
        ],
      );
      const auditId = audit.rows[0]?.id;
      if (auditId == null) throw new Error("Publication audit insert returned no row.");

      const event: PublishedEvent = {
        eventPublicId,
        eventSlug,
        title: row.original_title,
        category: row.category as string,
        stateId: row.state_id,
        severity: validation.severity,
        verificationStatus: "unassessed",
        firstReportedAt,
        publishedAt: nowIso,
      };

      return {
        ok: true,
        event,
        linkId,
        auditId: String(auditId),
        snapshotVersion,
      };
    });
  }
}
