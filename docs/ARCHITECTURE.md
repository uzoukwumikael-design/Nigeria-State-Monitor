# NSM Architecture

**Status:** Phase 4 (Postgres/PostGIS data foundation) complete and locally verified. Phase 5 capture, reviewer decisions, the validated AI enrichment boundary, the clustering gate/scoring boundary and reviewer-only verification transitions are implemented for one source: Premium Times RSS → validated article evidence → deterministic priors → review queue → reviewer accept/reject with append-only audit, plus an optional schema-validated AI proposal stored with provenance and a pure cluster assessment. A reviewer-approved verification transition can update an existing event with a timeline and audit row. No live AI provider, cluster persistence/review, verification CLI/UI, reviewer authentication, event publication, economic data or hosted production ingestion is connected or claimed.

## 1. Design goals

1. **Geographically truthful** — authoritative GRID3 boundaries, explicit coordinate precision, no illustrative maps.
2. **Evidence-first** — article → event separation, source independence, verification state, uncertainty displayed.
3. **Nigeria-first** — low-bandwidth SVG mode, local fonts, no mandatory third-party tiles, mobile-first controls.
4. **Operable under failure** — source adapters isolated, ingestion outside request handlers, honest sync status, cached snapshots later.
5. **Composable** — repository boundary allows demo → Postgres without rewriting UI.

## 2. Runtime topology (target state)

```
                   ┌────────────────────────────────────────────┐
                   │  Next.js App Router (Vercel / container)   │
                   │  RSC shell + client dashboard + API routes  │
                   └───────────────┬────────────────────────────┘
                                   │ repository / REST
            ┌──────────────────────┴───────────────────────┐
            │         Supabase PostgreSQL 16 + PostGIS       │
            │  PostGIS in `extensions`, app tables in public │
            │  raw ingestion → articles → events → briefs    │
            │  economics, source health, audit logs          │
            └───────────────▲──────────────────────────────┘
                            │ service role / session pooler
        ┌───────────────────┴─────────────────────┐
        │     Ingestion + enrichment workers       │
        │ scheduler → adapters → normalise →       │
        │ dedupe → enrich → geocode → cluster →    │
        │ verification → publish                    │
        └───────────────────▲─────────────────────┘
                            │
       RSS/API (news, NEMA, NiMet, NBS, CBN, World Bank…)
```

Runtime request paths connect through the shared transaction pooler (port `6543`); admin commands use the session pooler or direct connection (port `5432`) via `MIGRATION_DATABASE_URL`. PostGIS is schema-qualified in runtime SQL, so pooled connections do not depend on startup options.

Phase 4 keeps the same UI contract behind the repository. Demo mode uses the in-process deterministic repository by default; `NSM_REPOSITORY=postgres` serves either the guarded demo seed or a real production snapshot from PostgreSQL/PostGIS. No database is required to run the labelled demo.

## 3. Frontend structure

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 15 App Router, React 19 | Server shell, client islands |
| Language | TypeScript strict | `noUncheckedIndexedAccess`, `strict` |
| Styling | Tailwind CSS v4 + CSS tokens | No runtime CSS-in-JS |
| Primitives | shadcn-style components over Radix | Dialog, tabs, tooltip, switch, select |
| Icons | Lucide | Consistent 16/18px sizing |
| Motion | Framer Motion | Disabled in lite/reduced-motion |
| State | Zustand | Filters, selected state, lite mode |
| Server state | TanStack Query | Health, search, regional intelligence |
| Charts | Recharts | Lazy-loaded, animation disabled in lite; regional trend falls back to CSS bars |
| Standard map | MapLibre GL JS | Local GeoJSON only; no raster tiles |
| Lite map | Inline SVG generated with geometry | Zero map library |

### Dashboard composition

```
TopBar (brand • navigation • search • data status)
DemoBanner (only in demo mode)
├─ Left: IntelligenceWire (filters + event cards + pagination)
├─ Centre: KPI strip → MapPanel → AnalyticsStrip
└─ Right: NationalBrief / StateBrief
RegionalDialog (six-zone comparison, zone profile, trend range, zone filter)
Mobile: segmented view switch (Map | Wire | Brief | Stats) + filters drawer
```

Filtering is client-side over the current snapshot, so state selection is instant and low-bandwidth. Regional aggregates load through `/api/intelligence/regional` so the comparison contract is server-testable. The repository loads states, sources, events, evidence, timelines and relations in a fixed number of bulk queries — never one query per event — and the deterministic aggregate functions run over that typed snapshot. Pushing every aggregate into SQL remains an optimisation for later scale. The repository remains the only data entrance.

