# Supabase Setup

**Status:** the Supabase connection, SSL, pooler, PostGIS-schema, migration, seed, RLS and verification path is implemented and covered by local tests. A hosted Supabase project has **not** been provisioned in this environment, so the exact hosted run below remains an operational step for you.

This guide connects a Supabase project to the existing Postgres/PostGIS repository. It does not enable a live AI provider, hosted ingestion or production data. The Phase 5 ingestion CLI can write captured articles and review candidates to this database, the reviewer CLI can accept or reject those candidates with an append-only audit, and the AI enrichment boundary can store validated proposals when a provider is implemented; `AI_PROVIDER` defaults to `disabled`. None of these creates events, and none is scheduled. The seeded dataset is the fictional demo dataset and is labelled as such in the UI.

---

## 1. Create the project

1. Create a Supabase project at <https://supabase.com/dashboard>.
2. Save the database password when prompted. If it is lost, reset it from **Project Settings → Database**.
3. Use a dedicated project for NSM. The migrations revoke table privileges from `anon` and `authenticated` and expect the public schema to belong to this application.
4. Wait until the project status is **Active**.

Use PostgreSQL 15+ with PostGIS. Supabase projects meet this requirement.

---

## 2. Enable PostGIS in the `extensions` schema

In the Supabase dashboard:

1. Open **Database → Extensions**.
2. Search for **postgis**.
3. Enable it and choose the `extensions` schema. Supabase normally creates this schema for you.

Or run this in the SQL editor:

```sql
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
```

Confirm the schema and version:

```sql
select e.extname, e.extversion, n.nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'postgis';
```

Expected: `postgis | 3.x | extensions`.

NSM migrations also run `create extension if not exists postgis with schema extensions`, so a fresh project can be set up by the migration itself. Enabling it first makes the doctor check cleaner and avoids permission surprises.

> Do not install PostGIS in `public`. The runtime qualifies PostGIS calls as `extensions.ST_*` and the migration/verify commands reject a different schema.

---

## 3. Get the two connection strings

Open **Connect** in the Supabase dashboard. You need two different strings:

| Purpose | Supabase mode | Port | Environment variable |
| --- | --- | --- | --- |
| Migrations, seeds, doctor, verify | Shared **session** pooler or direct connection | `5432` | `MIGRATION_DATABASE_URL` |
| Next.js runtime (especially Vercel/serverless) | Shared **transaction** pooler | `6543` | `DATABASE_URL` |

### Session pooler (recommended for admin commands)

```text
postgresql://postgres.[PROJECT-REF]:[URL-ENCODED-PASSWORD]@[POOLER-HOST]:5432/postgres
```

The username is `postgres.[PROJECT-REF]`, not just `postgres`, for shared-pooler connections. Copy the host from the dashboard; it is not derivable from the region.

### Transaction pooler (runtime)

```text
postgresql://postgres.[PROJECT-REF]:[URL-ENCODED-PASSWORD]@[POOLER-HOST]:6543/postgres
```

### Direct connection (optional)

```text
postgresql://postgres:[URL-ENCODED-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

Direct connections are IPv6 by default. Use the shared session pooler on an IPv4-only network, or enable the Supabase IPv4 add-on.

### Password encoding

Percent-encode reserved characters in the password before putting it in a URL. For example:

| Character | Encoded |
| --- | --- |
| `@` | `%40` |
| `:` | `%3A` |
| `/` | `%2F` |
| `?` | `%3F` |
| `#` | `%23` |
| `&` | `%26` |
| space | `%20` |

Never prefix either database variable with `NEXT_PUBLIC_`. They are server-only credentials.

---

## 4. Configure `.env.local`

Create `.env.local` in the project root:

```dotenv
NSM_MODE=demo
NSM_REPOSITORY=postgres

# Runtime: Supabase shared transaction pooler (port 6543)
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[URL-ENCODED-PASSWORD]@[POOLER-HOST]:6543/postgres

# Admin commands: Supabase shared session pooler (port 5432) or direct
MIGRATION_DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[URL-ENCODED-PASSWORD]@[POOLER-HOST]:5432/postgres

# Encrypt the connection. Use verify-full + DATABASE_SSL_CA for certificate validation.
DATABASE_SSL=require

# Serverless/Vercel: one connection per warm instance.
DATABASE_POOL_MAX=1
```

