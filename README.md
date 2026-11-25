# Nigeria State Monitor (NSM)

**AI-powered national intelligence, geospatial monitoring and economic intelligence for Nigeria.**

> One map. Every state. A clearer picture of Nigeria.

NSM is a situational-awareness platform for journalists, researchers, analysts, businesses, NGOs and policymakers. It turns fragmented reporting into geographically grounded event intelligence: one real-world event, multiple supporting sources, explicit verification levels and clear separation between reported fact, uncertainty and analysis.

---

## Current status

**Phase 4 — Production data foundation. Complete and locally verified.**

**Phase 5 — Ingestion and event intelligence. Code-complete in the repository; not yet run against hosted infrastructure.** The repository contains the full evidence path: Premium Times RSS capture, a review queue, reviewer accept/reject, an AI enrichment boundary with an OpenAI-compatible provider, a category + geography + time clustering gate with persistence and review, reviewer-only verification transitions, candidate-to-event publication, reviewer authentication with a web console at `/review`, and a lease-protected scheduled ingestion endpoint (`/api/cron/ingest`). All of it is covered by unit and PGlite/PostGIS tests. **No hosted database, live AI call, real reviewer session, scheduler run or production publication has been performed**, so no live production intelligence is claimed.

The application is runnable, uses the authoritative GRID3/geoBoundaries map, and has passed typecheck, lint, unit/RTL tests, a production build and Playwright acceptance checks at 1440×900 and 390×844. Phase 4 adds a real Postgres/PostGIS schema, checksummed migrations and rollbacks, guarded seeds and a database repository verified locally with PGlite + PostGIS. Phase 5 captures one genuine, licence-reviewed RSS source — Premium Times — end-to-end into a review queue, with deterministic category and geography priors. A CLI reviewer path can accept or reject candidates with a named operator and an append-only audit trail. A validated AI enrichment boundary can store strict, evidence-checked proposals with model/prompt provenance, but the only provider is deliberately disabled. Near-duplicate assessment requires identical category, state and a 72-hour window before scoring, and a reviewer-only verification state machine can transition an existing event with a transactional timeline and audit row. Acceptance is not publication: no event is created from a candidate. A hosted Supabase project, live AI provider and production ingestion are not connected, so no live production intelligence is claimed.

| Capability | Status |
| --- | --- |
| Authoritative 36-state + FCT registry | ✅ Implemented |
| GRID3/geoBoundaries ADM1 map (CC BY 4.0) | ✅ Implemented |
| Interactive state selection, filtering, search | ✅ Implemented |
| National feed + event detail + state brief | ✅ Implemented |
| Six-zone comparison, profiles and trends | ✅ Implemented |
| Low-bandwidth / lite map mode | ✅ Implemented (SVG fallback) |
| Demo dataset (clearly labelled) | ✅ Implemented |
| Playwright acceptance suite (desktop + 390px) | ✅ Implemented |
| Postgres/PostGIS schema, migrations and rollback | ✅ Implemented and locally verified |
| SQL-backed repository behind `src/lib/data` | ✅ Implemented and locally verified |
| Supabase connection path (pooler, SSL, RLS, doctor) | ✅ Implemented and locally tested |
| Hosted Supabase project | ⏳ Operational step, not provisioned |
| RSS capture + review queue (Premium Times) | ✅ Implemented and locally verified |
| Reviewer accept/reject CLI with append-only audit | ✅ Implemented and locally verified |
| Validated AI enrichment boundary (`AI_PROVIDER=disabled`) | ✅ Implemented and locally verified |
| Category + geography + time clustering gate and scoring | ✅ Implemented and locally verified; no cluster persistence |
| Reviewer-only verification state machine and audit trail | ✅ Implemented and locally verified; no CLI/UI |
| Reviewer authentication and `/review` console (candidates, clusters, verification, publication) | ✅ Implemented and unit-tested; needs `REVIEWER_CREDENTIALS` + `REVIEWER_SESSION_SECRET` |
| Candidate-to-event publication | ✅ Implemented and tested locally; never run against a hosted database |
| Scheduled ingestion endpoint with lease | ✅ Implemented and tested; needs `CRON_SECRET` and a scheduler |
| OpenAI-compatible AI provider | ✅ Implemented behind strict validation; no real call recorded |
| Live production ingestion | ⏳ Not enabled |
| Economic indicators (8 national World Bank series, reference year and status per figure) | ✅ Implemented and unit-tested; live fetch not verified from the build sandbox (World Bank host unreachable there) |
| Historical intelligence (custom date range, state / zone / category scope, coverage disclosure, previous-period comparison) | ✅ Implemented over the records held (demo snapshot until live data exists) |
| Offline mode (service worker, saved-data banner, first-visit saving, per-build caches) | ✅ Implemented; verified in a real headless browser |
| Persistent rate limiting (Upstash Redis with in-memory fallback) | ✅ Implemented; only tested with simulated Upstash responses |
| Navigation tabs (Security, Politics, Infrastructure, Economy, History) and phone menu | ✅ Implemented |
| 19 registered sources (18 RSS publishers + GDELT; all on by default), automatic publishing, Sources tab, circuit breaker, `sources:add`, with robots.txt enforced per RSS run, multi-source ingest (`--source=all`), cron and `npm run sources:check` | ✅ Implemented and tested with mock publishers; **not run against the real feeds** from the build sandbox |
| Full cross-browser CI, accessibility and performance gates | ⏳ Phase 9 |