### Regional intelligence

- Six fixed zones from `src/lib/geo/zones.ts`; FCT remains in North Central.
- `zoneComparisons()` computes volume, severity 4–5 share, corroborated/official share, independent source groups, state coverage and a 7/14/30-day trend for all zones on one filter basis.
- `zoneProfile()` adds category, severity, verification, per-state coverage, recent events and source-tier panels plus a deterministic, labelled `automated_demo_summary`.
- Regional requests keep category, severity, verification, window and `q` filters but deliberately clear dashboard state selection and force `zone=all`; national-scope records without a state assignment are excluded from zone comparisons.
- The dialog is URL-addressable while open; a selected state brief can open its zone profile directly.
- Volume, zone ordering and every comparison metric are explicitly descriptive. No risk score or safety ranking is derived.

### URL state

`?state=NG-IM&category=security&window=7d&zone=north-west&event=evt-demo-0042&view=regions&region=south-west&trend=14`

Phases 2–3 sync the active filters, selected state, selected event and regional dialog state with `history.replaceState` for shareable views. `view=regions` opens the regional dialog; `region` selects a zone profile; `trend` accepts `7`, `14` or `30` days. `region` and `trend` are emitted only while the dialog is open. Invalid URL values fall back to the default view.

## 4. Map architecture

**Source of truth:** `research/nga-adm1.geojson` → `scripts/build-geo.mjs` → normalised, simplified, validated outputs.

- 37 features matched by `geoName` to `src/data/state-registry.json`; no fuzzy name fallback in production build.
- Simplification: Ramer–Douglas–Peucker at 0.005° for the web layer; validation checks area ratio and vertex count so simplification cannot silently destroy a state.
- Labels: polylabel interior points, collision-avoided at runtime in MapLibre; fixed labels in the SVG map.
- MapLibre style has a background layer only; geometry is local. This avoids tile keys, external dependencies and works on constrained networks.
- Interaction:
  - hover → feature-state highlight + sanitised tooltip (name, reported events, top category, latest report time)
  - click → select state, update all panels, URL
  - selected/hover line layers, zone tint mode
  - keyboard: state picker combobox, state directory dialog, focus ring, Escape clears selection
- Markers: custom HTML markers with severity, category colour and screen-space clustering (`supercluster`). Critical markers pulse only in standard mode. Clusters expand on click.
- Coordinate precision: `exact` renders a point marker; `lga`/`state` use representative points and are described as approximate in every tooltip/detail.
- No coordinate is generated at runtime. All demo coordinates come from LGA/state centroids computed offline from GRID3 geometry.

**Lite mode:** inline SVG with Mercator projection generated offline. It contains the same 37 paths and event markers, supports selection and hover, and ships no MapLibre JS. Auto-enabled with `saveData`, 2G/slow-2G effective type, or `prefers-reduced-motion` + low memory (conservative). Manual override wins.

## 5. Backend and data (Phase 4)

- PostgreSQL 16 + PostGIS on Supabase is the deployment target; PGlite + PostGIS is the local verification database. Both run the same migrations and SQL, with PostGIS installed in the `extensions` schema.
- Repository interface: `MemoryDemoRepository` and `PostgresRepository` behind `src/lib/data/index.ts`. Components and API routes do not import demo data or the database driver directly.
- `NSM_MODE=demo|production` controls dataset identity. `NSM_REPOSITORY=memory|postgres` controls the backend. Production requires Postgres and rejects demo rows; demo Postgres mode refuses production records.
- The runtime reads `DATABASE_URL`; admin scripts prefer `MIGRATION_DATABASE_URL` and fall back to `DATABASE_URL`. SSL is inferred for Supabase and can be overridden with `DATABASE_SSL`/`DATABASE_SSL_CA`. Pool size is bounded by `DATABASE_POOL_MAX` (`1` on serverless).
- Eight paired migrations and rollbacks live in `supabase/migrations` and `supabase/rollbacks`. A checksum ledger prevents silent edits to applied SQL. Every migration sets `search_path = public, extensions`. The state registry is seeded from the checked-in GRID3 output, not hand-entered geometry.
- API routes validate with Zod, apply a token-bucket rate limiter, await the repository and return typed envelopes with cache headers. The repository maps numeric, timestamp, JSON and geography values explicitly instead of trusting driver coercion.
- PostGIS stores authoritative state boundaries and evidence-gated event points. Runtime queries schema-qualify PostGIS so transaction-pooled connections resolve correctly. Public read models exclude demo rows and expose only published, non-demo columns. RLS is enabled and raw tables are not granted to anonymous roles.
- `npm run db:doctor` is the hosted preflight: connection, SSL, pooler mode, PostGIS schema, migration checksums, RLS, raw-table privileges, active dataset and the repository read path. `db:verify` is the strict data/schema gate. See `docs/SUPABASE_SETUP.md`.
- Ingestion and AI work will run in workers, never in request handlers. No hosted project, worker, scheduler or production dataset is claimed in Phase 4.
- RLS: public views are server-owned read models; service-role writes stay in server/worker contexts. Reviewer decisions are CLI-only; there is no reviewer RPC or authenticated web path yet.
- Realtime remains future work. The client always reconciles with a REST snapshot rather than assuming an event stream is complete.

