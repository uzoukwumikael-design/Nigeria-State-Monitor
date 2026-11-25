# AI and Ingestion Pipeline

**Status:** capture, normalisation, validation, deterministic priors, reviewer accept/reject decisions, the AI enrichment contract/storage boundary, the clustering gate/scoring boundary and reviewer-only verification transitions are implemented for one RSS source. No live AI provider is enabled. Cluster persistence/review, a verification CLI/UI, reviewer authentication and event publication are **designed but not implemented**. The Phase 2–3 dashboard uses deterministic demo data and rule-based summaries, not an LLM. No model call is active.

## 1. Principles

- AI structures evidence; it does not create evidence.
- Deterministic checks before model calls: cheaper, auditable and resistant to hallucination.
- The model's output is a proposal validated by Zod and constrained by the gazetteer and source metadata.
- Every enrichment is versioned; every event has a traceable evidence trail.
- Uncertainty is a first-class output. "Unknown" is preferred over invented specificity.
- No article count inflation, no headline-driven severity, no AI text presented as confirmed fact.

## 2. Implemented evidence path

```
fetch one feed
  → strict RSS 2.0 parse
  → validate title, URL, dates, scope and Nigeria signal
  → strip markup and bound excerpt
  → deterministic category and state/LGA priors
  → one transaction: raw_items + articles + ingestion_candidates
      + ingestion_logs + source_health
  → reviewer CLI: accept/reject with a named operator
      + append-only candidate_reviews audit
  → optional AI proposal: validated JSON → append-only ai_enrichments
      (provider disabled by default; never writes candidates or events)
  → clustering gate + score (pure; no cluster persistence)
  → reviewer-approved verification transition on an existing event
      → events + event_updates + audit_logs in one transaction
  → stop. Candidate-to-event publication does not exist yet.
```

### 2.1 Collection

Only `premium-times` is enabled. One adapter performs:

1. An HTTPS GET with a truthful `NigeriaStateMonitor/0.1` User-Agent; one feed retrieval per run.
2. Manual redirects (max 3), each revalidated against the source allow-list.
3. A 20-second timeout, 2 MB byte ceiling and strict RSS/XML content-type check.
4. `fast-xml-parser` parsing with DTD/ENTITY declarations rejected before parse.
5. Raw item metadata: external ID, title hint, published hint, HTTP status, content type, fetched time and a SHA-256 of the feed item.

It does **not** use conditional GETs, retry automatically, follow article links, fetch article pages or run on a schedule. A failure is recorded and the run ends; there is no dead-letter queue.

### 2.2 Normalisation and validation

- Article URLs must be HTTPS, on the exact allow-list, credential-free and on the default port. Tracking parameters and fragments are removed.
- HTML entities are decoded exactly once; scripts, styles, images, comments and WordPress trailers are stripped; whitespace is collapsed.
- Excerpts are bounded by the source limit (320 characters for Premium Times). Full article text is never stored.
- Items with a missing title, invalid URL, unparseable date, promoted path/tag, out-of-scope section, duplicate URL/ID, future date or age beyond 30 days are rejected with a stable reason.
- A missing publication date is retained as `null` and forces `needs_review`; it is not invented.
- `rawHash` covers the source item fields. `contentHash` covers source slug + canonical URL and is the exact-duplicate key.
- No empty-body rejection is performed, because no body is fetched.

### 2.3 Duplicate and near-duplicate detection

Implemented:

- Exact duplicates within a run: repeated canonical URL or external ID → `duplicate_in_feed`.
- Exact duplicates across runs: `raw_items.payload_hash`, `articles.content_hash` and the unique article candidate prevent inflation.
- A pure near-duplicate assessment in `src/lib/clustering/`: distinct records, resolved equal category, resolved equal state and report times inside 72 hours are required before similarity is scored. LGA and headline-number conflicts cap the result at review; same-publisher and shared-independence-group evidence can never auto-attach.

Not implemented:

- Cluster persistence, `event_clusters` generation/review, candidate-to-event attachment and cross-source auto-merge.
- A semantic or embedding similarity path. The implemented score is deterministic and does not understand synonyms.
- Across sources, articles must never be auto-merged. Syndicated copies share an `independence_group` and cannot corroborate each other. This rule applies to any future implementation.

### 2.3.1 Reviewer decision boundary (implemented)

