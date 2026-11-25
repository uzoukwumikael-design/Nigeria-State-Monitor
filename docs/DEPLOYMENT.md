# Deployment

**Status:** Phase 4 is implemented and locally verified. Phase 5 capture, reviewer decisions, the validated AI enrichment boundary, pure clustering gates and a reviewer-only verification store are implemented for one source. Capture writes a review queue and append-only audit, AI writes validated proposals, clustering is not persisted, and verification updates only an existing event; no path publishes an event. No live AI provider is enabled. The default demo runs with no database. The hosted Supabase connection path — pooler split, SSL, `extensions` schema, migrations, seeds, RLS and doctor — is implemented and unit-tested, but no Supabase project has been provisioned and no hosted or scheduled ingestion is connected. See `docs/SUPABASE_SETUP.md` for the hosted runbook, `docs/INGESTION.md` for capture and review, and `docs/AI_PIPELINE.md` for enrichment, clustering and verification.

## 1. Requirements

- Node.js 20+ (verified on 24.20).
- npm 10+.
- No database for the default `NSM_MODE=demo` + `NSM_REPOSITORY=memory` dashboard.
- PostgreSQL 16+ with PostGIS for the database-backed path. Supabase is the target host.
- `DATABASE_URL` and `MIGRATION_DATABASE_URL` are server-only Postgres connection strings. Never prefix them with `NEXT_PUBLIC_`.
- For Supabase: PostGIS in the `extensions` schema, the shared session pooler (port `5432`) for admin commands and the shared transaction pooler (port `6543`) for the runtime.

## 2. Local

```bash
cd nigeria-state-monitor
npm install
npm run dev
```

Windows note: if `npm.ps1` is blocked by execution policy, use `cmd /c "npm run dev"` or run from Command Prompt. This does not affect the app.

Environment: copy `.env.example` to `.env.local` only when a phase needs credentials. The demo dashboard works without it.

### Local database verification (no Docker)

```bash
npm run db:verify:local
```

This runs the real PostGIS extension in PGlite, applies all migrations, seeds the 37 states and 74-event demo snapshot, reads them through `PostgresRepository`, checks anonymous RLS access plus review-queue, reviewer-audit, AI-enrichment, verification-timeline and audit-table privileges, and rolls every migration back. PGlite is a verification database, not the application runtime.

### Run the app against a Postgres demo database

```bash
# .env.local
NSM_MODE=demo
NSM_REPOSITORY=postgres
DATABASE_URL=postgresql://...            # runtime; Supabase transaction pooler (6543)
MIGRATION_DATABASE_URL=postgresql://...  # admin; Supabase session pooler (5432)
DATABASE_SSL=require
DATABASE_POOL_MAX=1

npm run db:doctor
npm run db:setup   # migrate + demo seed + strict demo verification
npm run dev
```

The demo seed refuses a database containing production records. It is not a production seed.

## 3. Build and verify

```bash
npm run typecheck
npm run lint
npm run test
npm run db:verify:local
npm run build
npm start
```

The build must succeed with no TypeScript or ESLint errors. `research/` assets are not required at runtime. Vitest includes a Node-environment PostGIS integration suite; it does not require a running external database.

## 4. Vercel (target)

1. Import the repository; framework preset Next.js.
2. Set server env vars from `.env.example`; do not expose database credentials.
3. Node 20+.
4. Build command `npm run build`.
5. Runtime uses the Supabase shared transaction pooler (port `6543`) in `DATABASE_URL`, with `DATABASE_POOL_MAX=1` for serverless.
6. Run `npm run db:doctor` and `npm run db:setup` from a trusted admin/CI context **before** switching traffic. Do not run migrations from the Vercel build: parallel builds can race the checksum ledger.
7. Add custom domain + HSTS.
8. Configure Supabase backups/PITR and test restore before any production launch.

No Vercel deployment or Supabase project has been verified in this phase. See `docs/SUPABASE_SETUP.md` for exact strings, SSL and troubleshooting.

## 5. Container (alternative)

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Requires `output: "standalone"` in `next.config.ts` when containerising. Health endpoint: `/api/system/health`.

## 6. CI

```yaml
name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run build
```

`npm run test` includes the PGlite/PostGIS migration, seed, repository and RLS suite. Phase 9 adds Playwright on Chromium and performance budget assertions.

## 7. Database (Phase 4/5)

```bash
npm run db:doctor           # read-only connection/SSL/PostGIS/migration/RLS preflight
npm run db:setup            # migrate + demo seed + strict demo verification
npm run db:setup:registry   # migrate + 37 state boundaries + registry verification
npm run db:migrate          # apply + checksum migrations
npm run db:rollback         # roll back the latest migration
npm run db:rollback -- --steps=2
npm run db:rollback -- --all
npm run db:seed-registry    # authoritative 37 state boundaries
npm run db:seed-demo        # fictional demo data only
npm run db:verify           # hosted schema/RLS/count check (auto-detects mode)
npm run db:verify:demo      # strict demo expectation
npm run db:verify:registry  # strict registry-only expectation
npm run ingest:dry-run      # live feed fetch/classification; no writes
npm run ingest:local        # live capture into ephemeral PGlite/PostGIS
npm run ingest -- --source=premium-times   # persistent capture via the admin URL
npm run review -- --list    # review queue via the admin URL
npm run review -- --id=<id> --action=accept|reject --reviewer=<id> [--notes="..."]
```

Admin commands prefer `MIGRATION_DATABASE_URL` (Supabase session pooler or direct) and fall back to `DATABASE_URL`. The application runtime always uses `DATABASE_URL`.