## 6. Source ingestion (Phase 5)

Implemented capture path:

```
CLI / future worker
  → strict HTTPS feed fetch (allow-list, redirect revalidation, timeout, byte cap)
  → RSS 2.0 parse (DTD/ENTITY rejected)
  → validate (title, canonical URL, dates, scope, Nigeria signal)
  → strip markup + bound excerpt (≤ source limit)
  → deterministic category/state/LGA priors
  → one transaction: raw_items + articles + ingestion_candidates
      + ingestion_logs + source_health
  → reviewer CLI: accept/reject with identity + append-only audit
  → optional AI proposal: strict JSON + registry/gazetteer checks
      → append-only ai_enrichments (provider disabled by default)
  → clustering gate + score (pure; no cluster persistence)
  → reviewer-approved verification transition on an existing event
      → events + event_updates + audit_logs in one transaction
  → stop (cluster persistence, verification CLI/UI and publication not implemented)
```

Future path, deliberately not implemented:

```
  → persist/review event_clusters
  → candidate-to-event publication
  → verification CLI/UI with reviewer authentication
  → publish event + event_sources + timeline
```

Guards:

- Candidate statuses are `pending`, `needs_review`, `rejected`. The capture pipeline cannot write `accepted` or create an event.
- Acceptance requires a reviewer identity, timestamp, resolved category and resolved state, and is written with an append-only `candidate_reviews` row. Acceptance is not verification or publication.
- Rejection requires a rationale; reviewer IDs are stable operator identifiers, not personal email addresses.
- A decided candidate cannot be re-decided in this increment; the attempt returns `already_decided`.
- Multiple states, unresolved states, unresolved categories and missing dates become `needs_review`, never a guess.
- `Niger` (country/state/delta), duplicate LGA names and out-of-scope feed sections are handled explicitly.
- Promoted, sports, entertainment and foreign sections are rejected before review.
- Only one feed retrieval is made per run (at most three revalidated redirect hops). Article pages are not fetched, so the publisher's copyright is not reproduced.
- `ingestion_logs` records every run; `source_health` records failures and recovery. Re-running the same feed is idempotent.

**Premium Times is restricted:** headline, ≤320-character excerpt, timestamps, attribution and link only. See `docs/DATA_SOURCES.md` and `docs/INGESTION.md`.

No hosted worker, scheduler, lock, retry loop, dead-letter replay or HTTP ingestion endpoint exists yet. The CLI runs manually.

## 7. AI layer (Phase 5+)

The enrichment boundary is implemented; a live provider is not. `AI_PROVIDER` defaults to `disabled`, and any other value raises `AiConfigurationError` rather than falling back. A provider receives only bounded title/excerpt metadata and returns text; it has no database handle. The response must be strict JSON matching a Zod schema, geography is checked against the authoritative registry and LGA gazetteer, and location evidence must be copied verbatim from the supplied text. Severity, coordinates, verification status, event identity and URLs are rejected. Valid output is hashed and stored as an append-only proposal in `ai_enrichments` with provider, model, prompt version, schema version, confidence and processing time; raw response text is not stored. Invalid output is not persisted. AI output never updates a candidate or creates an event. See `docs/AI_PIPELINE.md`.

### 7.1 Clustering and verification boundaries

`src/lib/clustering/` is a pure gate and score module. Category, geography and a 72-hour report window are hard gates; only then does the deterministic title/entity/geography/time score apply. A high score cannot override an LGA conflict, contradictory headline numbers, a shared publisher or a shared independence group. It does not persist `event_clusters` and does not attach anything.