The server-side `npm run review` CLI is the only path that can move a candidate to `accepted` or reviewer-`rejected`.

- A reviewer must supply a stable operator ID and, for rejection, a rationale. Notes are bounded to 1,000 characters and contain no article body text.
- Acceptance requires an explicit category and state. Unresolved priors are corrected by the reviewer, never guessed. Changing the state clears a stale LGA.
- The status update is guarded by the candidate's previous status. A second decision returns `already_decided`.
- The candidate update and an append-only `candidate_reviews` audit row are written in one transaction. The audit records previous/new status, previous/new category and state, reviewer, action, rationale and timestamp.
- The audit table is server-only and update-protected; `service_role` has read/insert only.
- **No event is created, updated or published.** Acceptance is evidence review, not verification or corroboration. There is no reviewer authentication or web endpoint yet.

### 2.4 AI enrichment boundary (implemented, provider disabled)

The boundary exists so enrichment can be built and tested without letting a model write events. It is deliberately inert by default:

- `AI_PROVIDER` defaults to `disabled`. Only `disabled` (or an empty value) is implemented.
- Any other value raises `AiConfigurationError` at provider resolution. There is no silent fallback and no claim that a model is active.
- The disabled provider has no network code and throws `EnrichmentDisabledError` if called. `runEnrichment` returns `{ status: "disabled" }` before any provider or store call.

Implemented modules:

| Module | Responsibility |
| --- | --- |
| `src/lib/ai/provider.ts` | Provider interface resolution, disabled provider and fail-loud configuration |
| `src/lib/ai/prompt.ts` | Bounded request and system/user messages; article text is untrusted data |
| `src/lib/ai/schema.ts` | Strict Zod validation, geographic registry/gazetteer checks and evidence guards |
| `src/lib/ai/runner.ts` | Provider call, SHA-256 hash, validation and store orchestration |
| `src/lib/data/postgres/ai.ts` | Transactional persistence, deduplication and rejected-candidate guard |
| `supabase/migrations/0010_ai_enrichments.sql` | `ai_enrichments` table, RLS/grants and append-only trigger |

The provider receives only the source name/slug, original title, bounded excerpt, timestamps, prior category/state/LGA, the 37-state registry and the prior state's LGA list. The full article is never fetched or sent. The model is told that the title and excerpt are untrusted data and must not be followed as instructions.

The proposal is strict JSON with exactly these keys: `category`, `stateId`, `lga`, `confidence`, `locationEvidence`, `summary`, `entities`, `uncertainties`, `analysis`. Severity, coordinates, verification status, event identity, URLs and source URLs are rejected. Unknown values must be `null`; guessing is not accepted.

Validation enforces:

- Strict object shape, enum membership, length bounds, confidence in `[0, 1]`, no control characters and no URLs in any text field.
- `stateId` must exist in the authoritative 37-state registry. `lga` requires a state, must exist in the GRID3/geoBoundaries gazetteer for that state, and is stored using the gazetteer's canonical spelling.
- If `stateId` or `lga` is non-null, at least one `locationEvidence` phrase is required, and every phrase must appear verbatim (case/whitespace-normalised) in the supplied title or excerpt. A model cannot invent a location quote.
- Invalid output is returned to the caller with a stable validation code and is **not persisted**. Raw response text is never stored; only its SHA-256 hash is kept with the validated proposal.

Persistence:

- `ai_enrichments` is server-only, append-only and has no public view.
- A row stores `provider`, `model`, `prompt_version`, `schema_version`, the validated `proposal`, `confidence`, `raw_response_hash` and `processed_at`.
- Repeating the same `(candidate_id, provider, model, prompt_version, schema_version)` returns the existing row with `duplicate: true`.
- Rejected candidates are skipped before the provider call and guarded again by the store. Unknown candidates return `not_found`.
- The store never updates a candidate, creates an event, sets verification status or publishes anything. The candidate keeps its capture-time fields and the enrichment remains a proposal.

Not implemented:

- A live OpenAI-compatible, Ollama or Hugging Face transport. API-key handling, retries, timeouts, repair prompts, rate limits and cost accounting are absent.
- A persisted queue of enrichment runs, admin CLI/UI, confidence thresholds feeding `needs_review`, or surfacing proposals in the dashboard.
- Model evaluation and a real-provider prompt-injection test. The current tests use fixture providers.

