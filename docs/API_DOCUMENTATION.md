# API Documentation

Base: `/api`. JSON only. All timestamps ISO-8601 UTC.

**Phase 4:** read-only endpoints serve the active repository snapshot. Demo mode can use the in-process snapshot or a guarded Postgres/PostGIS demo seed; production mode requires the Postgres/PostGIS repository. Contracts are unchanged across backends, including when the repository connects to Supabase through the transaction pooler. Planned endpoints are marked.

**Phase 5:** RSS capture, reviewer accept/reject decisions and validated AI enrichment run through server-side modules/CLIs, not the HTTP API. There are no ingestion, review, enrichment, verification or publication endpoints. Captured articles, review candidates, reviewer audit rows and AI proposals are server-side records and are not served by any public route. Acceptance is not publication. The dashboard and these endpoints still read the active demo snapshot until a real event is published through a path that does not exist yet.

## Response envelopes

Success:

```json
{
  "data": {},
  "meta": {
    "mode": "demo",
    "datasetVersion": "demo-2026-11-02.1",
    "generatedAt": "2026-11-02T09:00:00.000Z",
    "referenceTime": "2026-11-02T09:00:00.000Z",
    "coverage": { "from": "2026-10-06T02:00:00.000Z", "to": "2026-11-02T08:47:00.000Z", "basis": "demo_snapshot", "label": "Fictional demo snapshot — not live coverage" },
    "disclaimer": "DEMO DATA — NOT A REAL INCIDENT",
    "count": 25,
    "total": 74,
    "limit": 25,
    "offset": 0
  },
  "requestId": "req_..."
}
```

Error:

```json
{
  "error": { "code": "VALIDATION_ERROR", "message": "Invalid query parameters", "details": { "window": ["Invalid enum value"] } },
  "requestId": "req_..."
}
```

Status codes: `200` OK, `400` validation, `404` not found, `429` rate limited (`Retry-After`), `500` internal, `503` upstream source unavailable (economy) or review APIs not configured. No endpoint returns `501` any more.

Common headers: `Cache-Control` (public endpoints `public, max-age=30, stale-while-revalidate=120`), `X-Request-Id`, `X-RateLimit-*`.

Rate limit: 120 requests/minute/IP for read endpoints using the current in-process token bucket. Search: 30/minute/IP. A shared Redis/Upstash limiter remains future work for multi-instance deployments.

## Shared query parameters

| Name | Type | Notes |
| --- | --- | --- |
| `state` | `NG-XX` | Exact state ID; invalid → 400 |
| `zone` | enum | `north-central`, `north-east`, `north-west`, `south-east`, `south-south`, `south-west` |
| `category` | enum | `security`, `politics`, `economy`, `infrastructure`, `environment`, `health` |
| `severity` | 1–5 | exact level |
| `window` | enum | `24h`, `7d`, `30d`, `90d`, `365d`, `all` (relative to the active snapshot reference time) |
| `from` / `to` | — | **Not supported here: returns 400.** Use `/api/intelligence/history` for custom date ranges |
| `q` | string ≤ 120 | text search |
| `verification` | enum | `unassessed`, `single_source`, `multiple_sources`, `corroborated`, `official_confirmation`, `disputed`, `retracted` |
| `sort` | enum | `latest` (default), `severity`, `occurrence` |
| `limit` | int | default 25, max 100 |
| `offset` | int | default 0, max 10,000 |

## Endpoints

### `GET /api/states`

Returns all 37 registry entries with derived statistics and geometry metadata (no geometry itself).

```json
{
  "data": [{
    "id": "NG-IM", "name": "Imo", "capital": "Owerri",
    "zone": "south-east", "zoneName": "South East",
    "labelPoint": { "lat": 5.57, "lng": 7.09 },
    "areaKm2": 5530.2,
    "stats": {
      "reportedEvents": 4, "critical": 0, "last24h": 1,
      "topCategory": "security", "latestReportedAt": "2026-11-02T08:40:00.000Z",
      "corroborated": 1
    }
  }],
  "meta": { "mode": "demo", "count": 37 }
}
```

### `GET /api/states/[id]`

