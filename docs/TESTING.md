# Testing Strategy

## 1. Layers

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest (Node/jsdom) | registry, geometry metadata, filtering, aggregation, validation, demo invariants, Postgres connection config |
| Database integration | Vitest (Node) + PGlite/PostGIS | migrations, checksums, rollback, seed, repository round-trip, demo/production guards, RLS, reviewer audit, AI enrichment provenance, verification transitions, migration inspection |
| Component | Vitest + React Testing Library | event cards, filters, state brief, search, lite toggle, regional dialog, health status, loading/empty/error |
| API | Vitest (route handlers) | Zod validation, envelopes, caching headers, 404s, regional/trend contracts |
| E2E | Playwright | map interactions, all states, search, filters, regional profiles/trends, mobile, lite mode |
| Performance | Playwright + Lighthouse/trace | bundle size, LCP, map init, interaction latency |

## 2. Required unit coverage

- Registry has exactly 37 entries; IDs unique and pattern `NG-[A-Z]{2}`; names unique; six zone memberships exactly as specified; FCT in North Central.
- Generated GeoJSON has 37 features; every registry ID present once; geometry valid; bounds inside Nigeria; coordinates finite; each state's computed area within tolerance of source metadata.
- Simplified label points lie inside their state polygon (point-in-polygon test).
- LGA gazetteer: every LGA has a parent state; duplicate LGA names are permitted only across different states; no coordinates outside Nigeria.
- Event filters: state, zone, category, severity, verification, window boundaries (inclusive/exclusive at 24h/7d/30d), free text, combined filters, pagination.
- Aggregations: national/regional/trend buckets; independent source count (not article count); percentages sum correctly; zero buckets present.
- Regional intelligence: all six zones returned; like-for-like comparison excludes national-scope records; severity 4–5 and corroborated shares computed from zone records; state coverage counts; 7/14/30-day trend totals; empty-zone assessment states that absence is not safety.
- Regional URL state: `view=regions`, `region` and `trend` parse and serialise; invalid region/trend values fall back; regional params are omitted when the dialog is closed.
- Regional validation: invalid zone/category/severity/window/days → consistent `400` envelope.
- Demo invariants: all demo events `isDemo`, fictional source names, no real person names, all coordinates have precision `lga`/`state`/`exact`, no event outside Nigeria, occurrences not in the future.
- Search: state name, alias (`FCT`, `Abuja`), LGA, category, event title; diacritics/case; minimum query length.
- Timestamp handling: UTC storage, Africa/Lagos display, relative-time boundaries.
- Validation: invalid state/category/window/limit → typed errors.
- Database: all ten migrations apply in order and roll back in reverse; checksum changes are rejected; 37 state boundaries load from checked-in GeoJSON; the 74-event demo snapshot round-trips exactly through SQL; repository returns sources, evidence, timeline and relations; production mode rejects demo rows; anonymous roles see non-demo public views only and cannot read raw `events`, `ingestion_candidates`, `candidate_reviews`, `ai_enrichments`, `event_updates` or `audit_logs`; `inspectMigrations()` reports applied/pending/changed/unknown before and after rollback.
- Ingestion: entity decoding is one-pass; markup, scripts, images and WordPress trailers are stripped; excerpts stay within the source limit; article URLs reject non-HTTPS, credentials, non-default ports and foreign hosts and remove tracking parameters; RSS 2.0 parsing rejects DTD/ENTITY, malformed XML, non-RSS documents and empty feeds; promoted and out-of-scope sections are rejected; category/geography priors resolve clear cases and return explicit ambiguity for multiple states, “Niger” homonyms, “Niger Delta” and ordinary-word LGA collisions; no proposal is accepted automatically.
- Ingestion persistence: deterministic articles/candidates round-trip through PGlite/PostGIS; repeated feeds are idempotent; failures increment source-health failures and the next success resets the streak; anonymous review-queue reads are denied and `service_role` access is allowed.
- Reviewer decisions: identity pattern, resolved category/state requirements, state correction clearing a stale LGA, mandatory rejection rationale, notes bounds, refusal to re-decide, transactional status guard, append-only audit values, no event creation, and audit-table RLS/privileges.
- AI enrichment: disabled-by-default provider resolution and fail-loud configuration; bounded prompt input and untrusted-data framing; strict proposal schema; category/state/LGA registry checks; exact title/excerpt evidence; URL, control-character and extra-field rejection; raw-response hashing; duplicate/idempotency; rejected-candidate and unknown-candidate guards; append-only RLS table; no candidate or event mutation.
- Postgres connection config: Supabase transaction (6543), session (5432) and direct hosts are classified; `sslmode`/`ssl`/`options`/`pgbouncer`/`connection_limit` URL parameters are stripped and mapped to explicit pool settings; CA files load for `verify-full`; a CA with disabled SSL is rejected; `DATABASE_SEARCH_PATH` is normalised and injection-shaped values fail; `DATABASE_POOL_MAX` is validated and clamped; Supabase connections do not send startup `options`; self-hosted direct connections do.
- Database CLI: `db:verify:local` performs the same migration/seed/RLS/rollback loop without Docker or a Postgres daemon. `db:doctor` and `db:verify` fail with actionable messages when no database URL is configured.