### 2.5 Geographic resolution

Implemented deterministic priors:

1. State names, FCT aliases ("FCT", "Federal Capital Territory", "Abuja") and state capitals.
2. A curated secondary-city alias list (for example Warri, Onitsha, Zaria, Minna).
3. LGA names, but only to refine a state already established, or when a unique long LGA name stands in for a missing state.
4. Country evidence ("Nigeria", "Nigerian", "Nigerians") without inventing a state.
5. Explicit homonym handling: "Niger" alone is not Niger State; "Niger Delta" is not Delta State; foreign Bali is not Taraba's Bali.

Ambiguity rules:

- Multiple states → `stateId: null`, `ambiguous: true`, `needs_review`.
- No state → `needs_review` unless the item is rejected for no Nigeria signal.
- LGA-only resolution is deliberately below the auto-pending threshold.

Not implemented: a live AI geographic extractor (the contract accepts a proposal but no provider is enabled), "in/at/along" location-cue parsing, coordinates, occurrence-time resolution and precision (`exact`/`lga`/`state`) assignment for new events. No new event receives a marker in this increment.

### 2.6 Event clustering gate (implemented, not persisted)

`src/lib/clustering/` implements the hard-gate assessment. It is pure: it does not write `event_clusters`, create events or change candidates.

Hard gates, all required before similarity:

- distinct records (a record cannot cluster with itself),
- a resolved category on both records and the same category,
- a resolved state on both records and the same state,
- valid publication/report times within 72 hours.

Scoring after the gates:

`0.45 * title similarity + 0.25 * entity overlap + 0.20 * geography agreement + 0.10 * time proximity`

- Title similarity is Sørensen–Dice over normalised, stop-word-filtered title tokens.
- Entity overlap is a deterministic capitalised-word/number proxy, not named-entity recognition.
- Geography is 1.0 for the same known LGA, 0.85 when both records are state-only, 0.8 when one has an LGA, and 0 when both name different LGAs.
- Time proximity falls linearly from 1.0 at the same timestamp to 0 at 72 hours.

Decision rules:

- Score ≥ 0.86, independent evidence and no conflict → `auto_attach` proposal.
- Score 0.70–0.86, or a high score capped by an LGA conflict, contradictory headline numbers, same publisher or shared independence group → `review`.
- Score < 0.70 → `no_match`; keep the records separate.

Different known LGAs and contradictory headline numbers never auto-merge. Same-publisher articles and syndicated copies are counted once for independence and never corroborate each other. Similarity alone never merges anything. There is no score below which a known conflict is ignored; conflicts cap the outcome at review even above 0.86.

Not implemented: cluster persistence, an `event_clusters` review queue, candidate-to-event attachment, semantic similarity, actor/town extraction beyond LGA and number checks, and any UI.

### 2.7 Verification state machine (implemented, reviewer-only)

`src/lib/verification/` defines the allowed transitions and evidence rules. `src/lib/data/postgres/verification.ts` applies an approved transition to an **existing** event in one transaction.

States and allowed progression:

```
UNASSESSED
  → SINGLE_SOURCE            (exactly 1 independent non-conflicting group)
  → MULTIPLE_SOURCES         (≥2 independent groups, no conflicting report)
  → CORROBORATED             (≥2 independent groups, no conflict + explicit reviewer approval)
  → OFFICIAL_CONFIRMATION    (≥1 official source group; disputes may coexist)
  → DISPUTED                 (credible conflicting reports from ≥2 groups)
  → RETRACTED                (terminal; event remains with a retraction notice)
```

Rules:

- Independent-group counting collapses multiple articles from one publisher and all syndicated copies sharing an `independence_group`.
- Background evidence is ignored. Retracted evidence is counted separately.
- `corroborated` requires `approveCorroboration: true`; an automatic count alone can never set it.
- `disputed` requires a conflict from a different group than the supporting evidence. A publisher contradicting itself is not credible corroboration of a dispute.
- `retracted` requires at least one source relationship marked `retracted`; it never deletes the event.
- `retracted` is terminal. Downgrades and skipped states are refused. A no-change request is refused.
- Reviewer IDs use the same stable operator pattern as candidate review. A rationale of 10–1,000 characters is required.
- The store updates `events.verification_status` and `last_updated_at`, appends a `verification_change` row to `event_updates` and writes an `audit_logs` row with reviewer ID, rationale, rule version and evidence counts.
- It never creates an event, changes `published`, alters confidence or writes a public view.
- `event_updates` and `audit_logs` are service-role-only, but do not yet have database-level append-only triggers; the store only inserts.

