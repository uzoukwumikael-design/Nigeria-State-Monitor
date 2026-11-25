# World Monitor benchmark (researched 10 November 2026)

World Monitor (worldmonitor.app, with an open-source repository by koala73) is a free global intelligence dashboard. This note records what public descriptions of it say and what that means for Nigeria State Monitor (NSM). It comes from web pages and GitHub listings, not from running the product or reading its source, so treat the details as secondhand.

## What it does
- **Breadth through curated feeds.** Public descriptions say it ingests roughly 435 to 500+ curated RSS feeds grouped into about 15 categories, plus dozens of map layers (conflict, markets, infrastructure, weather and more).
- **One schema, many sources.** Items from different feeds are normalised to a common event shape, geolocated and de-duplicated across sources, and each feed refreshes on its own cycle.
- **Source management.** A sources panel lets users switch feeds on and off; regional presets (including Africa) narrow the view; time filters run from one hour to seven days.
- **A single risk number.** A "Country Instability Index" (0 to 100) scores countries from the signals.
- **AI briefings** from a choice of model providers, including local ones.
- **Operational hygiene.** Descriptions mention a domain allow-list for its feed proxy and circuit breakers for failing feeds.
- **Licence is unclear.** Listings disagree (AGPL-3.0 on some, MIT on others). Do not copy its code or feed lists without reading the repository's own LICENSE file.

## What applies to NSM
| Idea | NSM today | Verdict |
|---|---|---|
| Many curated, tiered feeds | 18 registered, evidence-labelled, robots-checked | Done; widen with `sources:check` |
| Normalise, geolocate, de-duplicate across sources | Candidates, clustering, independence groups | Done, automatically (no human review by the owner's decision) |
| Per-feed health and isolation | `source_health` table, per-source results, failure isolation | Done |
| Domain allow-list | `allowedHosts` per source | Done |
| Sources panel | **Sources** tab: evidence level, health, counts, retry time | Done (no per-outlet feed filter yet) |
| Circuit breaker for failing feeds | Pause after 5 failures (30 min, doubling to 24 h), automatic trial after | Done |
| Regional presets | Six geopolitical zones | Done |
| Single risk or instability score | Deliberately not provided | **Not adopted.** NSM treats reported volume as not equal to risk |
| Aggregator breadth (GDELT and similar) | `gdelt-nigeria` source (headline and link only) | Built; not yet fetched live from the build tooling |

## Other regional reference
A public "West Africa" dashboard lists on the order of 127 sources, which shows how much wider a regional product can go than NSM's current 18 feeds.