## 3. RTL coverage

- Rendering an event card exposes headline, category, state, severity, source count, verification, demo badge and accessible labels.
- Selecting a category updates the visible feed and counts.
- Selecting a state updates the state brief, clears on "National overview", restores focus.
- Search dialog filters and selects results with keyboard.
- Lite mode persists and disables animated chart flags (assert attributes/behaviour, not visuals).
- Regional dialog: selecting a zone updates the profile and comparison; switching trend range refetches and restores explicit zero buckets; applying a zone filter updates the dashboard store; request errors render an explicit retry state; keyboard focus remains trapped and Escape closes.
- Empty, loading and error states render explicit messages and retry where applicable.

## 4. Playwright scenarios

### Current browser acceptance suite (Phase 3/4)

`e2e/dashboard.spec.ts` runs at 1440×900 and 390×844 and covers the current gate:

- Standard MapLibre render: one canvas, local worker, state labels, event markers/clusters, clean console.
- Lite mode: exactly 37 interactive state paths, hover tooltip, click-to-filter, URL state, state brief and clear.
- Event record: demo warning, evidence/source tab, timeline tab, rule-based analysis tab and Escape close.
- Category filter counts, search result selection, state directory, six-zone regional comparison, switchable comparison metrics, zone profiles, 7/14/30-day trend range, zone-filter action, deep links and filter chips.
- Mobile: four-tab navigation, regional entry through the Brief tab, keyboard state selection, stats view and no horizontal overflow.

The checked-in suite is deliberately smaller than the Phase 9 matrix below; it is the current acceptance gate, not a claim that every later-phase scenario is covered.

### Phase 4 database gate

`src/lib/data/postgres/postgres.test.ts` uses a real PostGIS extension inside PGlite. It is a Node-environment test, not a mock, and covers:

- Migration application, idempotent re-application and full rollback.
- Migration inspection (`inspectMigrations`) reports applied/pending/changed/unknown correctly before and after rollback.
- Checksum tampering in applied or rollback SQL is rejected before execution.
- Authoritative state seed and exact demo snapshot round-trip (all 74 events compared field-by-field).
- Individual event/evidence/timeline/relation loading.
- Production-mode refusal of demo rows.
- Anonymous view filtering and denial of raw-table access.

`src/lib/data/postgres/client.test.ts` is a Node-environment unit suite for hosted configuration: Supabase pooler classification, SSL inference and overrides, CA loading, `sslmode` removal, pool sizing, search-path validation and the decision to omit startup options on Supabase. It performs no network I/O.

`npm run db:verify:local` runs the same operational path as a CLI check and prints counts. It also asserts that `ingestion_candidates`, `candidate_reviews` and `ai_enrichments` exist with RLS enabled, that `anon`/`authenticated` cannot read them, that `service_role` has only the intended review/audit/enrichment grants, and that the append-only update triggers are present, then rolls every migration back.

`src/components/dashboard/health-pill.test.tsx` covers the status surface: demo mode is labelled static, degraded production is not shown as healthy, and the database/ingestion copy reflects the API values and the CLI-only capture boundary.

### Phase 5 ingestion tests

