# Data Sources and Verification Log

**Verified:** 2 November 2026 for geography and economic access; 5 November 2026 for the Premium Times Phase 5 feed and terms review. Access can change. Re-verify before enabling production ingestion.

## 1. Geographic data — verified

| Dataset | Publisher | Access | Licence | Verification |
| --- | --- | --- | --- | --- |
| Nigeria ADM1 state boundaries (37 units) | GRID3 (2022), via geoBoundaries | `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1.geojson` | CC BY 4.0 | Downloaded 2.29 MB, 37 features, all Polygon, names checked |
| Nigeria ADM2 LGA boundaries (774 features) | GRID3, via geoBoundaries | `…/NGA/ADM2/geoBoundaries-NGA-ADM2.geojson` | CC BY 4.0 | Downloaded 9.42 MB, 774 features, 769 unique names (duplicate LGA names across states are expected) |

Metadata endpoint used to confirm provenance: `https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/` (boundary year 2022, `boundarySource: GRID3`, `boundaryLicense: CC BY 4.0`, 37 units).

**Attribution string used in product:** *Boundaries: GRID3 Nigeria State/LGA Boundaries (2022), via geoBoundaries, CC BY 4.0.*

Why this dataset: it is the only verified open dataset in this environment with both ADM1 and ADM2 for Nigeria, a clear licence, and a stable, versioned download. The ADM2 layer powers the LGA gazetteer and fallback centroids; it is not published as a map layer in Phases 2–3.

The downloaded files are stored in `research/` for reproducibility and are **not** served to the browser. `scripts/build-geo.mjs` produces the simplified, validated web assets and metadata. Research files are excluded from deployment.

## 2. News and OSINT sources — access tested

Tested from the build machine on 2 Nov 2026 with a standard HTTP client.

| Source | Endpoint | Result | Notes |
| --- | --- | --- | --- |
| Premium Times | `https://www.premiumtimesng.com/feed/` | **200 RSS** | Working; preferred first Phase 5 adapter |
| Channels Television | `https://www.channelstv.com/feed/` | **200 RSS** | Working |
| Punch | `https://punchng.com/feed/` | **200 RSS** | Working |
| Vanguard | `https://www.vanguardngr.com/feed/` | **200 RSS** | Working |
| Daily Trust | `https://dailytrust.com/feed/` | **200 RSS** | Working |
| BusinessDay | `https://businessday.ng/feed/` | **200 RSS** | Working (feed shorter) |
| Nigerian Tribune | `https://tribuneonlineng.com/feed/` | **200 RSS** | Working |
| The Guardian Nigeria | `https://guardian.ng/feed/` | 403 | Not enabled; needs publisher permission |
| TheCable | `https://www.thecable.ng/feed` | 403 | Not enabled |
| Legit.ng | `https://www.legit.ng/rss/all.rss` | DNS failure | Not enabled |
| NBS | `https://nbs.gov.ng/` | DNS failure at test time | Official statistics via World Bank mirror for Phase 6; re-check later |
| NiMet | `https://nimet.gov.ng/` | 307 redirect | Not followed; re-verify |
| GDELT DOC API | `https://api.gdeltproject.org/api/v2/doc/doc?...` | 429 at test time | Rate-limited; not enabled |
| ReliefWeb | `https://reliefweb.int/` | 200 | API to be evaluated in Phase 5 |

**Important:** an HTTP 200 feed is not a licence grant. Before enabling a source in production, record its terms of use, robots policy, article-retention policy and attribution requirements. NSM will store metadata, short excerpts and links, not full text.

### 2.1 Phase 5 enabled source — Premium Times (restricted)

| Check | Evidence | Date |
| --- | --- | --- |
| Feed | `https://www.premiumtimesng.com/feed/` returned **HTTP 200**, `application/rss+xml; charset=UTF-8`, RSS 2.0, 15 items in the observed response | 5 Nov 2026 |
| robots.txt | `User-agent: *` → `Disallow:` (crawling allowed); `crawl-delay: 10`; only `/tag/` disallowed for two Meta agents | 5 Nov 2026 |
| Terms and copyright | The site publishes its terms and asserts copyright over its content. No explicit RSS syndication or republication licence was found. | 5 Nov 2026 |
| Licence decision | **Restricted.** Metadata, headline, short excerpt (≤320 characters), feed categories, timestamps, attribution and outbound link only. No full article text, images, author PII or raw feed payload is stored. | 5 Nov 2026 |
| Editorial boundary | Captured items become `ingestion_candidates` for review. No event is created automatically. | 5 Nov 2026 |