> **DEMO DATA NOTICE.** The current interface is populated by a fictional demonstration dataset. Every simulated event is marked `DEMO` in the interface and event detail. Demo content is not a real incident, does not describe real casualties, and does not come from the named fictional demo wires. It must never be mixed with production intelligence.

---

## Quick start

```bash
npm install
npm run dev
# http://localhost:3000
```

```bash
npm run typecheck   # strict TypeScript
npm run lint        # ESLint
npm run test        # Vitest + RTL + PostGIS integration
npm run test:e2e    # builds, then Playwright acceptance against the production server
npm run build       # production build
```

Optional environment variables are documented in `.env.example`. The default demo app runs with no external credentials or database. AI enrichment is disabled by default (`AI_PROVIDER=disabled`); no API key is required or read by this build.

Phase 5 ingestion (one real source; review queue and AI proposal storage, no publication):

```bash
npm run ingest:dry-run    # live fetch/classification; no database writes
npm run ingest:local      # live fetch into an ephemeral PGlite/PostGIS database
npm run ingest -- --source=premium-times   # persistent run via MIGRATION_DATABASE_URL/DATABASE_URL
```

Reviewer workflow (requires a migrated database; CLI only, no web endpoint):

```bash
npm run review -- --list
npm run review -- --list --status=needs_review --json
npm run review -- --id=<candidate> --action=accept --reviewer=reviewer-01 \
  --category=security --state=NG-PL --notes="Headline and excerpt agree."
npm run review -- --id=<candidate> --action=reject --reviewer=reviewer-01 \
  --notes="Duplicate of an earlier report."
```

Acceptance requires a category and a state; unresolved geography is never guessed. Reviewer IDs are stable operator identifiers, not personal email addresses. Every decision is written to the append-only `candidate_reviews` audit table. No command publishes an event. See `docs/INGESTION.md`.

Later pipeline stages (each needs a migrated database; all are server-side only):

```bash
npm run enrich -- --list                 # candidates awaiting an AI proposal (no model call)
npm run cluster -- --scan                # assess near-duplicate candidates
npm run verification -- --list           # events eligible for a verification transition
npm run publish -- --list                # accepted candidates ready to become events
npm run scheduler -- --once --pglite     # one lease-protected ingestion run, local database
```

Database verification and optional seeded-Postgres mode:

```bash
npm run db:verify:local   # migrations, seed, repository and RLS in PGlite/PostGIS
npm run db:doctor         # hosted connection, SSL, pooler, PostGIS, RLS preflight
npm run db:setup          # hosted: migrate + demo seed + strict demo verification
npm run db:migrate        # hosted Postgres/PostGIS
npm run db:seed-demo      # DEMO ONLY; refuses production records
npm run db:verify         # hosted schema/RLS/count check (auto-detects mode)
```

For a hosted Supabase project, follow `docs/SUPABASE_SETUP.md`. The short version: put the shared **session** pooler URL in `MIGRATION_DATABASE_URL`, the shared **transaction** pooler URL in `DATABASE_URL`, then run `npm run db:doctor` and `npm run db:setup`. Both variables are server-only.

See `docs/DATABASE_SCHEMA.md` and `docs/DEPLOYMENT.md` before running database commands.