One state with statistics, category/severity breakdowns and latest events (max 5). `404` if ID unknown.

### `GET /api/states/[id]/events`

Events for one state; supports common filters + pagination. Same event schema as `/api/events`.

### `GET /api/events`

Filtered event list. Each item includes the event record (without full source bodies) and summary metadata.

```json
{
  "id": "evt-demo-0042",
  "title": "…",
  "summary": "…",
  "category": "environment",
  "subcategory": "flooding",
  "severity": 3,
  "stateId": "NG-IM",
  "stateName": "Imo",
  "zone": "south-east",
  "lga": "Oguta",
  "coordinates": { "lat": 5.71, "lng": 6.79 },
  "geoPrecision": "lga",
  "occurrenceAt": "2026-11-01T14:20:00.000Z",
  "firstReportedAt": "2026-11-01T18:10:00.000Z",
  "lastUpdatedAt": "2026-11-02T07:30:00.000Z",
  "verificationStatus": "multiple_sources",
  "independentSourceCount": 2,
  "articleCount": 3,
  "confidence": 0.72,
  "isDemo": true
}
```

`meta.facets` contains counts by category/state/zone for the current query before pagination.

### `GET /api/events/[id]`

Full event: summary, location and precision, timestamps, verification, confidence, sources (headline, publisher, URL, publishedAt, independence group), timeline updates, related events, and `analysis` clearly separated. Demo events include `isDemo: true` and the disclaimer. `404` unknown.

### `GET /api/intelligence/national`

```json
{
  "data": {
    "totals": {
      "reportedEvents": 74, "last24h": 11, "critical": 0, "severity4Plus": 9,
      "corroborated": 7, "disputed": 2, "singleSource": 13, "unassessed": 1,
      "nationalEvents": 5, "statesWithReports": 37, "independentSourceGroups": 8
    },
    "topStates": [{ "id": "NG-LA", "name": "Lagos", "count": 6, "share": 0.087 }],
    "categories": [{ "category": "economy", "label": "Economy", "color": "#2DD4BF", "count": 16, "share": 0.2162 }],
    "severity": [{ "severity": 4, "label": "High", "color": "#FB923C", "count": 9, "share": 0.1216 }],
    "zones": [{ "zone": "north-central", "name": "North Central", "shortName": "NC", "reportedEvents": 14, "share": 0.2029, "critical": 0, "disputed": 1, "statesReporting": 7, "topCategory": "security" }],
    "sourceDistribution": [],
    "assessment": "…",
    "assessmentKind": "automated_demo_summary",
    "scopeLabel": "Nigeria",
    "latest": [],
    "coverage": { "from": "…", "to": "…", "basis": "demo_snapshot" },
    "limitations": ["Reported event volume is not incidence, danger or a regional safety ranking."]
  }
}
```

The sample shows the unfiltered demo snapshot (default `window=30d`). All totals, breakdowns, top states and zones are recomputed for the active filters. `critical` counts severity 5; `severity4Plus` is the 4–5 band.

Assessment is explicitly not LLM output. In demo mode it is labelled `automated_demo_summary`; production AI analysis is not implemented. Volume ≠ risk.

### `GET /api/intelligence/regional`

Six-zone comparison and optional zone profile. Query parameters:

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `zone` | enum | none | Adds the matching `selected` profile; does not restrict the comparison |
| `category` | enum | `all` | Shared category filter |
| `severity` | 1–5 | `all` | Exact severity filter |
| `verification` | enum | `all` | Shared verification filter |
| `window` | enum | `30d` | Relative to the active snapshot reference time |
| `q` | string ≤ 120 | none | Text filter |
| `days` | int 7–90 | `14` | Trend window for every zone; UI exposes 7/14/30 |

The endpoint deliberately clears any dashboard state selection and forces the zone filter to `all` so all six zones stay on one comparison basis. National-scope records that are not assigned to a state are excluded from zone aggregates. Invalid values return `400 VALIDATION_ERROR`.

