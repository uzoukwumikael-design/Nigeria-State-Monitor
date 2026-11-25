import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import type {
  EnrichmentCandidate,
  EnrichmentMetadata,
  EnrichmentProposal,
  EnrichmentStore,
  EnrichmentStoreResult,
} from "@/lib/ai/types";
import type { Category } from "@/lib/types";

interface CandidateRow {
  id: string;
  article_id: string;
  status: string;
}

interface EnrichmentRow {
  id: string;
}

interface CandidateListRow {
  public_id: string;
  status: string;
  category: string | null;
  state_id: string | null;
  lga: string | null;
  original_title: string;
  excerpt: string | null;
  published_at: unknown;
  retrieved_at: unknown;
  source_slug: string;
  source_name: string;
  attribution: string | null;
}

function requiredIso(value: unknown, label: string): string {
  if (value == null) throw new Error(`Missing ${label} in the enrichment queue.`);
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label} in the enrichment queue.`);
  }
  return parsed.toISOString();
}

function nullableIso(value: unknown, label: string): string | null {
  if (value == null) return null;
  return requiredIso(value, label);
}

function mapCandidate(row: CandidateListRow): EnrichmentCandidate {
  return {
    publicId: row.public_id,
    status: row.status as EnrichmentCandidate["status"],
    category: row.category as Category | null,
    stateId: row.state_id,
    lga: row.lga,
    article: {
      title: row.original_title,
      excerpt: row.excerpt ?? "",
      publishedAt: nullableIso(row.published_at, "publication time"),
      retrievedAt: requiredIso(row.retrieved_at, "retrieval time"),
      sourceSlug: row.source_slug,
      sourceName: row.source_name,
      attribution: row.attribution ?? "",
    },
  };
}

/**
 * Persists validated AI proposals. The store never updates a candidate, never
 * creates an event and never writes a public view. Raw response text is not
 * accepted here; only the validated proposal and its provenance metadata.
 */
export class PostgresEnrichmentStore implements EnrichmentStore {
  constructor(private readonly driver: DatabaseDriver) {}

  /**
   * Candidates that have not yet received an enrichment for this provider
   * boundary. Rejected candidates are never queued.
   */
  async listCandidates(limit = 25): Promise<EnrichmentCandidate[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    const result = await this.driver.query<CandidateListRow>(
      `select c.public_id, c.status, c.category, c.state_id, c.lga,
              a.original_title, a.excerpt, a.published_at, a.retrieved_at,
              s.slug as source_slug, s.name as source_name, s.attribution
       from ingestion_candidates c
       join articles a on a.id = c.article_id
       join sources s on s.id = c.source_id
       where c.status in ('pending', 'needs_review')
         and a.is_demo = false
         and s.is_demo = false
         and not exists (
           select 1 from ai_enrichments e where e.candidate_id = c.id
         )
       order by
         case c.status when 'needs_review' then 0 else 1 end,
         c.created_at asc
       limit $1`,
      [cap],
    );
    return result.rows.map(mapCandidate);
  }

  async candidate(publicId: string): Promise<EnrichmentCandidate | null> {
    const result = await this.driver.query<CandidateListRow>(
      `select c.public_id, c.status, c.category, c.state_id, c.lga,
              a.original_title, a.excerpt, a.published_at, a.retrieved_at,
              s.slug as source_slug, s.name as source_name, s.attribution
       from ingestion_candidates c
       join articles a on a.id = c.article_id
       join sources s on s.id = c.source_id
       where c.public_id = $1
         and a.is_demo = false
         and s.is_demo = false
       limit 1`,
      [publicId],
    );
    const row = result.rows[0];
    return row ? mapCandidate(row) : null;
  }

  async record(input: {
    candidatePublicId: string;
    proposal: EnrichmentProposal;
    metadata: EnrichmentMetadata;
  }): Promise<EnrichmentStoreResult> {
    return this.driver.transaction(async (tx) => {
      const found = await tx.query<CandidateRow>(
        `select id, article_id, status
         from ingestion_candidates
         where public_id = $1
         limit 1`,
        [input.candidatePublicId],
      );
      const candidate = found.rows[0];
      if (!candidate) {
        return {
          ok: false,
          code: "not_found",
          message: `No review candidate with public ID ${input.candidatePublicId}.`,
        };
      }
      if (candidate.status === "rejected") {
        return {
          ok: false,
          code: "rejected_candidate",
          message: `Candidate ${input.candidatePublicId} is rejected; enrichment is not stored.`,
        };
      }

      const inserted = await tx.query<EnrichmentRow>(
        `insert into ai_enrichments (
           candidate_id, article_id, provider, model, prompt_version,
           schema_version, proposal, confidence, raw_response_hash, processed_at
         ) values (
           $1, $2, $3, $4, $5,
           $6, $7::jsonb, $8, $9, $10
         )
         on conflict (candidate_id, provider, model, prompt_version, schema_version)
         do nothing
         returning id`,
        [
          candidate.id,
          candidate.article_id,
          input.metadata.provider,
          input.metadata.model,
          input.metadata.promptVersion,
          input.metadata.schemaVersion,
          JSON.stringify(input.proposal),
          input.proposal.confidence,
          input.metadata.rawResponseHash,
          input.metadata.processedAt,
        ],
      );
      const insertedId = inserted.rows[0]?.id;
      if (insertedId) return { ok: true, id: insertedId, duplicate: false };

      const existing = await tx.query<EnrichmentRow>(
        `select id from ai_enrichments
         where candidate_id = $1
           and provider = $2
           and model = $3
           and prompt_version = $4
           and schema_version = $5
         limit 1`,
        [
          candidate.id,
          input.metadata.provider,
          input.metadata.model,
          input.metadata.promptVersion,
          input.metadata.schemaVersion,
        ],
      );
      const existingId = existing.rows[0]?.id;
      if (!existingId) {
        throw new Error("Enrichment insert conflicted but no existing row was found.");
      }
      return { ok: true, id: existingId, duplicate: true };
    });
  }
}