- `src/lib/ingestion/text.test.ts` — entity decoding, markup stripping, excerpt bounds, title cleaning and phrase matching.
- `src/lib/ingestion/url.test.ts` — HTTPS/allow-list validation, canonicalisation, tracking removal and scope checks.
- `src/lib/ingestion/rss.test.ts` — strict RSS 2.0 parsing, DTD/ENTITY rejection and malformed-feed rejection.
- `src/lib/ingestion/classify.test.ts` — category priors, state/LGA resolution, multiple-state ambiguity, Niger homonyms, Delta/Niger Delta separation and candidate statuses.
- `src/lib/ingestion/collect.test.ts` — structural rejection reasons, deduplication, hashing, missing dates and per-run limits.
- `src/lib/ingestion/fetch.test.ts` — User-Agent, redirect revalidation, content-type/size/status guards and HTTPS refusal.
- `src/lib/data/postgres/ingestion.test.ts` — PGlite/PostGIS persistence, idempotency, review-queue RLS, failure logging and source-health recovery.

### Phase 5 reviewer tests

- `src/lib/review/decide.test.ts` — pure decision rules: operator identity, required category/state, explicit corrections, stale-LGA clearing, unknown category/state, mandatory rejection rationale, notes bounds and refusal to re-decide.
- `src/lib/data/postgres/review.test.ts` — PGlite/PostGIS queue listing, accept/reject, correction, repeated-decision refusal, audit values, evidence immutability, no event creation, audit-table RLS and append-only trigger.

There is no automated test for the reviewer CLI argument parser; the command surface is smoke-tested with `--help` and invalid arguments. Reviewer authentication and HTTP endpoints do not exist.

### Phase 5 AI enrichment tests

- `src/lib/ai/schema.test.ts` — valid proposal canonicalisation, fenced JSON, explicit unknowns, unknown state/LGA, LGA-without-state, exact location evidence, extra fields (including severity/coordinates), URLs, control characters and length bounds.
- `src/lib/ai/prompt.test.ts` — bounded title/excerpt, control-character stripping, untrusted-data framing, forbidden output fields, all 37 states and only the prior state's LGA list.
- `src/lib/ai/provider.test.ts` — disabled default, case-insensitive disabled values and fail-loud `AiConfigurationError` for unimplemented providers.
- `src/lib/ai/runner.test.ts` — disabled short-circuit, valid proposal hashing/storage, invalid output before the store, sanitised provider errors, rejected-candidate skip and duplicate preservation.
- `src/lib/data/postgres/ai.test.ts` — PGlite/PostGIS storage, provenance fields, deduplication, `not_found`, rejected-candidate refusal, unchanged candidate/evidence, zero events, RLS/privileges and append-only trigger.

No live model call is tested because no provider is implemented; all provider tests use fixtures.

### Phase 5 clustering tests

- `src/lib/clustering/assess.test.ts` — hard gates (distinct record, resolved equal category, resolved equal state, valid time, 72-hour boundary), LGA and headline-number conflict caps, same-publisher/syndication non-independence, stop-word normalisation, time decay, no-match separation, 0.86/0.70 threshold boundaries, input immutability and no write side effects.

### Phase 5 verification tests

- `src/lib/verification/transitions.test.ts` — evidence summary counting, same-publisher collapse, syndication groups, background/retraction handling, credible conflict, single/multiple source rules, official confirmation, explicit corroboration approval, retraction terminality, no-change/invalid transitions, reviewer ID and rationale bounds.
- `src/lib/data/postgres/verification.test.ts` — PGlite/PostGIS valid transition, event/timeline/audit writes, no event creation or publication, repeated/insufficient-evidence refusal, invalid reviewer/rationale/not-found guards, corroboration, retraction terminality, unchanged event count, RLS and privileges.

There is no verification CLI/UI test because neither exists. Verification transitions require an existing event; candidate acceptance still cannot create one.

Live feed checks (`npm run ingest:dry-run`, `npm run ingest:local`) are verification exercises, not deterministic CI tests: they depend on publisher availability and current content.

### Current verification

