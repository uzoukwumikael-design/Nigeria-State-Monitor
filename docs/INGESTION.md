# Phase 5 Ingestion

**Status:** capture, review-queue and reviewer-decision CLI implemented and run end-to-end against one real source. The validated AI enrichment boundary, a pure clustering gate/scoring module and a reviewer-only verification transition store are implemented, but no live AI provider is enabled and no cluster is persisted. Reviewer authentication/UI, cluster persistence/review and event publication are **not** implemented. No live production ingestion is claimed. Acceptance is evidence review, not publication.

## 1. What works

One source is enabled: **Premium Times** (`https://www.premiumtimesng.com/feed/`). A run:

1. Fetches the RSS feed once, with a truthful User-Agent, HTTPS-only URLs, an allow-list revalidated on every redirect, a hard timeout and a byte ceiling.
2. Rejects DTD/entity declarations and requires well-formed RSS 2.0.
3. Validates titles, canonical URLs, dates, scope and Nigeria relevance.
4. Removes tracking parameters and WordPress boilerplate; stores a bounded plain-text excerpt.
5. Applies deterministic category and geography priors.
6. Writes `raw_items`, `articles`, `ingestion_candidates`, `ingestion_logs` and `source_health` inside one transaction.
7. Leaves every captured item in review. **No event is created.**
8. A separate reviewer CLI can accept or reject a candidate, recording a stable reviewer ID and an append-only audit row. Acceptance still creates no event.
9. A separate AI boundary can validate and store a proposal in `ai_enrichments` with model/prompt provenance. It is disabled by default, and it never updates a candidate or creates an event.
10. A pure clustering module can assess two records only after distinctness, resolved category, resolved state and a 72-hour window pass; similarity alone never merges. No cluster is persisted.
11. A reviewer-input verification store can change the status of an **existing** event and append a timeline row and audit row in one transaction. It cannot create, verify or publish a candidate.

Re-running the same feed is idempotent: raw items, articles and candidates deduplicate on content hashes. A candidate that has been accepted or rejected is not silently re-proposed on a later capture; it remains decided.

## 2. Commands

```bash
# Live fetch and classification; no database writes
npm run ingest:dry-run

# Live fetch into an ephemeral PGlite/PostGIS database. Migrates and seeds
# the 37-state registry first, then writes the review queue.
npm run ingest:local

# Persistent run using MIGRATION_DATABASE_URL or DATABASE_URL
npm run ingest -- --source=premium-times

# Options
npm run ingest -- --source=premium-times --limit=10 --json
npm run ingest -- --help
```

Reviewer decisions use the same database URL and are CLI-only:

```bash
# Inspect the open queue (pending + needs_review)
npm run review -- --list
npm run review -- --list --status=needs_review --limit=50 --json

# Accept, correcting the category/state if the priors were unresolved or wrong
npm run review -- --id=cand-... --action=accept --reviewer=reviewer-01 \
  --category=security --state=NG-PL --notes="Headline and excerpt agree."

# Reject; a rationale is mandatory
npm run review -- --id=cand-... --action=reject --reviewer=reviewer-01 \
  --notes="Duplicate of an earlier report."
```

Acceptance requires a resolved category and state. If the reviewer changes the state, the prior's LGA is cleared rather than carried across. Reviewer IDs must be stable operator identifiers (3–64 lowercase letters, digits, dots, underscores or hyphens), not personal email addresses. There is no reviewer authentication yet; the CLI must run server-side with the admin database URL. Every decision is written to the append-only `candidate_reviews` table in the same transaction as the status change.

Exit code is `0` for a successful or partially useful run, `1` for a fetch, parse, persistence or review failure, and `2` for invalid arguments. `--dry-run` and `--pglite` are mutually exclusive.

`NSM_INGESTION_CONTACT` is optional. When set, it is included in the User-Agent; it is never sent to the browser. There is no scheduler and no HTTP ingestion endpoint in this increment.

## 3. Source review

Premium Times is treated as **restricted**, not approved for republication:

- robots.txt allows crawling with `crawl-delay: 10`; the adapter records that value in the source config and performs one feed retrieval per run, with redirect hops revalidated against the same allow-list. The CLI has no scheduler or built-in sleep, so manual runs must be spaced at least 10 seconds apart.
- The site asserts copyright and publishes no explicit RSS syndication licence.
- Stored: headline, canonical URL, publication/retrieval timestamps, feed categories, ≤320-character excerpt, attribution and hashes.
- Not stored: full article text, images, author PII or the raw feed payload.
- Article pages are not fetched.

The evidence and decision are recorded in `docs/DATA_SOURCES.md`. This is an engineering and research decision, not legal advice. Obtain permission or a syndication licence before production publication.

## 4. Modules

| File | Responsibility |
| --- | --- |
| `src/lib/ingestion/types.ts` | Source, parsed feed, prior, proposal, collection and store contracts |
| `src/lib/ingestion/sources.ts` | Enabled source configuration and invariant checks |
| `src/lib/ingestion/fetch.ts` | HTTPS/allow-list fetch, redirect revalidation, timeout, byte limit, content-type check, feed hash |
| `src/lib/ingestion/rss.ts` | Strict RSS 2.0 parser; rejects DTD/ENTITY and malformed XML |
| `src/lib/ingestion/text.ts` | One-pass entity decoding, markup stripping, excerpt bounds, phrase matching |
| `src/lib/ingestion/url.ts` | HTTPS article URL validation, canonicalisation, tracking removal, promoted/out-of-scope checks |
| `src/lib/ingestion/classify.ts` | Deterministic category and state/LGA priors; candidate proposal |
| `src/lib/ingestion/collect.ts` | Item validation, deduplication, hashing, rejection reasons |
| `src/lib/ingestion/pipeline.ts` | End-to-end orchestration and failure logging |
| `src/lib/data/postgres/ingestion.ts` | Transactional persistence and source-health updates |
| `src/lib/review/types.ts` | Reviewer action, queue and audit contracts |
| `src/lib/review/decide.ts` | Pure decision validation: identity, category/state, rejection rationale, stale-LGA clearing |
| `src/lib/data/postgres/review.ts` | Queue reads, guarded status update and transactional audit insert |
| `src/lib/ai/` | Provider boundary, strict schema/evidence validation, hashing, runner and append-only store |
| `src/lib/clustering/` | Pure category + geography + 72-hour gates and deterministic similarity scoring |
| `src/lib/verification/` | Pure evidence-gated verification state machine and transition rules |
| `src/lib/data/postgres/verification.ts` | Transactional status update, timeline row and audit row for an existing event |
| `scripts/ingest/run.ts` | Ingestion CLI |
| `scripts/review/run.ts` | Reviewer CLI (list, accept, reject) |
| `supabase/migrations/0008_ingestion_candidates.sql` | Review queue, indexes and RLS |
| `supabase/migrations/0009_reviewer_decisions.sql` | Accepted-field constraints, append-only reviewer audit and RLS |
| `supabase/migrations/0010_ai_enrichments.sql` | Append-only AI enrichment proposals and RLS |

## 5. Deterministic priors

Category priors use weighted phrase rules for `security`, `politics`, `economy`, `infrastructure`, `environment` and `health`. The headline is weighted more than feed tags and the excerpt. Balanced or weak evidence resolves to `null` and `needs_review`; it is never guessed.

Geography priors use the canonical state registry, state capitals, secondary-city aliases, the 774-LGA gazetteer and explicit country/state homonym handling:

- A single named state resolves directly.
- A capital or unique LGA can resolve a state; LGA-only evidence is deliberately below the auto-pending threshold.
- Multiple named states resolve to `stateId: null`, `ambiguous: true` and review.
- `Niger` alone is not Niger State; explicit signals such as “Niger State” or “Minna” are required. “Niger Delta” is treated as a region, not Delta State.
- “Nigeria/Nigerian(s)” is recorded as country evidence without inventing a state.
- LGA duplicates across states are never used to infer a parent state.

Every proposal stores its rule version (`nsm-priors-2026-11-05.1`), confidence values, reasons and the prior matches that produced it.

## 6. Candidate statuses

