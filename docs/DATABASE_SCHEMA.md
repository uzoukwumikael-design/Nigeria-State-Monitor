# Database Schema (PostgreSQL 16 + PostGIS)

**Status:** Phase 4 implemented and locally verified. Phase 5 adds the ingestion review queue (`0008`), reviewer decisions and an append-only audit trail (`0009`), the validated AI enrichment boundary (`0010`), a pure clustering gate/scoring module and a reviewer-only verification transition store over the existing event tables. A live AI provider, cluster persistence/review, verification CLI/UI, reviewer authentication and event publication are not implemented. Migrations, rollback, registry seed, demo seed, repository mapping, public-view RLS, review-queue RLS, reviewer-audit RLS, AI-enrichment RLS and verification timeline/audit RLS run against PGlite 0.5.15 with PostGIS 3.6. The Supabase connection path is implemented and unit-tested (pooler split, SSL, `extensions` schema, pool sizing). A hosted Supabase/PostgreSQL project has **not** been provisioned, and no production records exist.

- Schema source of truth: `supabase/migrations/*.sql`
- Rollback source of truth: `supabase/rollbacks/*.sql`
- Local verification: `npm run db:verify:local`
- Hosted preflight: `npm run db:doctor`
- Hosted verification: `npm run db:verify` (`--expect=demo|registry|production`)
- Hosted runbook: `docs/SUPABASE_SETUP.md`

All timestamps are `timestamptz` in UTC. Public event/source identifiers are human-readable plus UUID row identifiers where referential integrity benefits. Geometry is EPSG:4326. The application registry (`NG-AB` … `NG-ZA`, including `NG-FC`) remains the canonical state identifier.

## 1. Migrations

| Version | File | Purpose |
| --- | --- | --- |
| 0001 | `0001_extensions.sql` | `extensions` schema, required PostGIS; optional `pg_trgm` when available |
| 0002 | `0002_registry.sql` | 37-state registry and immutable dataset snapshot metadata |
| 0003 | `0003_sources_articles.sql` | Raw items, sources, publisher-level articles |
| 0004 | `0004_events.sql` | Events, evidence links, append-only updates, relations, cluster review |
| 0005 | `0005_operations_economics.sql` | Ingestion logs, source health, economics, audit logs |
| 0006 | `0006_rls_views.sql` | RLS, private raw tables, published read models |
| 0007 | `0007_retention.sql` | Guarded raw-item and ingestion-log purge functions |
| 0008 | `0008_ingestion_candidates.sql` | Ingestion review queue, deterministic priors, reviewer fields and RLS |
| 0009 | `0009_reviewer_decisions.sql` | Accepted-field constraints, append-only reviewer audit and RLS |
| 0010 | `0010_ai_enrichments.sql` | Validated AI proposals, provenance metadata, append-only RLS table |

The migration runner stores checksums of both the up and down file in `_nsm_migrations`. It refuses to run a migration or rollback whose checked-in SQL changed after application. Each migration is applied in its own transaction. Rollback is explicit; it is never automatic in deployment.

### Schema placement

PostGIS is installed in the `extensions` schema, matching Supabase's guidance:

```sql
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
```

Every migration and rollback sets `set search_path = public, extensions;`. Runtime repository and seed SQL schema-qualifies PostGIS (`extensions.ST_*`, `extensions.geometry`, `extensions.geography`) instead of relying on a startup search path. This keeps the shared transaction pooler safe: Supavisor can ignore `options=-c search_path=...`, but schema-qualified SQL always resolves.

`describePostgresConnection()` and `db:doctor` report whether a connection uses the startup search-path option or schema-qualified SQL. Hosted Supabase connections intentionally do not send the startup option.

`pg_trgm` is optional because PGlite does not bundle it. The current API search uses normalised text and does not require trigram indexes.

## 2. Entity separation

```
raw_items             immutable source payload metadata (evidence)
articles              normalised publisher-level article records
ingestion_candidates  deterministic/AI proposals awaiting review (not events)
candidate_reviews     append-only reviewer decisions (not events)
ai_enrichments        append-only model proposals with provenance (not events)
events                one real-world occurrence (the intelligence unit)
event_sources         many-to-many evidence links + independence metadata
event_updates         append-only timeline/corrections
event_relations       explicit related-event links
sources               publisher/institution registry
source_health         operational health, separate from editorial reliability
economic_*            numeric observations, fully separate from news events
```