`src/lib/verification/` is a pure state machine, and `src/lib/data/postgres/verification.ts` applies an approved transition to an existing event inside one transaction: the event status update is guarded by the previous status, then a `verification_change` row and an `audit_logs` row are appended. Reviewer identity and rationale stay in the server-only audit record; the timeline text is neutral. The store never creates an event, changes `published`, alters confidence or writes a public view. `event_updates` and `audit_logs` do not yet have database-level append-only triggers, so the store only inserts and the service role remains server-side. No verification CLI/UI or reviewer authentication exists.

## 8. Economic intelligence (Phase 6)

Separate tables and API namespace from events. Every observation carries value, unit, currency, reference period, publication date, source, status (`official | estimated | market | modelled`) and retrieved time. The release calendar and vintage are preserved. No derived comparison mixes periods without showing both. World Bank API was verified live; CBN/DMO/NBS require source-specific extraction and review. Market FX from `open.er-api.com` is labelled market-reported, never official.

## 9. Historical intelligence (Phase 7)

Events are append-only at the evidence layer; corrections create updates, not silent rewrites. Time filters are applied server-side. Coverage metadata (`ingestion_started_at`, per-source earliest record) is exposed so the UI can say "coverage begins …" rather than imply completeness. Historical charts use event occurrence time, not ingestion time, and label the difference.

## 10. Low bandwidth and offline (Phase 8)

- Phases 2–3 already: SVG lite map, CSS-only regional trend, local fonts, no tile requests, dynamic MapLibre/charts, pagination, reduced motion.
- Phase 8: service worker with app-shell precache, stale-while-revalidate for the last snapshot, IndexedDB for viewed state briefs, explicit `cachedAt` banner, offline queue for retry, and a connectivity indicator. Cached data never renders as live; the "as of" timestamp is always visible.
- Targets: initial HTML+CSS < 60 kB gzip; route JS excluding map < 220 kB gzip; map chunk lazy and excluded in lite; LCP < 2.5 s on Slow 4G mobile; API p95 < 400 ms national aggregates.

## 11. Security and governance

Server-only secrets, Zod validation, CSP, rate limiting, RLS, audit logs, source attribution, retention. No precise locations of vulnerable individuals or active security operations. Event coordinates are generalised to LGA/state when precision could endanger people. See `docs/SECURITY.md`.

## 12. Phase plan and exit criteria

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 1 ✅ | Research, registry, architecture, docs | Verified sources + 37-unit registry + docs |
| 2 ✅ | Map, core dashboard, demo data | All states interactive, accurate boundaries, filters/search/state brief work, mobile + lite mode verified |
| 3 ✅ | Regional intelligence module | Six zone profiles, comparisons, trends |
| 4 ✅ | Supabase/PostGIS backend | Migrations, checksums, rollback, registry/demo seed, repository, local RLS verified; Supabase pooler/SSL/`extensions` path implemented and unit-tested; hosted deployment remains an operational step |
| 5 | Ingestion + event intelligence | One real source end-to-end, cluster persistence/review, verification CLI/UI, publication path and reviewer authentication |
| 6 | Economic intelligence | Real indicator dataset with provenance + history |
| 7 | Historical intelligence | Date-range archive, coverage disclosure |
| 8 | Offline/low bandwidth | Service worker, cached snapshots, offline UX tested |
| 9 | QA/production readiness | Playwright suite, performance, security audit, deployment docs |

## 13. Key architectural decisions

| Decision | Rationale |
| --- | --- |
| GRID3/geoBoundaries ADM1 | Authoritative, 37 units, CC BY 4.0, stable download; no approximate drawing |
| Local GeoJSON, no basemap tiles | Accuracy, offline/low-bandwidth, no API keys, no external tile dependency |
| SVG lite map | Full interactivity at a fraction of MapLibre's cost |
| Demo repository behind an interface | Ship a working dashboard without faking production data; clean swap later |
| Event-level records with article links | Prevents article-count inflation; supports corroboration |
| No aggregate "risk score" | News volume cannot measure safety; avoids harmful rankings |
| Explicit precision enum | Honest cartography; prevents invented exact locations |
| Postgres + PostGIS in production, PGlite + PostGIS locally | Supabase portability with a runnable local verification database; same migrations and repository SQL |
| PostGIS in `extensions`, schema-qualified runtime SQL | Matches Supabase's extension layout and keeps the shared transaction pooler reliable even when startup `options` are ignored |
| Split admin/runtime connection strings | Migrations and seeds need a session/direct connection; serverless requests need the transaction pooler |
| Custom checksummed migration runner | Explicit rollback pairing and tamper detection; avoids depending on dashboard-only migration state |