---

## What is implemented in Phases 2–5

- **Accurate national map.** All 37 first-order administrative units, sourced from GRID3 through geoBoundaries (2022 boundaries, CC BY 4.0), not hand-drawn approximations. Names and internal IDs are normalised to the NSM registry (`NG-AB` … `NG-ZA`, including `NG-FC`).
- **Command-centre layout.** Intelligence wire (left), map (centre), national brief (right) and an analytical strip (bottom). Every statistic is computed from the loaded dataset; none are hardcoded dashboard figures.
- **State intelligence.** Hover, select, keyboard state picker, URL state (`?state=NG-IM`), state brief with category/severity breakdowns, latest reported events and a direct link into that state's zone profile.
- **Event intelligence concepts.** Demo events carry sources, independence groups, verification status, confidence, occurrence/report times, LGA, coordinates and precision, and a timeline. One event can hold multiple sources.
- **Regional intelligence.** A six-zone comparison with switchable metrics (reported volume, severity 4–5 share, corroborated share, state coverage), selectable zone profiles, 7/14/30-day trends, category/severity/verification panels, state coverage, recent events and source coverage. Zone views are URL-addressable (`?view=regions&region=south-west&trend=14`) and can be applied as a dashboard zone filter. Regional volume is always labelled as *reported event volume*, never as a risk score.
- **Search and filters.** Full-text search over states, LGAs, events and categories; category, severity, zone, state and time-window filters.
- **Low-bandwidth mode.** An inline SVG map (no MapLibre, no external tiles), reduced motion, chart animation disabled and a compact data payload including a CSS-only regional trend. Manual toggle persisted in `localStorage`; auto-detected from `navigator.connection` when available.
- **Honest status.** The header states that the dashboard is a static fictional dataset with no live feed, AI enrichment or realtime channel. Capture runs through the CLI and does not publish events. No fake live ticker.
- **Production data foundation.** Ten paired Postgres/PostGIS migrations with checksummed rollback, 37 authoritative state boundaries, guarded demo and registry seeds, a SQL repository behind the same API boundary, and public RLS read models that exclude demo rows. Local verification runs the actual PostGIS extension, round-trips all 74 demo events exactly, and proves anonymous raw-table access is denied.
- **Ingestion capture with a review boundary.** Premium Times RSS is fetched with HTTPS/allow-list, redirect revalidation, timeout, byte and content-type limits. Items are validated, deduplicated, hashed, classified with deterministic priors and written to `ingestion_candidates`. The source is restricted: headline, short excerpt, timestamps, attribution and link only. No event is created automatically. See `docs/INGESTION.md`.
- **Reviewer decisions with an audit trail.** A server-side CLI lists the queue and accepts or rejects a candidate with a stable reviewer ID and rationale. Acceptance requires a resolved category and state; a correction clears a stale LGA. Decisions are transactional, append-only and server-only. Acceptance remains evidence review, not verification or publication: the event and verification paths are separate.
- **Clustering gate, not similarity alone.** `src/lib/clustering/` requires distinct records, a resolved equal category, a resolved equal state and publication times within 72 hours before scoring. The score is `0.45 × title + 0.25 × entity + 0.20 × geography + 0.10 × time`; 0.86 or above may auto-attach only when the evidence is independent and no LGA or headline-number conflict exists, 0.70–0.86 goes to review, and below 0.70 stays separate. Same-publisher and shared-independence-group evidence can never auto-attach. No cluster is persisted or attached in this increment.
- **Verification state machine with a transactional audit trail.** `src/lib/verification/` validates reviewer-only transitions between `unassessed`, `single_source`, `multiple_sources`, `corroborated`, `official_confirmation`, `disputed` and terminal `retracted`. It counts distinct independence groups, not articles or publishers; `corroborated` requires explicit reviewer approval and at least two independent groups with no conflict; `retracted` requires recorded retraction evidence. `PostgresVerificationStore` updates an existing event, appends a `verification_change` timeline row and writes an `audit_logs` row in one transaction. It never creates or publishes an event and does not alter confidence.
- **AI enrichment boundary, disabled by default.** A provider receives only bounded title/excerpt metadata, never the full article. The response must be strict JSON; categories, states and LGAs are checked against the authoritative registry and gazetteer, and location evidence must appear verbatim in the supplied text. Severity, coordinates, verification status, event identity and URLs are rejected. Valid proposals are stored in the append-only `ai_enrichments` table with provider, model, prompt/schema versions, confidence and a raw-response SHA-256 hash; invalid output is not stored. The model cannot update a candidate, create an event, set verification status or publish. `AI_PROVIDER` defaults to `disabled`; `openai` and `openai-compatible` are implemented behind the same validation, and any other value fails loudly.
- **Supabase-ready hosted path.** PostGIS installs in the `extensions` schema; migrations set their own `search_path`; runtime SQL schema-qualifies PostGIS so the shared transaction pooler works without startup options. `DATABASE_SSL`/`DATABASE_SSL_CA`, `DATABASE_POOL_MAX` and `MIGRATION_DATABASE_URL` are supported, and `db:doctor` checks connection, SSL, pooler mode, PostGIS schema, migration checksums, RLS, privileges, active snapshot and the repository read path. No hosted project has been run.
- **Production-safe map assets.** MapLibre's worker is served locally from `public/maplibre/maplibre-gl-worker.mjs` and refreshed by `scripts/copy-maplibre-worker.mjs` during dev/build. The standard map does not depend on a CDN, tile service or remote font.