Implementation: `src/lib/ingestion/sources.ts`. The adapter sets `licenceStatus: "restricted"`, records the publisher's 10-second crawl delay and a 30-day capture window. One feed retrieval is made per run (at most three allow-listed redirects); the CLI does not crawl article pages. There is no scheduler, so repeated manual runs must be spaced at least 10 seconds apart. Attribution is stored on the `sources` row and must remain visible wherever the article metadata is shown.

Observed feed composition on 5 Nov 2026 included top news, politics, business, a sports section, a foreign/world section and one promoted story. The adapter rejects `/sports/`, `/entertainment/`, `/foreign/`, `/lifestyle/`, `/promoted/` and other out-of-scope paths before review, and rejects items with no Nigerian state or country signal. Remaining out-of-scope or ambiguous items are sent to review, not published.

This is a research/verification decision, not legal advice. Before production publication, obtain publisher permission or a syndication licence, re-check the terms, and re-verify robots.txt. See `docs/INGESTION.md` for the full control set.

Official institutions to evaluate in Phase 5/6: NEMA (`nema.gov.ng`, 200), CBN (`cbn.gov.ng`, 200), DMO (`dmo.gov.ng`, 200), NiMet, NBS, Nigeria Police Force, state government portals. No claim is made that all provide machine-readable feeds.

## 3. Economic data — access tested

| Source | Endpoint | Result | Intended use |
| --- | --- | --- | --- |
| World Bank Indicators API | `https://api.worldbank.org/v2/country/NGA/indicator/{code}?format=json` | **200 JSON** | Official, annual, lagged indicators |
| open.er-api.com | `https://open.er-api.com/v6/latest/USD` | **200 JSON**, NGN 1348.44829, updated 2 Nov 2026 00:02 UTC | Market-reported FX reference; never labelled official |
| IMF DataMapper | `https://www.imf.org/external/datamapper/api/v1/...` | 403 | Not enabled |
| CBN | `https://www.cbn.gov.ng/` | 200 HTML | Requires source-specific extraction; no public JSON API assumed |
| DMO | `https://www.dmo.gov.ng/` | 200 HTML | Requires extraction; debt bulletins |

Verified World Bank observations (retrieved 2 Nov 2026):

| Indicator | Code | 2025 | 2024 | Status |
| --- | --- | --- | --- | --- |
| Inflation, consumer prices (annual %) | `FP.CPI.TOTL.ZG` | 23.01 | 33.24 | Official annual, World Bank |
| GDP growth (annual %) | `NY.GDP.MKTP.KD.ZG` | 4.01 | 4.07 | Official annual, World Bank |
| Population, total | `SP.POP.TOTL` | 237,527,782 | 232,679,478 | Official estimate, World Bank |

### Integrated in the application (Phase 6, first dataset)

The Economy view and `/api/economy/*` read eight World Bank WDI series for Nigeria live from `api.worldbank.org` (host-locked, validated with Zod, 8-second timeout, no redirects, 512 KB response cap). No values are stored in the repository or hard-coded; test fixtures use synthetic numbers. Each indicator shows its own reference year, status (`official`, or `modelled` for the ILO-modelled unemployment series), the date the World Bank reports the series was last updated, and a link to the source series. Licence: CC BY 4.0. Values lag the current year by design.

Not yet integrated: NBS, CBN, DMO, Budget Office, IMF and market series (FX, fuel, tariffs, crude). Do not use the FX quote above as a static dashboard figure.

Persistence of these observations into `economic_indicators` / `economic_observations` is not done: the current build fetches live with a per-instance cache. Add a scheduled ingestion that writes vintages before relying on them for history or comparisons across releases.

### Economic source requirements (remaining Phase 6 work)

- Official: NBS CPI release, CBN policy rate, DMO debt stock, Budget Office revenue, NBS GDP.
- Market: FX, petrol/diesel pump prices, electricity tariff, crude oil.
- Multilateral: World Bank, IMF (WEO via alternative access), AfDB.
- Every observation: value, unit, currency, reference period, publication date, retrieved date, status (`official`, `market`, `estimated`, `modelled`), source URL, vintage. Never interpolate silently.
- Keep news-derived business developments separate from numeric indicators.

## 4. Source reliability model

Not all sources are equal, and not all repetitions are independent:

- `source_tier`: official / major_publisher / regional_publisher / aggregator / unknown.
- `independence_group`: publisher group; syndicated copies share a group and do not count as independent corroboration.
- `verification_status` is derived from independent source count and official confirmation, never from article count alone.
- Source health is tracked per adapter (last success, consecutive errors, latency). A source outage is shown to users as reduced coverage.

## 5. Data ethics

- Do not publish precise locations of vulnerable people, active operations or protected sites.
- Do not name individuals in demo data.
- Report allegations as allegations; preserve "said", "alleged" and "unconfirmed" in summaries.
- Correct errors through event updates with a visible audit trail; do not silently rewrite history.
- Retain article metadata for evidence; expire full excerpts in line with publisher terms.

## 6. Reproducibility

`npm run geo:build` reads `research/nga-adm1.geojson` and `research/nga-adm2.geojson`, validates all 37 registry matches, checks geometry inside Nigeria's bounding box, derives centroids and the LGA gazetteer, and writes deterministic outputs. The script fails loudly if a feature is missing or duplicated. Research inputs are not committed if repository size becomes a concern; the download URLs and SHA check live in `docs/PHASE_1_RESEARCH.md`.


## 7. Registered news sources and robots.txt (updated 14 November 2026)

`src/lib/ingestion/sources.ts` registers **31 sources** (22 publisher feeds, four of them politics sections only, the NiMet official alert feed and 8 GDELT queries), all active by default (`INGESTION_SOURCE=all`) and all `restricted` (headline, short excerpt, timestamp, attribution and an outbound link only). Every run reads the publisher's `robots.txt` first and obeys it; a source that is blocked, down or malformed is skipped and reported, and never stops the others.

| Slug | Publisher | Evidence |
|---|---|---|
| `premium-times` | Premium Times | verified: fetched, robots and terms reviewed 5 Nov 2026 |
| `channels-tv`, `punch`, `vanguard`, `daily-trust`, `businessday`, `nigerian-tribune` | Channels, Punch, Vanguard, Daily Trust, BusinessDay, Tribune | verified: HTTP 200 RSS on 2 Nov 2026 (section 1); terms not reviewed |
| `daily-post` | Daily Post | third-party: a feed relay last posted from it 3 Mar 2026; a feed catalogue and reader also list it |
| `blueprint` | Blueprint | third-party: relay last post 3 Mar 2026 |
| `leadership` | Leadership | third-party and directory; the relay last saw it 22 Dec 2025, so activity is less certain |
| `pm-news`, `ripples-nigeria`, `the-will`, `information-ng`, `point-blank-news`, `hallmark`, `herald` | PM News, Ripples, The Will, Information Nigeria, Point Blank News, Hallmark, The Herald | directory only: FeedSpot (updated 20 Aug 2026) |
| `the-tide` | The Tide (Rivers State, regional tier) | directory only: FeedSpot (Aug 2026) |

**None of the feeds added on 10 November was fetched by the build tooling, which has no internet access.** Evidence labels are in `SOURCE_EVIDENCE` and say exactly what each claim rests on. Run `npm run sources:check` on a machine with internet access for the first-hand result; a feed that fails it is still skipped safely at runtime. Terms of use were reviewed for Premium Times only: obtain publisher permission before publishing events built from any other source.

`npm run ingest` (default `all`), `npm run scheduler` and `/api/cron/ingest` all run the registered set. The cron route fetches four publishers at a time and rotates the starting publisher every minute, so a run cut short by the 60-second platform limit does not always drop the same sources; `?source=punch,vanguard` schedules publishers separately.

### Coverage

Eighteen RSS feeds cover the large national dailies, a business daily, several digital outlets and one state-owned regional daily. That is broad, but it is **not all Nigerian news**: most state-level outlets, radio and television, official bulletins (NEMA, NiMet, police, CBN) and wire services are missing, and several states will have little or no coverage. `UNVERIFIED_FEED_CANDIDATES` holds 21 more outlets that cannot be ingested yet. Known problems: The Guardian Nigeria returned 403 to automated requests on 2 Nov 2026, and Legit.ng did not resolve for the project author on the same date although a relay read `https://www.legit.ng/rss/all.rss` in March 2026. Promote a candidate only when `sources:check` reports it READY and you have considered its terms.