Not implemented: a verification CLI/UI, reviewer authentication/authorisation, a correction workflow, notification or publication. Candidate acceptance remains a separate evidence decision and cannot set a verification status.

### 2.8 Summaries and analysis

- AI summary and analysis are not implemented.
- The dashboard's "Automated national summary" is **not an LLM**. It is deterministic aggregation over the demo dataset: counts, dominant categories, most-reported states, severity mix and data gaps. It is labelled "Automated demo summary", avoids causal or security conclusions and does not use captured articles.
- No captured article text is summarised anywhere.

## 3. Deterministic priors

Category priors use weighted phrase rules for `security`, `politics`, `economy`, `infrastructure`, `environment` and `health`. The headline is weighted above feed tags and the excerpt. Weak or balanced evidence resolves to `null` and `needs_review`.

Each candidate stores:

- `category`, `state_id`, `lga`;
- `category_confidence`, `geo_confidence`;
- `status` (`pending`, `needs_review` or `rejected` from capture; `accepted` only after a reviewer decision);
- `reasons` (matched phrases and review triggers);
- `rule_version` (`nsm-priors-2026-11-05.1`).

No path from capture produces `accepted` or an event. Acceptance by the reviewer CLI does not produce an event either.

## 4. Scheduling and operations

Implemented:

- `npm run ingest -- --source=premium-times` with `--dry-run`, `--pglite`, `--limit` and `--json`.
- `npm run review -- --list` and `npm run review -- --id=... --action=accept|reject --reviewer=...` with optional category/state corrections and bounded notes.
- One `run_id` per run; `ingestion_logs` and `source_health` are written in the same transaction as the captured data on success, or by the failure path.
- Re-running the same feed is idempotent. Reviewer decisions are transactional and append-only.

Not implemented:

- Scheduler, HTTP ingestion endpoint, per-source lock, retry/backoff, dead-letter queue, token budget, per-provider rate limit and alerting.
- Health endpoint integration for ingestion: `/api/system/health` reports `ingestion: "not_connected"` because no scheduled ingestion feeds the serving path.

## 5. Evaluation (not implemented)

Planned:

- Golden set of Nigerian articles with human labels for category, state, severity and event identity.
- Metrics: category accuracy, state precision/recall, false-merge rate (target < 2%), missed-merge rate, severity mean absolute error, schema validity and cost per article.
- Regression tests on every prompt/model change, stored with the prompt version.
- Human review sampling: 10% of auto-published events weekly, 100% of `needs_review`.

No golden set or real-model evaluation exists. The current suite tests prompt shape, schema validation, provider configuration and fixture-provider orchestration only.

## 6. Safeguards checklist

- [x] No source fabrication; only one verified feed is enabled
- [x] No invented statistics or coordinates in capture
- [x] Deterministic validation before any future model call
- [x] Original headline, URL, excerpt and timestamps preserved
- [x] Multiple-state and unresolved geography sent to review
- [x] No automatic event creation, merge or acceptance
- [x] Reviewer decisions require a stable identity and rationale, with an append-only audit
- [x] Restricted-content policy (metadata + bounded excerpt + link)
- [x] AI output is a validated proposal with model, prompt/schema version, confidence and raw-response hash
- [x] AI proposals are append-only and cannot update candidates or create events
- [x] Clustering requires category + geography + 72-hour gates before similarity; similarity alone never merges
- [x] Same-publisher and syndicated evidence is never independent corroboration
- [x] Verification transitions are evidence-gated, reviewer-input and corroboration requires explicit approval
- [x] Retraction is terminal and preserved in the timeline and audit log
- [x] Verification updates an existing event only; it never creates or publishes one
- [ ] Cluster persistence and `event_clusters` review
- [ ] Verification CLI/UI and reviewer authentication
- [ ] Correction workflow for previously published evidence
- [ ] Prompt-injection isolation tested with a real provider
- [ ] PII minimisation and no vulnerable-person location exposure
- [ ] Uncertainty surfaced from AI output in the UI
- [ ] Human correction path for a stored AI proposal
- [x] Demo/production separation enforced at the database and API