An article never becomes an event automatically. Captured articles enter `ingestion_candidates`; a reviewer may accept or reject the evidence, but only a future verification and publication path may create an event. Acceptance is not publication.

## 3. Registry and snapshots

### `states`

- `id text` primary key, `NG-XX` pattern; `NG-FC` is the internal FCT identifier.
- `name`, `iso_code` unique; six fixed zones.
- `capital`, `capital_lga`.
- `boundary geometry(MultiPolygon, 4326)` with a GiST index and `ST_IsValid` constraint.
- `label_point`, `capital_point geometry(Point, 4326)`.
- `area_km2`, bbox columns.
- Boundaries are loaded only by `scripts/db/seed-registry.ts` from the checked-in GRID3/geoBoundaries output. They are never hand-entered.

### `dataset_snapshots`

Describes the dataset a repository is allowed to serve:

- `mode` (`demo`/`production`), `version`, `reference_time`, `generated_at`.
- `coverage_from`, `coverage_to`, `coverage_basis`, `coverage_label`.
- `disclaimer`, `limitations` (JSON array).
- One active snapshot per mode via a partial unique index.
- Demo snapshots require a disclaimer. Production cannot use `demo_snapshot` coverage.

## 4. Evidence tables

### `raw_items`

Immutable fetch metadata: source, external ID, HTTP status, content type, payload hash, storage path, title/published hints, demo flag. Payload bodies are not stored in this table.

### `sources`

Registry with stable `slug` (the public source ID), name, type, tier, base/feed URL, access method, independence group, licence status, attribution, reliability note, active state, demo flag and last successful sync. Demo sources must have `source_type = 'demo'` and no base URL.

### `articles`

Publisher-level records: source, original/canonical URLs, title, hashes, published/retrieved time, optional state/LGA and raw-item link. Demo articles have no URL; production articles require both original and canonical URLs. `content_hash` is unique. Article counts are never presented as unique incident counts.

### `event_sources`

Links one event to one article, with relationship (`primary`, `supporting`, `conflicting`, `retracted`, `background`) and independence group. Independent source count is computed as distinct non-retracted groups, not article count.

## 5. Event tables

### `events`

- Public ID, slug, title, summary, category, subcategory.
- Severity plus explicit `severity_rationale`.
- State/LGA, optional geography point, `geo_precision`, `geo_confidence`.
  - `exact`: evidence supports a point.
  - `lga`/`state`: representative point only; not an incident coordinate.
  - `national`/`unknown`: no point.
- Occurrence, first-reported and last-updated times.
- Verification status, confidence, uncertainty array.
- `analysis` and `analysis_kind` (`automated_demo_summary`, `ai_analysis`, `none`). Demo rows can never claim `ai_analysis`; production rows cannot claim the automated demo summary.
- `is_demo`, `published`, audit timestamps.

### `event_updates`

Append-only timeline entries by application convention. Types include new report, casualty update, official statement, correction, retraction, location update, verification change and context. Actor is `pipeline`, `reviewer` or `system`. The verification store inserts `verification_change` rows; there is no database-level update/delete trigger on this table yet.

### `event_relations`

Explicit related-event edges with relation type and display order. The repository reads only related events that are published and in the same demo/production mode.

### `event_clusters`

Review queue for article/event clustering decisions. It records method, similarity, confidence, decision and reviewer. No event merge is authorised by similarity alone. The table exists but has no writer or review CLI yet; `src/lib/clustering/` is a pure assessment and does not persist clusters.

### `ingestion_candidates`

The review boundary between evidence and intelligence.

- One row per article (`article_id` unique) plus `run_id`, `source_id`.
- Proposed `category`, `state_id`, `lga`, category/geo confidence, `status` (`pending`, `needs_review`, `accepted`, `rejected`), rejection reason, reasons JSON array and rule version.
- `accepted` requires `reviewed_at`, `reviewed_by`, a resolved category and a resolved state. `rejected` requires `rejection_reason`.
- Reviewer IDs must match `^[a-z0-9][a-z0-9._-]{2,63}$`.
- Indexed by status, state and source. No public view and no `anon`/`authenticated` grant.
- The capture CLI can produce `pending`/`needs_review` only. It cannot set `accepted` or create an event.
- Acceptance/rejection is applied by `scripts/review/run.ts` through `PostgresReviewStore`.