Optional certificate validation:

```dotenv
DATABASE_SSL=verify-full
DATABASE_SSL_CA=./supabase-ca.crt
```

Download the database root certificate from **Project Settings → Database → SSL Configuration**. `verify-full` without a CA uses Node's trust store; if the chain is not trusted, the connection fails with a certificate error and the CA path is required.

`DATABASE_SEARCH_PATH` defaults to `public,extensions`. NSM applies it as a startup option only to self-hosted direct/session connections. Supabase connections do not send the option; runtime SQL qualifies PostGIS and migration SQL sets its own `search_path`.

`sslmode`, `ssl`, `options`, `pgbouncer` and `connection_limit` query parameters are removed from the URL before `pg` sees it. Set SSL through `DATABASE_SSL`/`DATABASE_SSL_CA` and the schema path through `DATABASE_SEARCH_PATH`; this prevents a copied provider string from overriding the verified configuration.

`DATABASE_POOL_MAX` accepts `1`–`20`. Values above 20 are clamped; non-integers fail fast. Use `1` on Vercel and other serverless platforms unless measurements show queuing.

> The runtime never reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` yet. The current repository uses the Postgres connection directly.

---

## 5. Run the preflight doctor

```bash
npm run db:doctor
```

The doctor checks:

- the admin and runtime URLs separately when they differ;
- the pooler mode and SSL mode without printing the password;
- PostgreSQL connectivity and the current role;
- PostGIS version and that it lives in `extensions`;
- the migration ledger, checksums and pending migrations;
- required tables and RLS;
- raw-table privileges for `anon`/`authenticated`;
- the active dataset and the repository read path.

A connection-only pass before migrations is expected:

```text
PASS (connection only) — connection, SSL and PostGIS are usable; apply migrations next.
```

After setup it should finish with:

```text
PASS — connection, SSL, PostGIS, migrations, RLS and repository configuration are usable.
```

Warnings are actionable but do not necessarily fail the command. A failed check exits with code `1`.

---

## 6. Apply migrations and seed

For a hosted demo database:

```bash
npm run db:setup
```

This runs, in order:

1. `db:migrate` — all ten checksummed migrations through `MIGRATION_DATABASE_URL` (or `DATABASE_URL` if the former is absent).
2. `db:seed-demo` — 37 authoritative GRID3 state boundaries and the fictional 74-event demo snapshot.
3. `db:verify --expect=demo` — strict migration, data, RLS and public-view verification.

Expected verification summary:

```text
Migrations: 10/10 applied, checksums current
States: 37/37
Snapshots: demo:... (active)
Rows: 74 demo / 0 production events; 8 demo / 0 production sources
Anonymous views: 0 published events, 37 states, 0 evidence rows
Expectation: demo — all checks passed
```

For a production-oriented database without event data yet:

```bash
npm run db:setup:registry
```

This applies migrations, seeds the 37 state boundaries, and verifies that no dataset snapshot or event data is active. There is no production event seed. Phase 5 capture writes only review candidates, and reviewer decisions only accept or reject that evidence; a production snapshot can be served only after a verification and publication path exists and real events are published.

### Individual commands

```bash
npm run db:doctor
npm run db:migrate
npm run db:seed-registry
npm run db:seed-demo
npm run db:verify
npm run db:verify:demo
npm run db:verify:registry
npm run db:verify:local
npm run db:rollback -- --steps=1
npm run db:rollback -- --all
```

`db:verify` auto-detects the active snapshot: demo, production, or registry-only. Use `--expect=demo|registry|production` to make the expectation explicit.

### Optional: capture one real source into the review queue

After migrations, you can run the Phase 5 ingestion CLI against the same database:

```bash
npm run ingest:dry-run                          # fetch and classify; no writes
npm run ingest -- --source=premium-times        # write articles + review candidates
npm run ingest -- --source=premium-times --limit=10 --json
npm run review -- --list                        # inspect open candidates
npm run review -- --id=<candidate> --action=accept --reviewer=reviewer-01 \
  --category=security --state=NG-PL --notes="Headline and excerpt agree."