```json
{
  "data": {
    "zones": [{
      "zone": "south-west", "name": "South West", "reportedEvents": 13,
      "severity4Plus": 0, "corroborated": 1, "singleSource": 3,
      "sourceGroups": 6, "statesReporting": 6, "statesTotal": 6,
      "trend": [{ "day": "2026-11-02", "label": "2 Nov", "total": 2, "critical": 0, "severity4Plus": 0, "byCategory": { "security": 0, "politics": 0, "economy": 1, "infrastructure": 0, "environment": 1, "health": 0 } }],
      "trendTotal": 10, "activeDays": 8
    }],
    "selected": {
      "zone": "south-west", "name": "South West",
      "totals": { "reportedEvents": 13, "last24h": 3, "severity4Plus": 0, "corroborated": 1, "disputed": 0, "statesReporting": 6, "statesTotal": 6, "zonalShare": 0.1884, "nationalShare": 0.1757 },
      "categories": [], "severity": [], "verification": [], "states": [],
      "trend": [], "trendDays": 14, "recentEvents": [], "sources": [],
      "comparison": { "zonalAverageEvents": 11.5, "equalShare": 0.1667, "highSeverityShare": 0, "corroboratedShare": 0.0769, "stateCoverageShare": 1 },
      "assessment": "13 fictional demo events are reported in South West …",
      "assessmentKind": "automated_demo_summary",
      "limitations": ["Reported-event volume is not incidence, risk, danger or a state safety ranking."]
    },
    "selectedLabel": "South West",
    "totals": {},
    "categories": [],
    "assessment": "…",
    "assessmentKind": "automated_demo_summary",
    "volumeIsRisk": false,
    "days": 14,
    "zonalTotal": 69,
    "nationalEvents": 5,
    "limitations": []
  },
  "meta": {
    "mode": "demo",
    "requiresCaveat": "Regional reported volume must not be interpreted as actual security risk."
  }
}
```

`selected` is `null` when no `zone` is requested. All figures describe reported demo volume under the active filters; zone ordering is descriptive and is not a risk or safety ranking.

### `GET /api/intelligence/trends`

Daily reported-event buckets. Query parameters:

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `days` | int 1–365 | `14` | Bucket count ending at the reference time |
| `state` | `NG-XX` | none | Exact state ID |
| `zone` | enum | none | Zone filter |
| `category` | enum | none | Category filter |
| `severity` | 1–5 | none | Exact severity filter |
| `verification` | enum | none | Verification filter |
| `q` | string ≤ 120 | none | Text filter |

```json
{
  "data": {
    "days": 14,
    "series": [{
      "day": "2026-11-02", "label": "2 Nov", "total": 6, "critical": 0,
      "severity4Plus": 0,
      "byCategory": { "security": 1, "politics": 0, "economy": 2, "infrastructure": 0, "environment": 1, "health": 2 }
    }],
    "total": 52,
    "basis": "occurrence_time",
    "coverage": { "from": "2026-10-06T02:00:00.000Z", "to": "2026-11-02T08:47:00.000Z", "basis": "demo_snapshot", "label": "Fictional demo snapshot — not live coverage" }
  }
}
```

Buckets use event occurrence time in Africa/Lagos and fall back to first-report time when occurrence time is absent. Missing days are explicit zero buckets, not omitted. Severity counts are separate fields; volume is not converted into a risk score.

### `GET /api/intelligence/history`

Historical archive over the records the active dataset holds.

Query (all optional): either `window` (`24h`, `7d`, `30d`, `90d`, `365d`, `all`; default `90d`) **or** both `from` and `to` (inclusive Africa/Lagos calendar days, `YYYY-MM-DD`, real dates only, `from` ≤ `to`, at most 3,660 days). Scope: `state` (state ID) **or** `zone`, plus `category`. A `state` and `zone` that disagree are rejected.

Returns `range`, `days`, `bucket` (`day` ≤ 62 days, `week` ≤ 400, else `month`), zero-filled `series`, `totals`, `previous` (the equal-length period immediately before, with `comparable: false` when that period is partly outside held records), `delta`, `categories`, `severities`, `topStates`, `zones`, a `timeline` of severity 4–5 or corroborated events (newest first, max 40) and `coverage`.

