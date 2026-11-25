# Performance and Low-Bandwidth Design

## 1. Budgets

| Metric | Target | Measurement |
| --- | --- | --- |
| Initial HTML + CSS (gzip) | < 60 kB | build report |
| Route JS excluding map (gzip) | < 220 kB | Next build / bundle analyzer |
| MapLibre chunk | lazy, not loaded in lite mode | network panel |
| Lite-mode first load JS | < 180 kB | Playwright transfer size |
| LCP (Slow 4G, mid mobile) | < 2.5 s | Lighthouse/Playwright |
| INP | < 200 ms | field/lab trace |
| API p95 national aggregate | < 400 ms | server timing |
| Feed filter interaction | < 100 ms for 1,000 events | performance measure |
| Map ready | < 2.5 s standard, < 300 ms SVG | custom marks |

## 2. Implemented in Phases 2–4

- **No external tiles, fonts or image requests.** Fonts are bundled via `@fontsource`; boundaries are checked-in GeoJSON; the app shell works without third-party network access.
- **Lite mode** replaces MapLibre with an inline SVG generated offline. Manual toggle persisted; auto-detection uses `navigator.connection.saveData` / `effectiveType` and reduced-motion preference. Lite mode also disables chart animation and non-essential motion.
- **Dynamic imports** for MapLibre, the map wrapper and Recharts-heavy analytics. The map is never part of the first-load route bundle in lite mode.
- **Pagination** on the wire (20 at a time) and a compact event payload; no historical dump.
- **Local filtering** over the loaded snapshot means state/category changes do not require a network round trip.
- **CSS-only effects**, no large background videos or decorative images.
- **TanStack Query** health checks with a 60 s interval (not a busy loop), disabled in lite/offline.
- **Component-level memoisation** for filtered lists and aggregation; no O(n²) filters.
- **Bulk database reads.** The Postgres repository loads snapshot metadata, states, sources, events, evidence, updates and relations in a fixed set of queries, then maps them once. There is no query per event. No performance benchmark of the hosted database has been run yet.
- **Bounded connection pooling.** `DATABASE_POOL_MAX` defaults to 5 and is clamped to 20; serverless deployments should use `1`. The runtime uses the Supabase transaction pooler so idle requests do not hold a database connection. Admin work uses a separate session/direct URL.
- **No startup-option dependency.** PostGIS calls are schema-qualified, so transaction-pooled queries behave the same as direct queries and do not pay a pooler compatibility penalty or fail on ignored `search_path` options.

## 3. Map efficiency

- GeoJSON simplified to ~0.005° with a validated area-ratio guard; quantised coordinates; one source/layer set.
- HTML markers, not one React tree per vertex. Clustering is computed in screen space with `supercluster`; only visible clusters render.
- Label collision detection runs on `moveend`/`zoomend` with `requestAnimationFrame`, not on every frame.
- Critical-marker pulse uses CSS, disabled in lite/reduced-motion.
- GeoJSON is served with long-lived immutable caching and content hash in the filename.

## 4. Data transfer

- Gzip/Brotli on all API responses (host default); `Cache-Control` with stale-while-revalidate.
- No full article bodies in list responses; detail only on demand.
- Coordinates and state metadata only, not polygons, in event responses.
- The SQL repository does not send article bodies, raw payloads or audit rows to the API layer.
- Future: cursor pagination, ETag, delta sync for realtime.

## 5. Mobile

- 390×844 target; touch targets ≥ 44px; map controls reachable with one hand.
- Panels are views rather than three stacked scrolling columns.
- No hover-only information: tap shows the same details.
- Test with CPU throttling 4× and Slow 4G, not only desktop.

## 6. Measurement

- Phases 2–3: Lighthouse and browser performance trace on desktop and mobile; record transfer sizes.
- Phase 8: automated budget assertions in CI.
- Phase 9: compare against targets and publish results in `docs/PERFORMANCE.md` (this file) under a dated results section.

## 7. Anti-patterns we reject

- Loading all history on first paint.
- Autoplaying animations and videos.
- Web fonts loaded from external CDNs without fallback.
- Map tile dependencies in lite mode.
- Refetching the full feed every few seconds for "live" effect.
- Huge bundle-wide chart/map imports on every route.