| Status | Meaning |
| --- | --- |
| `pending` | Clear category and a single unambiguous state; accepted and published automatically on the next run when the confidence rules pass (or held for a person if `AUTOPUBLISH=off`) |
| `needs_review` | Missing/ambiguous category, missing/multiple state, low confidence or unknown publication date |
| `accepted` | A reviewer accepted the evidence with a resolved category and state. **Not verified and not published** |
| `rejected` | Auto-rejected before storage or rejected by a reviewer; `rejection_reason` is required |

Capture cannot produce `accepted`: the capture proposal type and database constraints allow only `pending`, `needs_review` or `rejected`. Acceptance is reachable only through the reviewer path.

### Reviewer decisions

A reviewer decision is transactional and append-only:

1. The candidate must exist and still be `pending` or `needs_review`.
2. The reviewer ID must match the operator-ID pattern; notes are bounded to 1,000 characters.
3. `accept` requires a category from the six-category taxonomy and a state from the 37-state registry. Missing values must be supplied explicitly; they are never guessed. Changing the state clears the prior LGA.
4. `reject` requires a rationale and records the stable reason code `reviewer_rejected`.
5. The candidate status update is guarded by its previous status. The audit row records previous/new status, previous/new category and state, reviewer, action, notes and timestamp.
6. No method inserts or updates an event. Acceptance is **not** verification, corroboration or publication.

The audit table is server-only: RLS enabled, `anon`/`authenticated` revoked, `service_role` granted `SELECT`/`INSERT` only, and a trigger blocks updates. Rows are retained when a candidate or article is deleted (`ON DELETE RESTRICT`).

### Rejection reasons

| Reason | Meaning |
| --- | --- |
| `missing_title` | Empty headline after cleaning |
| `invalid_url`, `non_https_url`, `url_contains_credentials`, `host_not_allowed`, `non_default_port` | Article URL failed the HTTPS/allow-list checks |
| `promoted_item` | Promoted path or promoted/sponsored feed tag |
| `out_of_scope_section` | Sports, entertainment, foreign, lifestyle, jobs or similar path |
| `invalid_publication_date` | Present but unparseable, or implausibly far in the future |
| `future_publication_date` | More than 48 hours ahead of the run |
| `older_than_window` | Older than the source's capture window (30 days) |
| `duplicate_in_feed` | Repeated canonical URL or external ID in the same feed |
| `no_nigeria_signal` | No Nigerian state, capital, LGA, “Nigeria” or “Nigerian(s)” mention |

## 7. Database behaviour

Migration `0008_ingestion_candidates.sql` adds:

- `category`, `state_id`, `lga`, category/geography confidence, status, rejection reason, reasons array and rule version.
- Reviewer fields (`reviewed_at`, `reviewed_by`) with a constraint requiring both for `accepted`.
- `rejected` requires a `rejection_reason`.
- Indexes by status, state and source; RLS enabled; `anon`/`authenticated` revoked; `service_role` granted.

Migration `0009_reviewer_decisions.sql` adds:

- Constraints requiring an accepted candidate to have both a category and state, and reviewer IDs to match the operator pattern.
- `candidate_reviews`, a server-only append-only audit table with previous/new values, reviewer, action, rationale and timestamp. A unique candidate constraint permits one decision per candidate; update/delete privileges are withheld and an update trigger raises.
- RLS and explicit `anon`/`authenticated` revocation; `service_role` can read and insert audit rows only.

`PostgresIngestionStore`:

- Upserts the source by slug, keeping `is_demo = false`.
- Inserts immutable raw-item metadata and a normalised article per item.
- Inserts one candidate per article; repeats leave the existing candidate unchanged.
- Writes one `ingestion_logs` row per run.
- Sets `sources.last_successful_sync` and upserts `source_health`.
- Records failures as `failed` logs and increments consecutive failures; the next success resets the failure streak.

`PostgresReviewStore`:

- Lists the queue with joined article and source metadata; filters by status and caps the limit at 100.
- Applies a decision in one transaction: re-reads the candidate, validates the pure decision, updates only when the previous status still matches, then inserts the audit row.
- Returns `already_decided` rather than overwriting an earlier decision.
- Never touches `events`, `event_sources`, `published_events` or a dataset snapshot.

The `db:verify:local` gate asserts both tables, their RLS, privileges and the append-only trigger, and rolls migrations 0008–0009 back with the rest.