`coverage` states which dates records exist for and sets `partial`/`empty` with a plain-language `note`. Days outside held records are *unobserved, not quiet*; coverage is never implied beyond what was ingested. Counts are reported volume, not incidence or risk.

### `GET /api/search`

Query: `q` (required, ≥2 chars), optional `limit` (default 10, max 30), filters. Returns grouped `{ states, events, categories, zones }` with matched fields. No external search call; uses normalised text + the LGA gazetteer. Rate limited.

### `GET /api/economy/indicators`

National annual indicators for Nigeria from the World Bank World Development Indicators (CC BY 4.0), fetched server-side and cached per instance (6 hours fresh; a last good copy is served flagged `stale` for up to 7 days if a refresh fails). Eight series are curated in `src/lib/economy/indicators.ts`: inflation, GDP growth, unemployment (modelled), official exchange rate, lending rate, reserves, FDI inflows and trade openness.

Each indicator returns `code`, `name`, `unit`, `currency`, `dataStatus` (`official` or `modelled`), `latest` and `previous` (each with `year`, `value`, `referencePeriodStart/End`), `change`, `observationCount`, `sourceLastUpdated`, `sourceUrl` and a per-indicator `error`. Years without a published value are skipped, never filled. Each indicator keeps its own reference year; periods are never mixed.

`meta.isDemo` is `false`. If no indicator can be retrieved and no earlier copy is held, the response is `503 UPSTREAM_UNAVAILABLE` with per-indicator reasons and **no figures**. National scope only; no state or zone economic series are integrated, and these series are independent of news-derived event counts.

### `GET /api/economy/trends`

Query: `code` (required, one of the curated series codes) and `years` (2–60, default 30). Returns that series' observations oldest first with `unit`, `dataStatus`, `sourceLastUpdated`, `stale` and `error`. `503` when the series cannot be retrieved and no copy is held.

### `GET /api/sources`

Registry entries. Demo mode returns fictional sources with `"isDemo": true` and no claim of live sync. Production mode returns only non-demo sources from the active snapshot.

### `GET /api/system/health`

```json
{
  "data": {
    "status": "demo",
    "mode": "demo",
    "repository": "memory",
    "database": "not_connected",
    "ingestion": "not_connected",
    "aiEnrichment": "not_connected",
    "realtime": "not_connected",
    "lastSuccessfulSync": null,
    "datasetVersion": "demo-2026-11-02.1",
    "datasetGeneratedAt": "2026-11-02T09:00:00.000Z",
    "referenceTime": "2026-11-02T09:00:00.000Z",
    "sources": { "total": 8, "live": 0, "demo": 8, "healthy": 0 },
    "counts": { "events": 74, "states": 37 },
    "coverage": { "from": "2026-10-06T02:00:00.000Z", "to": "2026-11-02T08:47:00.000Z", "basis": "demo_snapshot", "label": "Fictional demo snapshot — not live coverage" },
    "limitations": ["Every event and source in this dataset is fictional."],
    "disclaimer": "DEMO DATA — NOT A REAL INCIDENT"
  }
}
```

With `NSM_REPOSITORY=postgres`, `repository` is `postgres` and `database` is `connected` after the active snapshot loads, including when `DATABASE_URL` is a Supabase transaction-pooler string. Health must never claim ingestion is live when it is not; production remains `degraded` until ingestion, AI and realtime are actually connected.

`ingestion: "not_connected"` remains correct even though the CLIs can capture a feed and record reviewer decisions: no scheduled ingestion feeds the serving path, and no captured or accepted article is published as an event. Do not change this field to a live value until that pipeline exists.

The health endpoint does not expose hostnames, usernames, database names or connection mode. Use `npm run db:doctor` for server-side connection diagnostics.

## Caching and revalidation

| Endpoint | Cache |
| --- | --- |
| `/api/states` | 5 min + SWR 10 min |
| `/api/events`, national/regional/trends | 30 s + SWR 2 min |
| `/api/system/health` | no-store |
| `/api/search` | no-store |

## Versioning

Phase 4/5 remains `v0` (unstable). Additive changes are preferred within `/api`; breaking changes move to `/api/v2` with a deprecation window. An OpenAPI document generated from the Zod schemas has not been produced and is not claimed.