### `candidate_reviews`

Append-only audit of reviewer decisions.

- One row per decided candidate (`candidate_id` unique), linked to the article.
- Records `reviewer_id`, `action` (`accept`/`reject`), `previous_status`, `new_status`, previous/new category and state, bounded `notes` and `created_at`.
- Accept rows require a category and state; reject rows require a rationale of at least three characters.
- RLS enabled; `anon` and `authenticated` revoked; `service_role` has `SELECT`/`INSERT` only.
- No update or delete grant, and a trigger rejects updates. References use `ON DELETE RESTRICT`, so deleting a candidate or article cannot silently erase audit history.
- No event, verification status or publication record is written by a review decision.

### `ai_enrichments`

Append-only, server-only model proposals.

- One row per `(candidate_id, provider, model, prompt_version, schema_version)`. Repeating the same key returns the existing row with `duplicate: true`.
- `proposal jsonb` is the validated proposal only; raw response text is never stored. `raw_response_hash` is a SHA-256 hex digest of the exact raw response.
- `confidence numeric(3,2)` is constrained to `[0, 1]`; `processed_at` is the model-processing time, `created_at` the insert time.
- Linked to the candidate and article with `ON DELETE RESTRICT`.
- RLS enabled; `anon` and `authenticated` revoked; `service_role` has `SELECT`/`INSERT` only. An update trigger raises.
- The store never updates a candidate, creates an event, sets verification status or publishes. AI output is a proposal attached to evidence.
- No public view exposes enrichment rows. A live provider is disabled by default; see `docs/AI_PIPELINE.md`.

### Verification transitions

No new table or migration. `PostgresVerificationStore` updates an existing `events` row and, in the same transaction, appends `event_updates` (`verification_change`) and inserts `audit_logs`. The audit record stores reviewer ID, rationale, rule version and evidence counts; reviewer identity is not placed in public timeline text. The store never creates an event, changes `published`, alters confidence or writes a public view. `event_updates` and `audit_logs` have RLS enabled and `anon`/`authenticated` are denied, but they do not yet have append-only update triggers.

## 6. Operations and economics

- `ingestion_logs` — run ID, status, fetched/new/rejected counts, error, duration.
- `source_health` — operational state, latency, failures, separate from editorial reliability.
- `economic_indicators` — code, unit, currency, frequency, source, data status.
- `economic_observations` — value, reference period, publication date, geography scope, source URL/series, vintage, supersedes link, demo flag. State/zone/national scope is constrained; observations never mix with event counts.
- `audit_logs` — actor, action, entity, before/after JSON, request ID.

## 7. Demo/production separation

The repository enforces all three layers:

1. `NSM_MODE=production` requires `NSM_REPOSITORY=postgres`; the in-memory demo repository is rejected.
2. The active snapshot mode must match the repository mode and coverage basis.
3. The repository counts demo and production rows before serving. A demo repository refuses any production source/article/event; a production repository refuses any demo row.

The demo seed also refuses to write into a database containing non-demo records or an active production snapshot. Demo events are still marked `is_demo` internally even though the UI carries a prominent demo banner.

## 8. Row-level security and public views

RLS is enabled on every application table. The migration revokes table privileges from `anon` and `authenticated`; raw articles, evidence, enrichment, audit and operational tables are not directly readable.

Public read models:

- `public_states` — registry metadata, not raw geometry.
- `published_events` — only `published = true` and `is_demo = false`; includes independently computed article and source counts.
- `published_event_sources` — evidence for published, non-demo events only.
- `published_event_updates` — timeline for published, non-demo events only.
- `public_economic_observations` — non-demo observations with indicator/source provenance.