## Current verification

Verified on 7 November 2026 in a clean install (typecheck, lint, 470 tests, local database check and production build all pass):

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Pass |
| ESLint | `npm run lint` | Pass |
| Unit / RTL / PostGIS | `npm run test` | 470 tests across 71 files |
| Local database | `npm run db:verify:local` | 10 migrations applied and rolled back; 37 states, 8 sources, 74 events; review-queue, reviewer-audit, AI-enrichment and verification-transition RLS verified |
| Production build | `npm run build` | Pass; `/` First Load JS 209 kB (Economy and History dialogs load on demand) |
| Browser acceptance | `npm run test:e2e` | 5 passed, 3 desktop-only specs intentionally skipped in the mobile project |

The local database run uses PGlite 0.5.15 with PostGIS 3.6 because no Docker/Postgres daemon is installed on the build machine. It is a real PostGIS build and the application uses the same SQL and repository mapping as `pg` in deployment. The hosted Supabase connection path is covered by 12 pooler/SSL/search-path/config unit tests, but a hosted project, transaction pooler and backup restore remain unverified.

The Playwright configuration uses the installed Google Chrome (`channel: "chrome"`) because browser downloads are blocked in this environment. Set `PLAYWRIGHT_CHANNEL` to another installed Chromium channel if needed. `npm run test:e2e` runs `npm run build` first and then starts `next start`; it exercises the compiled production server so dev-mode route compilation cannot masquerade as a product timeout. Port 3000 must be free unless `PLAYWRIGHT_REUSE_SERVER=1` points the suite at an existing server. The Phase 3 acceptance audit at 1440×900 and 390×844 covered 37/37 SVG states, MapLibre canvas/local worker, hover/click/URL/brief, six-zone comparison, zone profiles, trend switching, brief-to-zone entry, methodology, deep links, clean console and no horizontal overflow.

## Phase 5 verification — capture, review, AI, clustering and verification increment

Capture was verified on 5 November 2026 against the live Premium Times feed; reviewer decisions and the AI boundary on 6 November 2026; and the clustering/verification boundary on 7 November 2026 against deterministic fixtures. No hosted review run, live AI call or production publication is claimed.

| Gate | Command | Result |
| --- | --- | --- |
| Live dry-run | `npm run ingest:dry-run` | 15 items fetched; 9 accepted, 6 rejected; 4 pending, 5 needs review; no writes |
| Live review-queue write | `npm run ingest:local` | 9 articles and 9 candidates inserted into ephemeral PGlite/PostGIS; 4 pending, 5 needs review; 6 rejected |
| Reviewer decisions | `npm run test` | Accept, reject, correction, repeated-decision refusal, append-only audit and zero events covered by PGlite/PostGIS |
| AI enrichment contract | `npm run test` | Disabled default, fail-loud configuration, strict schema, registry/gazetteer and exact-evidence checks, hashing, duplicate/rejected guards, append-only storage and zero events |
| Clustering gates | `npm run test` | Category/state/time gates, 72-hour boundary, distinct-record refusal, LGA and headline-number conflict caps, same-publisher/syndication non-independence, 0.86/0.70 thresholds and no mutation |
| Verification transitions | `npm run test` | Allowed/terminal transitions, independent-group counting, official confirmation, reviewer-approved corroboration, retraction evidence, invalid reviewer/rationale, transactional event/timeline/audit rows, unchanged event count and RLS |
| Idempotency / health / RLS | `npm run test` | Covered by the PGlite ingestion, review, AI and verification integration suites |
| Migration and rollback | `npm run db:verify:local` | 10 migrations applied and rolled back; review-queue, reviewer-audit, AI-enrichment and verification RLS verified |