### Clustering and verification (no new migration)

`src/lib/clustering/assess.ts` is pure and write-free. `PostgresVerificationStore` in `src/lib/data/postgres/verification.ts` uses the existing `events`, `event_updates` and `audit_logs` tables. One transaction:

1. Re-reads the existing event and refuses if it is missing or the expected status no longer matches.
2. Updates `verification_status` and `last_updated_at` only; `published` and `confidence` are untouched.
3. Appends a neutral `verification_change` row to `event_updates`.
4. Inserts an `audit_logs` row with reviewer ID, rationale, rule version and evidence counts.

It never creates an event, writes `event_clusters` or touches the public published view. `db:verify:local` asserts RLS and service-role select/insert grants on `event_updates` and `audit_logs`; neither table has a database-level append-only trigger yet. See `docs/AI_PIPELINE.md` for the gates and transition rules.

## 8. Verification on 5–7 November 2026

| Check | Result |
| --- | --- |
| Live dry-run | 15 feed items fetched; 9 accepted for review; 6 rejected (3 out-of-scope sections, 3 no-Nigeria signal) |
| Live dry-run classification | 4 `pending`, 5 `needs_review`; no event created |
| Live PGlite/PostGIS run | 9 articles inserted, 9 candidates inserted (4 `pending`, 5 `needs_review`), 0 duplicates; 6 rejected |
| Local database gate | 10 migrations applied and rolled back; review-queue, reviewer-audit, AI-enrichment and verification timeline/audit RLS verified |
| Post-0009 live recheck (6 Nov) | 15 fetched; 6 accepted, 9 rejected; 6 candidates inserted (2 `pending`, 4 `needs_review`), 0 duplicates; no event |
| Unit/integration suite | 204 tests across 31 files, including ingestion, reviewer decisions, AI enrichment, clustering, verification and PGlite idempotency/health/audit/RLS |

Feed composition changes continuously; these counts describe the observed run, not a permanent dataset.

## 9. Known limitations

- Only one source is enabled. The other feeds in `docs/DATA_SOURCES.md` remain unenabled pending terms review.
- No hosted database has been provisioned; persistent writes require the operator's `MIGRATION_DATABASE_URL`/`DATABASE_URL`.
- No scheduler, queue, per-source lock, retry/backoff loop or dead-letter replay exists. Run the CLI manually.
- Reviewer decisions are CLI-only. There is no reviewer authentication, web UI or audited HTTP write API; the operator must hold the admin database URL.
- A decided candidate cannot be reopened or corrected in this increment. A future correction path must append a new audited action, not edit history.
- No live AI provider is implemented. `AI_PROVIDER=disabled`; the contract, validation and storage boundary are tested with fixtures only. Category/geography values in the review queue are deterministic priors or explicit reviewer corrections.
- No event clustering persistence, publication path or production snapshot exists. `src/lib/clustering/` only assesses a pair; `event_clusters` has no writer or review CLI. `accepted` does not mean verified, corroborated or published.
- Verification transitions apply only to an existing event, and no event is created from the review queue. `event_updates`/`audit_logs` are server-only but lack database-level append-only triggers; the store only inserts.
- The adapter does not fetch article pages; it cannot verify claims or extract body text, by design.
- Out-of-scope filtering is path-based. A sports or foreign story published under `/news/` can still reach review, where it can be rejected.
- The classifier is rule-based and English-only. It will miss paraphrases and may flag ambiguous stories; review is mandatory.
- The live PGlite run is ephemeral and is not production persistence.

## 10. Adding another source

Before adding a slug to `INGESTION_SOURCES`:

1. Re-verify the feed and robots.txt; record evidence and date in `docs/DATA_SOURCES.md`.
2. Review terms, copyright and syndication permissions. Choose `approved`, `restricted` or `unreviewed`; never `approved` without evidence.
3. Define exact allowed hosts, excerpt limit, item cap, crawl delay and maximum age.
4. Confirm RSS 2.0 compatibility. Do not add HTML scraping to this adapter.
5. Add fixtures and classification tests. Do not use real article text in fixtures.
6. Run a dry-run, then a local PGlite run, then the full gates.
7. Do not add a second source until the first remains green end-to-end.
