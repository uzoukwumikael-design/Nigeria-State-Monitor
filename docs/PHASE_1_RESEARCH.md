# Phase 1 Research Log

Date: 2 November 2026. Environment: Windows, Node 24.20, npm 11.19, no Docker/PostgreSQL/Supabase CLI.

## 1. Reference platform analysis

World Monitor (world-monitor.com) was reviewed. The transferable patterns are:

- map-dominant layout with persistent left wire and right context rail;
- dense, small-typography information design; status and provenance always visible;
- global search, categorisation and geographic filtering;
- a disclaimer that AI-processed content may contain errors;
- clear separation of live map, feed, and analytical widgets.

NSM deliberately diverges where Nigerian needs differ:

- state-first rather than country-first navigation (37 first-order units);
- six geopolitical zones as a first-class analytical layer;
- explicit event/verification model instead of headline aggregation;
- low-bandwidth SVG fallback and no mandatory external tiles;
- no imitation of the green-on-black terminal aesthetic; a restrained navy/cyan intelligence palette;
- no prediction markets, flight tracking or other features irrelevant to the brief.

No proprietary assets, copy or code were copied.

## 2. Geographic dataset evaluation

| Candidate | Units | Licence | Assessment |
| --- | --- | --- | --- |
| **GRID3 via geoBoundaries ADM1** | 37 | CC BY 4.0 | **Selected**: authoritative, stable URL, 2022, 37 units, good topology |
| Natural Earth admin-1 | 37 (often 36 + FCT) | Public domain | Lower resolution; less suitable for state detail |
| GADM | 37 | Non-commercial | Licence incompatible with an open/commercial deployment |
| OCHA/HDX | 37 | CC BY 3.0 IGO | HDX unreachable at test time; GRID3 preferred |
| Hand-drawn GeoJSON from map libraries | varies | unclear | Rejected: not auditable, often simplified/wrong |

Selected source metadata:

- API: `https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/`
- Boundary ID: `NGA-ADM1-27671186`
- Source: GRID3, 2022; build date 2023-12-12; 37 ADM units.
- Download: 2,289,696 bytes; all 37 features `Polygon`.
- ADM2: 774 features (769 unique names), 9,422,551 bytes.
- Verified `shapeName` values include `Abuja Federal Capital Territory`, `Yenegoa`, `Ado-Ekiti`, `Port-Harcourt`, `Municipal Area Council`. These spelling variants are mapped explicitly in the registry; no fuzzy matching is used for production geometry.

Validation performed in the build script: 37 expected, 37 found, no duplicates, all registry IDs matched, all coordinates within Nigeria's bounding box, positive polygon area, centroid inside or near its own polygon. The simplified geometry's area is compared to the source to prevent destructive simplification.

## 3. Registry verification

The 36 states + FCT registry was checked against the product specification. Counts by zone:

| Zone | States | Count |
| --- | --- | --- |
| North Central | Benue, Kogi, Kwara, Nasarawa, Niger, Plateau, FCT | 7 |
| North East | Adamawa, Bauchi, Borno, Gombe, Taraba, Yobe | 6 |
| North West | Jigawa, Kaduna, Kano, Katsina, Kebbi, Sokoto, Zamfara | 7 |
| South East | Abia, Anambra, Ebonyi, Enugu, Imo | 5 |
| South South | Akwa Ibom, Bayelsa, Cross River, Delta, Edo, Rivers | 6 |
| South West | Ekiti, Lagos, Ogun, Ondo, Osun, Oyo | 6 |
| **Total** | | **37** |

Capitals verified and capital LGAs matched against GRID3 ADM2 (with the four documented spelling variants). No approximate coordinates are used for event locations; state labels use polylabel interior points derived from the geometry.

## 4. News-source access

Seven publisher feeds returned 200 RSS with content on the test date: Premium Times, Channels TV, Punch, Vanguard, Daily Trust, BusinessDay, Nigerian Tribune. Three failed: Guardian Nigeria (403), TheCable (403), Legit.ng (DNS), and NBS/NiMet were unavailable or redirected. GDELT returned 429. Details and URLs are in `DATA_SOURCES.md`.

Decision: Phase 5 begins with **one** working source (Premium Times preferred) and proves the full ingestion → enrichment → event → API → UI chain before adding others. Feed access alone is not licence approval.

## 5. Economic-source access

World Bank Indicators API returned verified 2025 values for inflation, GDP growth and population. `open.er-api.com` returned a market FX quote. IMF returned 403; CBN/DMO are HTML and need bespoke extraction. No economic numbers are displayed in Phase 2.

Decision: Phase 6 stores vintages and status (`official`/`market`/`estimated`/`modelled`), never mixes reference periods, and keeps numeric indicators separate from news-derived business events.

## 6. Environment constraints

- No PostgreSQL server, Docker or Supabase CLI available at Phase 1. Phase 4 resolved the local gap with PGlite 0.5.15 plus the real PostGIS 3.6 extension, which runs the production migrations and repository SQL. A hosted PostGIS deployment is still required for production and has not been provisioned.
- No map tile API key. Phase 2 uses local GeoJSON geometry on a dark background. This is also better for offline and low-bandwidth use. Context layers can be added later from openly licensed local vector data.
- npm PowerShell execution policy blocks `npm.ps1`; commands are run through `cmd /c` in this environment. Documented for future sessions.
- Internet access is available but flaky for some hosts. Ingestion adapters must be resilient.

## 7. Phase 2 decisions

1. Build the dashboard against a **clearly labelled demo repository**; production ingestion is Phase 5. No fake "live" status.
2. Generate an **inline SVG map** from the same geometry so lite mode does not download MapLibre.
3. Use **GRID3 polygon centroids/polylabel points** for labels and LGA fallbacks; no invented coordinates.
4. Implement real filtering, regional aggregation, search and state profiles now; no dead links for future phases.
5. Keep **one event → many sources** in the data model and UI even for demo data, so Phase 5 changes the data source, not the product contract.
6. Put all demo content behind `isDemo` and a global banner; include a per-event warning in detail views.
7. Verify map accuracy and interactions in a real browser before starting Phase 3.

## 8. Open questions / risks

- Publisher terms and article-retention limits need legal review before Phase 5 production ingestion.
- Official NBS/NiMet access may require alternative endpoints or manual datasets; do not invent replacements.
- Event clustering thresholds must be tuned on a human-labelled Nigerian golden set, not generic benchmarks.
- Map boundary review: GRID3 is authoritative for this build, but boundary representations can be politically sensitive; present them as administrative reference layers with attribution, not political claims.
- Supabase project credentials are still unavailable. Phase 4 shipped and locally verified migrations, seeds and the repository; hosted deployment remains an operational prerequisite for Phase 5.
- Low-bandwidth verification should include real throttled profiles in Phase 9, not only the manual toggle.