The live feed composition changes continuously; these counts describe the observed run. A post-`0009` recheck on 6 November fetched 15 items and inserted 6 candidates (2 pending, 4 needs review) with 0 duplicates and no event. The source is **restricted**, not approved for republication. No live AI call, candidate-to-event publication, hosted database write or scheduler run is claimed. Reviewer acceptance is evidence review only; verification transitions apply only to an already-existing event.

## Next: operational steps before anything is live

The code for Phase 5 exists; what is missing is running it for real:

1. Create the hosted Supabase project (`docs/SUPABASE_SETUP.md`), then `npm run db:doctor` and `npm run db:setup:registry`.
2. Set `REVIEWER_CREDENTIALS`, `REVIEWER_SESSION_SECRET` and `CRON_SECRET` (see `.env.example`).
3. Run `npm run ingest:dry-run` from a machine with open internet access and confirm the Premium Times feed fetches.
4. Choose an AI provider (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`) and record one real enrichment call.
5. Rehearse RLS with real Supabase roles, obtain publisher permission, then enable the scheduler.

Phases 6–8 are implemented in code (economy, history, offline). Still to do: state and zone level economic series, a persisted economic dataset in the database, a Supabase Realtime channel, cross-browser CI, accessibility audits and performance gates (Phase 9). Run `npx playwright test` on a normal machine or CI before deploying: in the build sandbox the software-rendered browser stalled on some desktop steps for both the original and this version, so those results could not be treated as conclusive.

## Architecture at a glance

```
Next.js App Router (React 19, TypeScript strict)
  ├─ Server components: shell, initial dataset, SEO
  ├─ Client dashboard: Zustand filters + TanStack Query health/search/regional
  ├─ MapLibre GL + GeoJSON (standard) / inline SVG (lite)
  └─ API routes (Zod validated, cache headers, rate limit)
        └─ Repository interface
             ├─ Demo: deterministic in-memory snapshot (default)
             └─ Postgres/PostGIS: guarded demo or production snapshot

Phase 5 CLI evidence path (not in request handlers)
  RSS → strict fetch/parse → validate/scope → deterministic priors
      → review queue (ingestion_candidates)
      → reviewer accept/reject → append-only candidate_reviews
      → optional AI proposal → validated JSON → append-only ai_enrichments
          (provider disabled by default)
      → clustering gate + score (pure; no cluster persistence yet)
      → verification transition on an existing event
          → events + event_updates + audit_logs (one transaction)
      → [future] candidate-to-event publication
```

See `docs/ARCHITECTURE.md` for the full design, `docs/DATA_SOURCES.md` for verified data access, and `AGENTS.md` for contribution rules.

## Geographic attribution

State boundaries: **GRID3 Nigeria State Boundaries v2** (2022), distributed by **geoBoundaries** (`NGA-ADM1`), licensed **CC BY 4.0**. LGA boundaries used for the gazetteer: **GRID3 Nigeria LGA Boundaries**, via geoBoundaries `NGA-ADM2` (774 units), CC BY 4.0. NSM does not redraw or approximate Nigeria's borders.

## Important limitations

- The dashboard UI is still populated by the fictional demo dataset. Phase 5 ingestion writes to a review queue and does not publish events or alter the dashboard.
- The demo dataset is a static snapshot; it is not live intelligence.
- Premium Times ingestion is **restricted**: headline, short excerpt, timestamps, attribution and link only. No full text, images or author PII. Publisher permission is required before production publication.
- The ingestion classifier is deterministic and English-only. Ambiguous or low-confidence items are sent to review, not guessed.
- Reviewer authentication, the `/review` console, cluster persistence, verification and publication exist in code but have never been exercised against a hosted database or a real reviewer session. `AI_PROVIDER` is `disabled` by default and no model call is claimed.
- The Postgres schema and repository are verified locally and the Supabase connection path is implemented, but no hosted database, migration run or backup restore has been performed.
- Raw reporting volume is not incidence, risk or safety. NSM labels it as reported volume, including in all six-zone comparisons and trends.
- Regional comparisons exclude national-scope records and describe only the active filters; a zone or state with no records is unobserved, not safe.
- Event coordinates are only as precise as their evidence: `exact`, `lga` (LGA centroid fallback) or `state` (state representative point fallback). The UI always displays precision.
- No claim of complete historical coverage is made; history begins when ingestion begins.
- Playwright runs against an installed Chrome channel in this environment. A clean CI runner must install Chrome/Chromium or provide `PLAYWRIGHT_CHANNEL` before the acceptance suite can run.

## Documentation

| Document | Purpose |
| --- | --- |
| `docs/ARCHITECTURE.md` | System design and phase plan |
| `docs/DATA_SOURCES.md` | Verified geography, news and economic sources |
| `docs/INGESTION.md` | Phase 5 RSS capture, review queue, commands and limits |
| `docs/DATABASE_SCHEMA.md` | Postgres/PostGIS schema and retention |
| `docs/SUPABASE_SETUP.md` | Hosted Supabase project, pooler, SSL, setup and troubleshooting |
| `docs/AI_PIPELINE.md` | Ingestion, classification, AI enrichment boundary, clustering and safeguards |
| `docs/API_DOCUMENTATION.md` | API contracts and error format |
| `docs/TESTING.md` | Test strategy and commands |
| `docs/PERFORMANCE.md` | Budgets and low-bandwidth design |
| `docs/SECURITY.md` | Threat model and data governance |
| `docs/DEPLOYMENT.md` | Local, CI and production deployment |
| `docs/PHASE_1_RESEARCH.md` | Source verification log and decisions |
| `AGENTS.md` | Rules for AI coding agents |

## Licence and data ethics

Application code is private until a licence is chosen. Geographic data retains its CC BY 4.0 attribution. News content remains the property of its publishers. Phase 5 stores only metadata, a short excerpt, attribution and a link for Premium Times under a restricted policy; obtain publisher permission before production publication.


## Known issues (found by running the full pipeline against a real PostgreSQL, 9 November 2026)

- **Demo wording in production mode: fixed 9–10 November 2026.** A shared `DatasetLabels` helper (`src/lib/dataset-labels.tsx`) and a `mode` argument on the generated summaries (`nationalSummary`, `zoneProfile`, `buildRegionalIntelligence`) now drive the wording. A browser scan of the production-mode app found 0 demo or fictional phrases on the main page and in the Regions, States, Economy, History and Search dialogs. Guard against regressions with `rg -i "demo|fictional" src/components src/lib/intelligence` and check each hit is conditional on the mode. Production records still have no assessed confidence (stored as 0); the UI says "Confidence not assessed".
- **Production records have no assessed confidence yet** (stored as 0). The UI now says "Confidence not assessed" instead of "0%".
- **31 sources are registered and on by default** (`INGESTION_SOURCE=all`): 22 publisher feeds (four are politics sections only), NiMet's official alert feed and 8 GDELT queries, each with an evidence label, robots.txt enforced on every direct fetch, per-source failure isolation, a circuit breaker, and `INGESTION_DISABLE` to remove one instantly. Add a site with `npm run sources:add -- site.ng` or by editing `src/config/extra-sources.json`. **Publishing is automatic** (AI or rules classify, duplicates are attached, nothing is reviewed by a person): see `docs/AUTOPUBLISHING.md`. **Going live needs no terminal**: see `docs/GO_LIVE.md` (protected setup address, configuration review, scheduler). No publisher text is shown by default (`PUBLISHED_EXCERPT_CHARS=0`; see `docs/TERMS_REVIEW.md`). The product goal and next layers are in `docs/NIGERIAN_WORLD_MONITOR_ROADMAP.md`. This is still not all Nigerian news. No feed has been fetched from the build sandbox; run `npm run sources:check`.

What was verified end to end: migrations (11/11) and registry seeding on PostgreSQL 16 + PostGIS 3.4, ingest, idempotent re-run, review accept, publish, clustering (same-publisher duplicate flagged "not independent corroboration"), and the dashboard reading the published events in production mode. The feed used was synthetic because the build sandbox could not reach Premium Times, so real feed parsing remains unverified.
