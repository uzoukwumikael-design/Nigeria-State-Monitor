# Security and Data Governance

## 1. Threat model

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Malicious RSS/HTML content | XSS, parser abuse | Parse as data only; strict RSS 2.0; DTD/ENTITY declarations rejected; markup, scripts and images stripped; one-pass entity decoding; no `dangerouslySetInnerHTML`; no article-page fetch |
| Malicious feed URL or redirect | SSRF | HTTPS only; exact host allow-list; allow-list revalidated on every redirect; credentials and non-default ports rejected; one request per run. DNS-rebinding/private-IP pinning is **not** implemented yet |
| Prompt injection in articles | Bad enrichment | Schema-bound output, article treated as data, exact-evidence validation, no tool use and no database handle in the provider. Only the disabled provider is implemented; a real-provider injection test is still required |
| API abuse/scraping | Cost, availability | Fixed-window rate limiting (shared through Upstash Redis when configured, per-instance otherwise), max limits, caching, bot protection in production |
| Credential leakage | Data breach | Server-only env vars, no secrets in client bundle, secret scanning in CI |
| Unauthorised writes | Data integrity | RLS deny-by-default, service-role server only, CLI-only reviewer decisions, append-only audit. Reviewer authentication is not implemented yet |
| Demo/production mixing | False intelligence | DB guard + repository mode + response meta + UI banner + production assertion |
| Location harm | Physical risk | Precision caps, no exact coordinates for sensitive/vulnerable cases, review policy |
| Supply chain | Code execution | Pinned lockfile, `npm audit`/Dependabot, minimal dependencies, review new packages |
| Boundary/political misuse | Reputational | Source attribution, administrative-reference disclaimer, no political claims |
| Publisher copyright | Legal/reputational | Restricted-content policy: metadata, bounded excerpt, attribution and link only; no article body, images or author PII; publisher permission required before production publication |

## 2. Controls

### Application
- Strict TypeScript, Zod at every boundary (API query, upstream payload, LLM output).
- CSP: `default-src 'self'`; no third-party scripts in the demo build; MapLibre bundled locally; images `self data:`; connect only to same origin. Worker/blob allowances added only if required and documented.
- Security headers: HSTS (production), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- No `eval`, no unsanitised HTML. Tooltip content is escaped; React text nodes preferred.
- URL validation for outbound article links; `rel="noopener noreferrer"`, allowlist `https`.
- Request ID on every API response for traceability; no stack traces to clients.

### Ingestion fetch (Phase 5 capture)
- One feed retrieval per run (at most three revalidated redirect hops). The CLI never fetches article pages and never follows links found inside feed content.
- Feed and article URLs must be HTTPS. Credentials, non-default ports and hosts outside the source allow-list are rejected.
- Redirects are followed manually, up to three hops, and every `Location` is revalidated against the same allow-list. A redirect to another host fails the run.
- Requests use a truthful `NigeriaStateMonitor/0.1` User-Agent, `credentials: omit`, `cache: no-store`, a 20-second timeout, a 2 MB byte ceiling and a strict RSS/XML content-type check.
- The parser rejects DTD and entity declarations, malformed XML, non-RSS documents and empty channels. This blocks entity-expansion and external-entity attacks.
- Only a SHA-256 of the feed bytes is recorded. The raw feed payload, full article text, images and author PII are not stored.
- Failures are recorded in `ingestion_logs` and `source_health`; the failure path cannot create an article or candidate.