npm run review -- --id=<candidate> --action=reject --reviewer=reviewer-01 \
  --notes="Duplicate of an earlier report."
```

This writes `raw_items`, `articles`, `ingestion_candidates`, `ingestion_logs`, `source_health` and (on a reviewer decision) `candidate_reviews` only. It does not create an event, alter the demo snapshot or expose the review queue or audit trail to public views. Premium Times is restricted: headline, ≤320-character excerpt, timestamps, attribution and link only. There is no scheduler; run the CLIs manually and respect the publisher's crawl delay. Reviewer decisions require the admin connection and are not authenticated beyond possession of that connection.

---

## 7. Run the app against Supabase

```bash
npm run dev
```

Check the health endpoint:

```bash
curl http://localhost:3000/api/system/health
```

Expected fields:

```json
{
  "data": {
    "status": "demo",
    "mode": "demo",
    "repository": "postgres",
    "database": "connected",
    "counts": { "events": 74, "states": 37 }
  }
}
```

The dashboard still shows the demo banner. That is correct: the rows are fictional demo records, now served from Supabase through the Postgres repository.

---

## 8. Vercel deployment

Set these **server-side** environment variables in Vercel:

| Variable | Value |
| --- | --- |
| `NSM_MODE` | `demo` (until a real production snapshot exists) |
| `NSM_REPOSITORY` | `postgres` |
| `DATABASE_URL` | Supabase shared transaction pooler, port `6543` |
| `DATABASE_SSL` | `require` or `verify-full` |
| `DATABASE_SSL_CA` | path to the certificate if using `verify-full` with a CA |
| `DATABASE_POOL_MAX` | `1` |
| `NEXT_PUBLIC_SITE_URL` | your production URL |

`MIGRATION_DATABASE_URL` is only needed for admin commands. Do not run migrations as part of the Vercel build: parallel builds can race the checksum ledger. Run `npm run db:doctor` and `npm run db:setup` from a trusted local/CI environment before switching traffic.

If `DATABASE_SSL_CA` points to a file, include that file in the deployment bundle. The public root certificate is not a secret, but it must exist at the configured path at runtime.

Do not expose `DATABASE_URL`, `MIGRATION_DATABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY` to the browser. The app's CSP restricts `connect-src` to the same origin; the browser never receives a database credential.

---

## 9. RLS and access model

The migrations:

- enable RLS on all 18 application tables;
- revoke `SELECT` on raw tables from `anon` and `authenticated`;
- grant `SELECT` only on the public read models;
- grant server-side `service_role` table access for future workers;
- filter demo rows out of every public view;
- leave `_nsm_migrations` inaccessible to `anon`/`authenticated`.

The ingestion review queue (`ingestion_candidates`) has RLS enabled and no public view. `anon` and `authenticated` are explicitly revoked; only `service_role` is granted. The reviewer audit (`candidate_reviews`) is also server-only and append-only, granting `service_role` only `SELECT`/`INSERT`. The AI enrichment table (`ai_enrichments`) is server-only and append-only with the same read/insert-only grant. `db:verify` checks that all three tables exist with RLS enabled, and `db:verify:local` additionally proves the role privileges and update triggers.

The Next.js server connects as the database owner (`postgres`) through `pg`, so it reads the private tables directly. This is intentional in Phase 4. Browser clients must not connect to Postgres directly.

Any future migration that creates a table in `public` must enable RLS and revoke default `anon`/`authenticated` grants. Supabase can grant new public tables automatically, so a table created after `0006` is not protected just because the earlier migration revoked privileges.

Public read models:

- `public_states`
- `published_events`
- `published_event_sources`
- `published_event_updates`
- `public_economic_observations`

`db:verify` proves that anonymous users see 37 states, zero demo events, and zero demo evidence rows, and cannot select raw `events`.

If you later use the Supabase Data API instead of the direct repository, use the anon key in the browser and the published views only. Never ship the service-role key.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `password authentication failed` | Wrong password or unencoded reserved characters | Reset the database password and percent-encode it in both URLs. |
| `tenant or user not found` | Wrong pooler host/username, or paused project | Copy the full string from **Connect**; shared-pooler usernames are `postgres.[PROJECT-REF]`. |
| `getaddrinfo ENOTFOUND` / IPv6 timeout | Direct connection on an IPv4-only network | Use the shared session pooler on port `5432`. |
| `connection timeout` | Wrong port/host, firewall, or paused project | Check the pooler host and port; resume the project. |
| `prepared statement ... already exists` | Named prepared statements through the transaction pooler | NSM strips `pgbouncer`/`connection_limit` URL parameters and does not use named statements. Remove custom named queries. |
| `type "geometry" does not exist` | PostGIS missing or installed outside `extensions` | Enable PostGIS in `extensions`; run `npm run db:doctor`. |
| `function extensions.st_x(...) does not exist` | PostGIS not enabled | Enable PostGIS in `extensions`. |
| `permission denied for schema extensions` | Connected as `anon`/`authenticated` | Use the `postgres` connection string for the repository and admin commands. |
| `relation "states" does not exist` | Migrations not applied, or wrong project | Run `npm run db:migrate`; confirm the project ref in the URL. |
| `Pending migrations` | Schema behind the checked-in files | Run `npm run db:migrate`. |
| `changed after it was applied` | Checked-in migration SQL was edited after deployment | Restore the applied SQL or add a new migration; never edit history. |
| `No active demo dataset snapshot` | Database migrated but not seeded | Run `npm run db:setup` or `npm run db:seed-demo`. |
| `Demo repository refuses ... production records` | The project contains real rows | Use a clean project for demo mode, or switch to a real production snapshot and `NSM_MODE=production`. |
| `self-signed certificate in certificate chain` | `verify-full` without the Supabase CA | Set `DATABASE_SSL=require`, or download the CA and set `DATABASE_SSL_CA`. |
| `remaining connection slots are reserved` | Too many pool connections | Set `DATABASE_POOL_MAX=1` and use the transaction pooler for runtime. |
| Doctor says admin uses a transaction pooler | `MIGRATION_DATABASE_URL` is unset or wrong | Set it to the session (5432) or direct connection string. |

Useful read-only diagnostics in the SQL editor:

```sql
select current_user, current_database(), current_schemas(false);
select e.extname, e.extversion, n.nspname
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'postgis';
select version, applied_at from _nsm_migrations order by version;
select mode, version, is_active from dataset_snapshots order by mode, version;
```

---

## 11. Reset and rollback

On a dedicated disposable NSM project:

```bash
npm run db:rollback -- --all
```

This removes the application tables, views and functions, and then drops `postgis`/`pg_trgm`. It leaves the shared `extensions` schema in place. **Do not run `--all` against a shared Supabase project or a production database.** Supabase may use extensions for other services.

To reset only demo content without dropping the schema:

```bash
npm run db:seed-demo
```

The demo seed deletes only rows marked `is_demo` and refuses to run if production records or an active production snapshot exist.

---

## 12. What remains unverified

- No hosted Supabase project was available in this environment, so the commands above were not executed against a live project.
- The local gate uses PGlite 0.5.15 with real PostGIS 3.6 and the same migrations, SQL and repository mappings.
- Hosted backup/PITR restore, Vercel runtime networking and Supabase network restrictions have not been tested.
- The Phase 5 capture run was executed against an ephemeral PGlite database, not a hosted project.
- No production event, production snapshot or hosted ingestion schedule exists yet.
- Reviewer decisions are CLI-only and unauthenticated beyond the admin database connection; there is no reviewer UI or write RPC.

Run `npm run db:doctor` first against your project; it will tell you exactly which of these layers is not ready.