Operational rules:

- Apply migrations with one runner at a time. Each file is transaction-wrapped; the ledger refuses edited history.
- Rollback scripts live in `supabase/rollbacks/`. Test rollback on a staging clone, never first on production.
- Seed state boundaries from `public/data/nigeria-states.geojson`, generated from the checked-in GRID3 source.
- Never run `db:seed-demo` with `NSM_MODE=production`; it refuses that mode and refuses a database containing non-demo records.
- RLS is enabled and anonymous table access is revoked. Public views expose published non-demo records only. The ingestion review queue and reviewer audit have no public view.
- PostGIS must live in the `extensions` schema; runtime SQL schema-qualifies it so the transaction pooler is safe.
- `service_role`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` and `NSM_INGESTION_CONTACT` remain server-only.
- Backups: Supabase PITR; test restore before launch.
- Ingestion capture and review are CLI-only. There is no scheduler, per-source lock, retry loop, cluster persistence/review or event publication path yet. Reviewer decisions are append-only and server-only; there is no reviewer authentication, UI or write RPC. Verification transitions are reviewer-input only, apply to an existing event and have no CLI/UI or reviewer authentication; `event_updates` and `audit_logs` are not yet append-only at the database level.
- Premium Times is restricted: headline, ≤320-character excerpt, timestamps, attribution and link only. Obtain publisher permission before production publication.

## 8. Background jobs

Implemented in code, not yet operated: `GET`/`POST /api/cron/ingest` runs one lease-protected ingestion of `INGESTION_SOURCE` and returns `503` until `CRON_SECRET` (16+ characters) is set. A scheduler must send `Authorization: Bearer <CRON_SECRET>`; Vercel Cron does this automatically when `CRON_SECRET` is defined as a project environment variable. `npm run scheduler` runs the same job from a terminal. Nothing is scheduled by default: enable it only after the database is migrated, a reviewer is configured and publisher permission is obtained.

Still not built: dead-letter review and replay tooling, alerting on repeated source failures or ingestion lag, and invoking retention functions on a schedule.

## 9. Environment matrix

| Variable | Phase | Exposure |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | 2 | public |
| `NSM_MODE` (`demo`/`production`) | 2/4 | server |
| `NSM_REPOSITORY` (`memory`/`postgres`) | 4 | server |
| `DATABASE_URL` | 4 | server only — runtime; Supabase transaction pooler |
| `MIGRATION_DATABASE_URL` | 4 | server only — admin; Supabase session pooler |
| `DATABASE_SSL` (`disable`/`require`/`verify-full`) | 4 | server only |
| `DATABASE_SSL_CA` | 4 | server only — PEM path |
| `DATABASE_SEARCH_PATH` | 4 | server only — defaults to `public,extensions` |
| `DATABASE_POOL_MAX` | 4 | server only — `1` on serverless |
| `NEXT_PUBLIC_SUPABASE_URL` | reserved | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | reserved | public |
| `SUPABASE_SERVICE_ROLE_KEY` | reserved | server only |
| `AI_PROVIDER` | 5 | server only — defaults to `disabled`; only `disabled` implemented |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `OLLAMA_*`, `HF_*` | 5 | server only — reserved; not read by this build |
| `NSM_INGESTION_CONTACT` | 5 | server only — optional User-Agent contact |
| `INGESTION_SHARED_SECRET` | 5 | server only — reserved; no HTTP endpoint yet |
| `UPSTASH_REDIS_*` | 4/5 | server only |

The current repository reads the Postgres connection directly, not the Supabase anon/service keys. Those names are reserved for later integration.

## 10. Production readiness gates

- Hosted PostgreSQL/PostGIS provisioned; migrations and rollback rehearsed.
- RLS verified with real Supabase roles; demo data blocked in production.
- At least one source captured end-to-end into review, reviewed, published through a publication path and then verifiable through an authenticated workflow. The publication path and reviewer authentication do not exist yet, so this gate cannot currently pass.
- Coverage limitations visible.
- Playwright suite green.
- Performance budgets met or deviations documented.
- Security checklist complete.
- Source licences reviewed; publisher permission obtained; methodology page published.
- Incident/rollback procedure tested.

Until these pass, NSM is a demonstration dashboard, not a production intelligence service.

## Offline mode, rate limiting and economy data (added after Phase 5)

- **Service worker.** `public/sw.js` is registered only in production builds. It never caches `/api/review`, `/api/cron`, `/api/system/health` or `/review`. It serves saved pages and API responses only when the network fails, labels them (`X-NSM-Served-From: cache`), and the dashboard shows a banner so saved data is never mistaken for live data. `/sw.js` is served with `no-cache`. The page registers `/sw.js?v=<build id>` (`NEXT_PUBLIC_BUILD_ID`, taken from `VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA` when present), and the caches are named after it, so every deployment starts clean and the previous deployment's caches are deleted on activation. After activation the page tells the worker which bundles it already loaded and the worker saves them plus the home page, so a first-time visitor can go offline straight away. Saved static assets are capped at 250 entries. Tabs left open across a deployment may fail to load not-yet-fetched chunks until reloaded.
- **Persistent rate limiting.** Create a free Upstash Redis database and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel. Without them the limiter is per serverless instance and therefore weak; if Upstash is unreachable the app falls back to the in-memory limiter and logs one warning.
- **Economy data.** No configuration is needed; the server fetches World Bank indicators directly. If your host blocks outbound requests, `/api/economy/indicators` returns `503` with reasons and the dashboard shows no figures rather than guessing.