Verified on 7 November 2026:

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Pass |
| ESLint | `npm run lint` | Pass |
| Unit / RTL / PostGIS | `npm run test` | 204 tests across 31 files |
| Local database | `npm run db:verify:local` | Pass: 10 migrations, seed, repository, review-queue, reviewer-audit, AI-enrichment and verification-transition RLS, rollback |
| Production build | `npm run build` | Pass; `/` First Load JS 205 kB |
| Browser acceptance | `npm run test:e2e` | 5 passed, 3 desktop-only specs intentionally skipped in the mobile project |
| Live feed dry-run | `npm run ingest:dry-run` | 15 fetched, 9 accepted, 6 rejected; no writes |
| Live PGlite ingestion | `npm run ingest:local` | 15 fetched; 6 candidates inserted (2 `pending`, 4 `needs_review`), 0 duplicates; no event (6 Nov recheck) |
| Hosted preflight | `npm run db:doctor` | Implemented; no project configured in this environment |
| Hosted verification | `npm run db:verify` | Implemented; no project configured in this environment |

`npm run test:e2e` runs `npm run build` first (`pretest:e2e`) and then starts the compiled production server with `next start`. This prevents dev-mode route compilation — which can exceed 30 seconds on a cold cache for `/api/search` or `/api/intelligence/regional` — from being mistaken for a product timeout. Port 3000 must be free unless `PLAYWRIGHT_REUSE_SERVER=1` is set. The suite uses `channel: "chrome"` because Playwright browser downloads are blocked in this environment; set `PLAYWRIGHT_CHANNEL` for another installed Chromium channel.

Unit tests use `testTimeout`/`hookTimeout` of 20 seconds and an RTL `asyncUtilTimeout` of 5 seconds so the Radix-based regional dialog remains stable when the full suite runs under CPU contention. The PostGIS integration suites explicitly allow longer setup timeouts because they apply migrations and seed the full demo snapshot or capture fixture.

### Phase 9 expansion

1. Homepage loads with no console errors; all 37 state paths exist in SVG fallback and map data.
2. Hover/click every state; state brief and URL update; clear filter restores national view.
3. Category and severity filters change cards and map markers consistently.
4. Regional dialog shows six zones and comparison values derived from the dataset; profiles, trends and deep links round-trip.
5. Event detail opens from feed and from map marker; demo warning visible.
6. Search finds a state and an event; keyboard-only path works.
7. Time-window filter updates the trend chart and counts.
8. Mobile (390×844): map/wire/brief switcher, filter drawer, no horizontal overflow.
9. Lite mode: MapLibre is not requested; SVG map remains interactive; charts don't animate.
10. Network throttling (Slow 3G) and offline: shell renders; explicit offline/stale indicators (Phase 8).
11. Accessibility: axe scan on dashboard, state brief and event dialog; keyboard focus order; reduced-motion mode.

## 5. Commands

```bash
npm run typecheck
npm run lint
npm run test          # Vitest, including PGlite/PostGIS integration
npm run test:cov
npm run test:e2e      # builds, then Playwright against the production server (installed Chrome)
npm run db:verify:local
npm run db:doctor     # hosted preflight; requires MIGRATION_DATABASE_URL or DATABASE_URL
npm run db:verify     # hosted schema/RLS/data check
npm run ingest:dry-run   # live feed fetch/classification; no writes
npm run ingest:local     # live feed into ephemeral PGlite/PostGIS
```

## 6. CI

On pull request: install → typecheck → lint → unit/RTL → build. On main: plus Playwright against an installed Chrome/Chromium channel. Fail on TypeScript errors, ESLint errors and test failures. Hosted database checks (`db:doctor`, `db:verify`) belong in a protected deployment job with `MIGRATION_DATABASE_URL` as a secret — never in a pull-request job from forks. Performance budget check in CI from Phase 8.

## 7. Test data

- Demo dataset is deterministic (fixed seed) so snapshots and counts are stable.
- The test database is ephemeral PGlite memory. It is seeded only with the fictional demo snapshot and the 37-state registry.
- Ingestion fixtures are synthetic RSS strings with fake headlines and URLs. They are never inserted into a production database and are not evidence.
- Never use real casualties or personal data in fixtures.
- API tests use the same Zod schemas as production, not duplicated fixtures.