The realistic route to near-complete coverage is a licensed aggregator or the GDELT DOC API (hundreds of Nigerian outlets). It is **not built**: it needs an adapter that accepts article links on arbitrary publisher hosts, which the allow-listed-host design deliberately forbids.

### Benchmark: World Monitor

See `docs/WORLD_MONITOR_BENCHMARK.md` for what a comparable open-source product does and which ideas apply here.


### GDELT aggregator (added 12 November 2026)

`gdelt-nigeria` reads the public GDELT DOC API for articles from Nigerian-country outlets in the last three hours (headline, link, time and outlet domain; there is no excerpt). It exists to reach outlets that have no feed registered here. Rules it follows:

- Articles from outlets already read directly are dropped, so one article is never counted twice.
- Links may point to any public HTTPS site (never IP addresses or internal names). They are stored and shown, not fetched.
- All GDELT items count as **one** independent source group.
- It is an API, so robots.txt does not apply; it is called once per run, which respects GDELT's request-rate guidance. GDELT occasionally answers a rate limit with plain text; that is reported as a failed run and the circuit breaker handles repeats.
- Its evidence level is "directory": the API is documented, but it has not been fetched by the build tooling. Run `npm run sources:check`.

### Adding another site

1. Run `npm run sources:add -- dailypost.ng` on a machine with internet access. It finds the feed (the page's own link, else `/feed/`, `/rss` and similar), reads robots.txt, test-parses the feed, and appends an entry marked "verified" to `src/config/extra-sources.json`.
2. Commit that file and redeploy. The site is ingested from the next run.
3. Or edit `src/config/extra-sources.json` by hand in GitHub: `{ "slug": "the-nation", "name": "The Nation", "feedUrl": "https://thenationonlineng.net/feed/" }`. A typo fails the build instead of silently breaking ingestion. Hand-added entries are labelled "directory" until `sources:check` confirms them.

The **Sources** tab in the app lists every source with its evidence level, health, article counts and, for a paused source, when it will be retried.


### Added 14 November 2026

- **NiMet weather alerts** (`nimet-alerts`, official tier): the Nigerian Meteorological Agency's English Common Alerting Protocol feed at `https://cap-sources.s3.amazonaws.com/ng-nimet-en/rss.xml`, listed in the WMO Alerting Authority register. Warnings name regions, so they can be placed on the state map. Evidence label: third-party (the register), not yet fetched by the build tooling.
- **GDELT widened to eight queries**: national, foreign outlets on Nigeria, and one per geopolitical zone, each up to 250 articles per call over a 90-minute window. GDELT asks for one request per 5 seconds, so a scheduled run executes two of them (rotating) and spaces them out; each query therefore runs about hourly at a 15-minute schedule. An article matched by several queries is stored once. All GDELT queries are one independence group.
- **robots.txt rule corrected** to RFC 9309: any 4xx answer other than 429 (including the 403 that Amazon S3 returns for a missing file) means no rules to obey; only 429, server errors and network failures stop a fetch.
- **`INGESTION_DISABLE=slug,slug`** switches sources off without a code change (use it if a publisher objects).

### Official bulletins, television and radio

Found and checked: the Securities and Exchange Commission (`https://sec.gov.ng/feeds/news.rss`) and the Central Bank of Nigeria publish feeds, but their items are national announcements with no state, so the state-based dashboard would decline them; they are not registered. No evidenced feed was found for NEMA, the police or most state governments. Channels Television is registered; Arise and TVC are still candidates. Radio stations publish no usable feeds, so they appear only if their websites are indexed by GDELT.

### Publisher terms of use

Terms are a legal matter this project cannot settle; see `TERMS_REVIEW.md` for what was found (no publisher found grants a republishing licence). What limits exposure: by default only the headline, outlet and a link are shown (no publisher text; `PUBLISHED_EXCERPT_CHARS`), nothing is copied in full, every event links to the publisher, robots.txt is obeyed, and `INGESTION_DISABLE` removes a publisher immediately. Obtain written permission from the publishers you depend on most.

### GDELT hardening (17 November 2026)

Each GDELT article carries its own source country, and the pipeline now checks it: domestic queries keep only Nigerian outlets and the foreign-outlet query drops Nigerian ones, so a wrong country code in a query cannot silently import another country's news. A rate-limit answer (HTTP 429) is reported plainly and retried on the next run. Four politics-section feeds were added from FeedSpot's Nigerian politics list (The Nation, Independent Nigeria, Daily Report Nigeria, The NewsGuru), each labelled "directory".