The views are security-definer read models with explicit column lists and demo filters. Direct table access is denied. `service_role` receives table privileges for server-side workers; it is never exposed to the browser. `ingestion_candidates`, `candidate_reviews` and `ai_enrichments` are server-only with RLS enabled; `anon` and `authenticated` are explicitly revoked. Reviewer decisions are applied by the server-side CLI with an append-only audit trail; AI proposals are written only by the validated enrichment store. Reviewer authentication, `profiles`-based roles and write RPCs are not implemented.

## 9. Seed path

```bash
npm run db:doctor           # read-only preflight: connection, SSL, PostGIS, migrations, RLS
npm run db:migrate          # apply migrations with checksum ledger
npm run db:seed-registry    # 37 authoritative state boundaries
npm run db:seed-demo        # fictional demo snapshot; refuses mixed data
npm run db:verify           # auto-detects demo, production or registry-only
npm run db:setup            # migrate + demo seed + strict demo verification
npm run db:setup:registry   # migrate + registry seed + registry verification
```

`db:seed-demo` deletes only demo rows, re-seeds the deterministic 74-event snapshot, then loads the registry too. It is guarded by `NSM_MODE=production`. It never runs in production.

Admin commands prefer `MIGRATION_DATABASE_URL` (session pooler or direct connection) and fall back to `DATABASE_URL`. The application runtime always reads `DATABASE_URL`.

## 10. Retention and lifecycle

| Data | Retention |
| --- | --- |
| raw payload metadata | 90 days (hash + provenance retained) |
| article metadata | indefinite while linked to a published event; 24 months otherwise |
| article full excerpt | per publisher licence; default 12 months |
| events/updates | indefinite (append-only corrections) |
| ingestion logs | 90 days, aggregated metrics 13 months |
| candidate reviews | retained with the candidate/article; append-only |
| AI enrichment proposals | retained with the candidate/article; append-only |
| audit logs | 24 months |
| economic observations | indefinite with vintages |
| demo data | never in production |

`purge_expired_raw_items()` deletes only items no article still references. `purge_expired_ingestion_logs()` deletes old logs. Neither function is scheduled automatically; Phase 5 operations must invoke them after aggregate retention.

## 11. Verification and known limits

Verified locally:

- All ten migrations apply and all ten roll back to an empty application schema.
- PostGIS 3.6 loads in the `extensions` schema, all 37 state boundaries are valid, and the demo snapshot round-trips exactly through SQL.
- 74 demo events, 8 demo sources, evidence links, timelines and relations match the in-memory snapshot.
- Anonymous access sees 0 demo events, 37 public states and 0 demo evidence rows.
- `anon` has no SELECT privilege on raw `events`, `ingestion_candidates`, `candidate_reviews` or `ai_enrichments`; `service_role` has review-queue, audit and enrichment read/insert access.
- Reviewer decisions update the candidate and append exactly one audit row in one transaction; a repeated decision is refused.
- Reviewer audit rows are append-only: `service_role` lacks update/delete privileges and an update trigger raises.
- Validated AI proposals are stored once per candidate/model/prompt/schema key; duplicates return the existing row, rejected candidates are refused, and raw response text is not stored.
- AI enrichment rows are append-only and cannot update candidates or create events.
- Ingestion capture is idempotent across repeated feeds; candidates and articles deduplicate, and source health recovers after failure.
- Review decisions never create or publish an event.
- Production mode refuses the demo-populated database.
- Migration inspection before/after rollback reports the correct pending/applied sets.
- Connection configuration is unit-tested for Supabase transaction (6543), session (5432) and direct hosts, including SSL inference, CA loading, `sslmode` removal, pool sizing and injection-shaped search paths.

Not yet verified:

- No hosted Supabase/PostgreSQL deployment, connection pooler or backup restore has been run. Run `npm run db:doctor` first.
- PostGIS point-in-polygon assignment is not used by the read repository yet; event state assignment remains an explicit evidence field.
- Reviewer authentication, role policies and security-definer write RPCs are not implemented; review decisions are CLI-only.
- No hosted ingestion, hosted production dataset or event publication exists. The live capture run used an ephemeral PGlite database.
- No live AI provider is configured or tested; enrichment is exercised with fixture providers only. Clustering is pure and not persisted; verification transitions exist only as a server-side store with no CLI/UI or reviewer authentication.
