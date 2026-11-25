# Toward a Nigerian World Monitor

World Monitor is a global dashboard with many layers (news, markets, hazards, infrastructure, AI briefings). The goal here is the same idea built for Nigeria. This is the honest state of that, and the next steps in order of value.

## Already in place
- Map of the 36 states and the FCT; reported events by state and by geopolitical zone, with duplicate reports merged and independent sources counted.
- Automatic collection from 22 publisher feeds, a headline index (GDELT, eight queries) and NiMet's official weather alerts; per-source health, a circuit breaker and a Sources panel.
- Automatic publishing with AI or rule-based sorting; no manual review.
- National economic indicators (World Bank), history with honest coverage notes, offline mode, low-bandwidth mode.
- One-call database setup and a go-live guide (no terminal).

## Not built yet, in suggested order

| # | Layer | Why it matters in Nigeria | Possible source (not verified live) |
|---|---|---|---|
| 1 | **Daily AI briefing** per zone and nationally, built only from published events, citing them | Turns hundreds of reports into a morning read; uses the AI provider already configured | none needed |
| 2 | **Alerts by state** (WhatsApp, Telegram or email digests) | WhatsApp is how many people get news; makes the product sticky | a messaging provider |
| 3 | **Natural hazards** (floods, wildfires, storms) with coordinates | Flooding is a recurring national risk; coordinates are more precise than text | NASA EONET (open, no key); GDACS alerts |
| 4 | **Local-language news** (Pidgin, Hausa, Yoruba, Igbo) | Reaches audiences English feeds miss | BBC's Pidgin and Hausa feeds are candidates; GDELT can query other languages |
| 5 | **Markets strip** (USD/NGN, oil, NGX index) | Core to a Nigerian "world monitor" | needs a licensed or official data source |
| 6 | **Conflict data** | Security is the most-used layer elsewhere | ACLED (registration and licence needed) |
| 7 | **Health outbreaks** | Disease alerts matter locally | NCDC reports (no feed found); WHO outbreak news filtered to Nigeria |
| 8 | **Live TV** (Channels, Arise) | World Monitor's most visible feature | video embeds; needs a security-policy change |
| 9 | **Power and fuel** | Daily-life impact | no usable feed found |

## Deliberately not copied
World Monitor's single 0–100 "instability" score. Reported volume is not risk, and a score would invite that mistake. A clearly labelled "reporting intensity versus normal" indicator is a safer alternative.

## Cross-cutting
- Every new layer should arrive with an evidence label (verified, third-party or directory) and a health state in the Sources panel.
- Terms of use gate each source (see TERMS_REVIEW.md).