### Secrets and access
- `.env.local` never committed; `.env.example` documents names only.
- `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `NSM_INGESTION_CONTACT`, `INGESTION_SHARED_SECRET`, `AI_API_KEY`, `HF_API_TOKEN` and any Supabase service-role key are server-only. The current repository reads the Postgres connection directly; browser components receive no database driver or credentials. AI variables are reserved until a provider is implemented.
- `DATABASE_URL` is the runtime connection (Supabase shared transaction pooler on serverless). `MIGRATION_DATABASE_URL` is the admin connection (session pooler or direct) and is never read by the application runtime.
- Hosted connections encrypt in transit. `DATABASE_SSL=require` encrypts without CA validation; `verify-full` plus `DATABASE_SSL_CA` validates the certificate chain. `db:doctor` warns when a Supabase host has SSL disabled or certificate verification is off.
- `DATABASE_POOL_MAX` is bounded (1–20) and should be `1` on serverless to avoid exhausting database connection slots.
- Least-privilege database roles; no direct writes from browser.
- Public read models expose published, non-demo records only. Anonymous roles have no SELECT grant on raw tables.
- Reviewer decisions are CLI-only and require a stable operator ID. Each decision updates the candidate and inserts into the append-only `candidate_reviews` table in one transaction, recording previous/new status, previous/new category and state, reviewer, action, rationale and timestamp.
- `candidate_reviews` has no update/delete grant for `service_role`, and an update trigger raises. Reviewers cannot reopen a decided candidate in this increment.
- Reviewer authentication and security-definer write RPCs are not implemented. The CLI must run server-side with the admin database URL; do not expose a review endpoint until authentication and authorisation exist.
- Verification transitions are reviewer-input only and apply to an existing event. One transaction updates `events`, appends `event_updates` and inserts an `audit_logs` record containing the reviewer ID, rationale, rule version and evidence counts. The store never creates or publishes an event or changes confidence.
- `event_updates` and `audit_logs` are server-only (`anon`/`authenticated` denied) but do not yet have database-level append-only triggers; only the application store's insert path is currently exercised. Do not expose a write endpoint before authentication and append-only enforcement exist.

### Data
- RLS is enabled on every application table; published views only for anonymous/authenticated reads.
- The ingestion review queue (`ingestion_candidates`) is server-only: RLS enabled, `anon` and `authenticated` revoked, `service_role` granted. It has no public view.
- The AI enrichment table (`ai_enrichments`) is server-only and append-only: RLS enabled, `anon`/`authenticated` revoked, `service_role` read/insert only, and an update trigger raises. No public view exposes it.
- Verification writes only server-only tables (`events`, `event_updates`, `audit_logs`). No public write view or reviewer RPC exists; the published timeline view remains read-only and excludes demo rows.
- Capture can only write `pending`, `needs_review` or `rejected`. Acceptance requires a reviewer identity, timestamp, resolved category and resolved state; no code path can create an event from a candidate. Acceptance is not verification or publication.
- Demo/production repositories compare row counts before serving and refuse mixed data. The demo seed also refuses non-demo records.
- Article content: metadata + short excerpt; respect publisher terms and robots. Premium Times is `restricted` at a 320-character excerpt; see `docs/DATA_SOURCES.md`.
- PII minimisation: no names of private individuals in demo data; production extraction avoids unnecessary personal data. Do not expose home addresses, precise locations of vulnerable people, or active security force positions.
- Retention as documented in `DATABASE_SCHEMA.md`; purge functions exist but scheduling and deletion logging remain operational work.
- Encryption in transit (TLS) and at rest (Supabase target). Backups encrypted. Hosted backup/restore is not yet verified.
- PostGIS is installed in the `extensions` schema. Runtime SQL schema-qualifies it, so the shared transaction pooler cannot silently resolve the wrong function or type.
- Demo data is impossible to publish through the current repository: `NSM_MODE=production` requires Postgres and rejects `is_demo`, and public views filter demo rows even inside a demo database.

## 3. AI-specific governance

The boundary is active; no live model is. `AI_PROVIDER` defaults to `disabled`, any other value fails loudly, and no API key is required or read. The following controls apply to the implemented proposal path:

- A provider receives bounded text and returns text only. It has no database handle, tool access or event-write path.
- The proposal schema is strict. Severity, coordinates, verification status, event identity and URLs are rejected; unknown values must be `null`.
- Geography is checked against the authoritative state registry and LGA gazetteer, and location evidence must appear verbatim in the title or excerpt.
- Invalid output is not stored. Raw response text is never persisted; only its SHA-256 hash is stored, together with provider, model, prompt version, schema version, confidence and processing time.
- `ai_enrichments` is append-only and server-only. AI output cannot update a candidate, create an event, set verification status or publish.
- Publication and the attaching of repeat reports to existing events are automatic by the owner's decision (see AUTOPUBLISHING.md). Automatic paths are audited under `system.autopublish`, never assign severity above 3, and never set "corroborated" or "official confirmation". Those statuses still need a recorded human transition. `AUTOPUBLISH=off` stops the automation.
- AI analysis is not mixed into a factual summary and is not surfaced in the current dashboard.

Not yet active:

- A live provider, API-key handling, per-provider retention terms and data-processing review.
- Real-provider prompt-injection regression tests.
- Bias monitoring of state/category coverage, false merges and severity distribution.
- No use of article text for model training by NSM; this must be confirmed in the provider agreement before enabling a live provider.

## 4. Operational

- Rate limiting at edge and app.
- Dependency and container scanning; lockfile integrity.
- Backups and restore drills; point-in-time recovery.
- Incident response: revoke keys, rotate secrets, preserve audit logs, publish correction if data integrity affected.
- Logging excludes secrets and full article bodies; IPs hashed after 30 days.

## 5. Content and ethical policy

- Allegations remain allegations; verification status and uncertainty always visible.
- Do not rank states as "most dangerous" or derive risk scores from reporting volume.
- Do not present AI text as verified fact.
- Correct errors with visible event updates and a retraction state.
- Provide source links and attribution on every event.
- Publish a public methodology page before production launch.
- Captured articles are evidence for review, not incidents. Never present a candidate count as an event count.

## 6. Pre-production checklist

- [x] Demo/production separation tested with PGlite/PostGIS
- [x] RLS tested locally with an anonymous role; raw table access denied
- [x] Review-queue RLS tested: `anon`/`authenticated` denied, `service_role` allowed
- [x] Supabase connection config (pooler, SSL, search path, pool size) unit-tested
- [x] `db:doctor` implemented for hosted connection/SSL/PostGIS/migration/RLS preflight
- [x] HTTPS/allow-list feed guard and redirect revalidation tested
- [x] Premium Times robots.txt, terms and copyright reviewed; recorded as restricted
- [ ] Hosted Supabase roles, connection pooler and backup restore verified
- [ ] Private-IP/DNS-rebinding pinning added to the feed fetcher and tested
- [ ] Publisher permission or syndication licence obtained before production publication
- [ ] Secrets scan and dependency audit clean
- [ ] CSP verified with no console violations
- [ ] Rate limits load-tested
- [ ] Input fuzzing on API query schemas
- [x] Reviewer audit trail implemented and verified
- [x] AI enrichment boundary implemented: disabled default, strict schema, append-only server-only storage
- [x] Verification state machine and transactional event/timeline/audit store implemented and verified
- [ ] Verification CLI/UI and reviewer authentication/authorisation implemented and verified
- [ ] Live AI provider, key handling and provider data-processing review
- [ ] Real-provider prompt-injection and model-output evaluation
- [ ] Retention jobs scheduled and tested
- [ ] Privacy/location-ethics review signed off
