import type { DatabaseDriver, QueryExecutor } from "@/lib/data/postgres/driver";
import type {
  FeedCollection,
  IngestionSource,
  IngestionStore,
  PersistCollectionInput,
  PersistCollectionResult,
  RecordFailureInput,
} from "@/lib/ingestion/types";

interface IdRow {
  id: string;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function executionMs(startedAt: Date, finishedAt: Date): number {
  const value = finishedAt.getTime() - startedAt.getTime();
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

async function ensureSource(tx: QueryExecutor, source: IngestionSource): Promise<string> {
  const result = await tx.query<IdRow>(
    `insert into sources (
       slug, name, source_type, tier, base_url, feed_url, access_method,
       independence_group, licence_status, attribution, reliability_note,
       active, is_demo, sort_order
     ) values (
       $1, $2, $3, $4, $5, $6, 'rss',
       $7, $8, $9, $10,
       $11, false, 0
     )
     on conflict (slug) do update set
       name = excluded.name,
       source_type = excluded.source_type,
       tier = excluded.tier,
       base_url = excluded.base_url,
       feed_url = excluded.feed_url,
       access_method = excluded.access_method,
       independence_group = excluded.independence_group,
       licence_status = excluded.licence_status,
       attribution = excluded.attribution,
       reliability_note = excluded.reliability_note,
       active = excluded.active,
       updated_at = now()
     returning id`,
    [
      source.slug,
      source.name,
      source.sourceType,
      source.tier,
      source.baseUrl,
      source.feedUrl,
      source.independenceGroup,
      source.licenceStatus,
      source.attribution,
      source.reliabilityNote,
      source.active,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Unable to upsert ingestion source ${source.slug}.`);
  return id;
}

async function insertRawItem(
  tx: QueryExecutor,
  sourceId: string,
  collection: FeedCollection,
  index: number,
): Promise<string> {
  const item = collection.items[index];
  if (!item) throw new Error(`Missing ingestion item at index ${index}.`);

  const inserted = await tx.query<IdRow>(
    `insert into raw_items (
       source_id, external_id, fetched_at, http_status, content_type,
       payload_hash, title_hint, published_hint
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (payload_hash) do nothing
     returning id`,
    [
      sourceId,
      item.externalId,
      collection.fetchedAt,
      collection.httpStatus,
      collection.contentType,
      item.rawHash,
      item.title,
      item.publishedAt,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (id) return id;

  const existing = await tx.query<IdRow>(
    "select id from raw_items where payload_hash = $1 limit 1",
    [item.rawHash],
  );
  const existingId = existing.rows[0]?.id;
  if (!existingId) throw new Error("Raw item insert conflicted but no existing row was found.");
  return existingId;
}

async function insertArticle(
  tx: QueryExecutor,
  sourceId: string,
  rawItemId: string,
  collection: FeedCollection,
  index: number,
): Promise<{ id: string; inserted: boolean }> {
  const item = collection.items[index];
  if (!item) throw new Error(`Missing ingestion item at index ${index}.`);

  const inserted = await tx.query<IdRow>(
    `insert into articles (
       public_id, source_id, external_id, original_title, original_url,
       canonical_url, excerpt, content_hash, published_at, retrieved_at,
       language, state_id, lga, raw_item_id, is_demo
     ) values (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       'en', $11, $12, $13, false
     )
     on conflict do nothing
     returning id`,
    [
      `art-${item.contentHash.slice(0, 24)}`,
      sourceId,
      item.externalId,
      item.title,
      item.originalUrl,
      item.canonicalUrl,
      item.excerpt,
      item.contentHash,
      item.publishedAt,
      item.retrievedAt,
      item.proposal.stateId,
      item.proposal.lga,
      rawItemId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (id) return { id, inserted: true };

  const existing = await tx.query<IdRow>(
    `select id from articles
     where content_hash = $1 or (source_id = $2 and canonical_url = $3)
     limit 1`,
    [item.contentHash, sourceId, item.canonicalUrl],
  );
  const existingId = existing.rows[0]?.id;
  if (!existingId) throw new Error("Article insert conflicted but no existing row was found.");
  return { id: existingId, inserted: false };
}

async function insertCandidate(
  tx: QueryExecutor,
  sourceId: string,
  articleId: string,
  input: PersistCollectionInput,
  index: number,
): Promise<{ id: string; inserted: boolean }> {
  const item = input.collection.items[index];
  if (!item) throw new Error(`Missing ingestion item at index ${index}.`);
  const proposal = item.proposal;

  const inserted = await tx.query<IdRow>(
    `insert into ingestion_candidates (
       public_id, run_id, source_id, article_id, category, state_id, lga,
       category_confidence, geo_confidence, status, rejection_reason,
       reasons, rule_version
     ) values (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11,
       $12::jsonb, $13
     )
     on conflict (article_id) do nothing
     returning id`,
    [
      `cand-${item.contentHash.slice(0, 24)}`,
      input.runId,
      sourceId,
      articleId,
      proposal.category,
      proposal.stateId,
      proposal.lga,
      proposal.categoryConfidence,
      proposal.geoConfidence,
      proposal.status,
      proposal.rejectionReason,
      JSON.stringify(proposal.reasons),
      proposal.ruleVersion,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (id) return { id, inserted: true };

  const existing = await tx.query<IdRow>(
    "select id from ingestion_candidates where article_id = $1 limit 1",
    [articleId],
  );
  const existingId = existing.rows[0]?.id;
  if (!existingId) throw new Error("Candidate insert conflicted but no existing row was found.");
  return { id: existingId, inserted: false };
}

/**
 * Writes one collection inside a single transaction. Re-running the same feed
 * is idempotent: raw items, articles and candidates deduplicate on their
 * content hashes, so a repeated fetch never inflates counts.
 */
export class PostgresIngestionStore implements IngestionStore {
  constructor(private readonly driver: DatabaseDriver) {}

  async persistCollection(input: PersistCollectionInput): Promise<PersistCollectionResult> {
    return this.driver.transaction(async (tx) => {
      const { collection } = input;
      const sourceId = await ensureSource(tx, collection.source);

      let articlesInserted = 0;
      let articlesDuplicate = 0;
      let candidatesInserted = 0;
      let candidatesExisting = 0;
      let pending = 0;
      let needsReview = 0;
      let autoRejected = 0;

      for (let index = 0; index < collection.items.length; index += 1) {
        const rawItemId = await insertRawItem(tx, sourceId, collection, index);
        const article = await insertArticle(tx, sourceId, rawItemId, collection, index);
        if (article.inserted) articlesInserted += 1;
        else articlesDuplicate += 1;

        const candidate = await insertCandidate(tx, sourceId, article.id, input, index);
        if (candidate.inserted) {
          candidatesInserted += 1;
          const status = collection.items[index]?.proposal.status;
          if (status === "pending") pending += 1;
          else if (status === "needs_review") needsReview += 1;
          else if (status === "rejected") autoRejected += 1;
        } else {
          candidatesExisting += 1;
        }
      }

      const fetched = collection.items.length + collection.rejected.length;
      const status: PersistCollectionResult["status"] =
        collection.items.length > 0 ? "success" : "partial";
      const finishedAt = input.finishedAt;

      await tx.query(
        `insert into ingestion_logs (
           source_id, run_id, status, records_fetched, records_new,
           records_rejected, error_message, execution_ms
         ) values ($1, $2, $3, $4, $5, $6, null, $7)`,
        [
          sourceId,
          input.runId,
          status,
          fetched,
          articlesInserted,
          collection.rejected.length,
          executionMs(input.startedAt, finishedAt),
        ],
      );

      await tx.query(
        `update sources
         set last_successful_sync = $2, updated_at = now()
         where id = $1`,
        [sourceId, finishedAt],
      );

      await tx.query(
        `insert into source_health (
           source_id, last_checked_at, last_successful_sync, status,
           error_count, consecutive_failures, last_error, latency_ms
         ) values ($1, $2, $2, 'healthy', 0, 0, null, $3)
         on conflict (source_id) do update set
           last_checked_at = excluded.last_checked_at,
           last_successful_sync = excluded.last_successful_sync,
           status = excluded.status,
           consecutive_failures = 0,
           last_error = null,
           latency_ms = excluded.latency_ms`,
        [sourceId, finishedAt, executionMs(input.startedAt, finishedAt)],
      );

      return {
        sourceId,
        fetched,
        accepted: collection.items.length,
        rejected: collection.rejected.length,
        articlesInserted,
        articlesDuplicate,
        candidatesInserted,
        candidatesExisting,
        pending,
        needsReview,
        autoRejected,
        status,
      };
    });
  }

  /** Current health per source slug, as recorded by past runs. Sources never run yet are absent. */
  async listSourceHealth(): Promise<
    Map<
      string,
      {
        status: string;
        consecutiveFailures: number;
        lastCheckedAt: string | null;
        lastSuccessfulSync: string | null;
        lastError: string | null;
      }
    >
  > {
    const result = await this.driver.query<{
      slug: string;
      status: string;
      consecutive_failures: number | string;
      last_checked_at: Date | string | null;
      last_successful_sync: Date | string | null;
      last_error: string | null;
    }>(
      `select s.slug, sh.status, sh.consecutive_failures, sh.last_checked_at, sh.last_successful_sync, sh.last_error
       from source_health sh join sources s on s.id = sh.source_id`,
      [],
    );
    const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
    return new Map(
      result.rows.map((row) => [
        row.slug,
        {
          status: row.status,
          consecutiveFailures: Number(row.consecutive_failures),
          lastCheckedAt: iso(row.last_checked_at),
          lastSuccessfulSync: iso(row.last_successful_sync),
          lastError: row.last_error,
        },
      ]),
    );
  }

  /** Articles captured per source slug: last 24 hours and all time. */
  async listSourceActivity(): Promise<Map<string, { articlesLast24h: number; articlesTotal: number }>> {
    const result = await this.driver.query<{ slug: string; last_24h: number | string; total: number | string }>(
      `select s.slug,
              count(*) filter (where a.retrieved_at > now() - interval '24 hours') as last_24h,
              count(*) as total
       from articles a join sources s on s.id = a.source_id
       group by s.slug`,
      [],
    );
    return new Map(result.rows.map((row) => [row.slug, { articlesLast24h: Number(row.last_24h), articlesTotal: Number(row.total) }]));
  }

  async recordFailure(input: RecordFailureInput): Promise<void> {
    await this.driver.transaction(async (tx) => {
      const sourceId = await ensureSource(tx, input.source);
      const message = truncate(input.error, 1_000);
      await tx.query(
        `insert into ingestion_logs (
           source_id, run_id, status, records_fetched, records_new,
           records_rejected, error_message, execution_ms
         ) values ($1, $2, 'failed', 0, 0, 0, $3, $4)`,
        [sourceId, input.runId, message, executionMs(input.startedAt, input.finishedAt)],
      );
      await tx.query(
        `insert into source_health (
           source_id, last_checked_at, last_successful_sync, status,
           error_count, consecutive_failures, last_error, latency_ms
         ) values ($1, $2, null, 'down', 1, 1, $3, $4)
         on conflict (source_id) do update set
           last_checked_at = excluded.last_checked_at,
           status = excluded.status,
           error_count = source_health.error_count + 1,
           consecutive_failures = source_health.consecutive_failures + 1,
           last_error = excluded.last_error,
           latency_ms = excluded.latency_ms`,
        [sourceId, input.finishedAt, message, executionMs(input.startedAt, input.finishedAt)],
      );
    });
  }
}
