import extraSourcesJson from "@/config/extra-sources.json";
import { z } from "zod";
import { STATES } from "@/lib/geo/states";
import { ZONE_IDS, type ZoneId } from "@/lib/types";
import type { IngestionSource } from "@/lib/ingestion/types";

/**
 * Phase 5 starts with one publisher. Premium Times' robots.txt allows crawling
 * with a 10 second delay, but the site asserts copyright and publishes no
 * explicit syndication licence. NSM therefore treats it as `restricted`:
 * headline, short excerpt, timestamp, attribution and outbound link only.
 */
export const PREMIUM_TIMES: IngestionSource = {
  slug: "premium-times",
  name: "Premium Times",
  sourceType: "news",
  tier: "major_publisher",
  baseUrl: "https://www.premiumtimesng.com",
  feedUrl: "https://www.premiumtimesng.com/feed/",
  accessMethod: "rss",
  independenceGroup: "premium-times",
  licenceStatus: "restricted",
  attribution: "Premium Times Nigeria — headline and short excerpt, linked to the original article.",
  reliabilityNote:
    "Major Nigerian news publisher. Restricted ingestion: metadata and short excerpt only; no full text or images. Publishing an event still requires review.",
  active: true,
  allowedHosts: ["www.premiumtimesng.com", "premiumtimesng.com"],
  maxItems: 40,
  excerptLimit: 320,
  crawlDelayMs: 10_000,
  maxAgeDays: 30,
};

/**
 * National publishers whose RSS feeds answered HTTP 200 with RSS on 2 November 2026 (docs/DATA_SOURCES.md).
 * Their terms were NOT individually reviewed, so every one is `restricted` exactly like Premium Times:
 * headline, short excerpt, timestamp, attribution and an outbound link only. robots.txt is read and obeyed
 * on every run (see robots.ts), and nothing is published without human review.
 */
function nationalPublisher(input: {
  slug: string;
  name: string;
  host: string;
  feedPath: string;
  note?: string;
  tier?: IngestionSource["tier"];
  sourceType?: IngestionSource["sourceType"];
}): IngestionSource {
  const bare = input.host.replace(/^www\./, "");
  return {
    slug: input.slug,
    name: input.name,
    sourceType: input.sourceType ?? "news",
    tier: input.tier ?? "major_publisher",
    baseUrl: `https://${input.host}`,
    feedUrl: `https://${input.host}${input.feedPath}`,
    accessMethod: "rss",
    independenceGroup: input.slug,
    licenceStatus: "restricted",
    attribution: `${input.name} — headline and short excerpt, linked to the original article.`,
    reliabilityNote:
      input.note ??
      "Major Nigerian news publisher. Restricted ingestion: metadata and short excerpt only; no full text or images. Terms not individually reviewed; robots.txt is enforced on every run.",
    active: true,
    allowedHosts: [...new Set([input.host, bare, `www.${bare}`])],
    maxItems: 40,
    excerptLimit: 320,
    crawlDelayMs: 10_000,
    maxAgeDays: 30,
  };
}

export const CHANNELS_TV = nationalPublisher({ slug: "channels-tv", name: "Channels Television", host: "www.channelstv.com", feedPath: "/feed/" });
export const PUNCH = nationalPublisher({ slug: "punch", name: "Punch", host: "punchng.com", feedPath: "/feed/" });
export const VANGUARD = nationalPublisher({ slug: "vanguard", name: "Vanguard", host: "www.vanguardngr.com", feedPath: "/feed/" });
export const DAILY_TRUST = nationalPublisher({ slug: "daily-trust", name: "Daily Trust", host: "dailytrust.com", feedPath: "/feed/" });
export const BUSINESSDAY = nationalPublisher({ slug: "businessday", name: "BusinessDay", host: "businessday.ng", feedPath: "/feed/" });
export const TRIBUNE = nationalPublisher({ slug: "nigerian-tribune", name: "Nigerian Tribune", host: "tribuneonlineng.com", feedPath: "/feed/" });

export const DAILY_POST = nationalPublisher({ slug: "daily-post", name: "Daily Post", host: "dailypost.ng", feedPath: "/feed/" });
export const BLUEPRINT = nationalPublisher({ slug: "blueprint", name: "Blueprint", host: "blueprint.ng", feedPath: "/feed/" });
export const LEADERSHIP = nationalPublisher({ slug: "leadership", name: "Leadership", host: "leadership.ng", feedPath: "/feed/" });
export const PM_NEWS = nationalPublisher({ slug: "pm-news", name: "PM News", host: "pmnewsnigeria.com", feedPath: "/feed/" });
export const RIPPLES = nationalPublisher({ slug: "ripples-nigeria", name: "Ripples Nigeria", host: "www.ripplesnigeria.com", feedPath: "/feed/" });
export const THE_WILL = nationalPublisher({ slug: "the-will", name: "The Will", host: "thewillnews.com", feedPath: "/feed/" });
export const INFORMATION_NG = nationalPublisher({ slug: "information-ng", name: "Information Nigeria", host: "www.informationng.com", feedPath: "/feed" });
export const POINT_BLANK = nationalPublisher({ slug: "point-blank-news", name: "Point Blank News", host: "pointblanknews.com", feedPath: "/pbn/feed/" });
export const HALLMARK = nationalPublisher({ slug: "hallmark", name: "Hallmark", host: "hallmarknews.com", feedPath: "/feed/" });
export const THE_NATION_POLITICS = nationalPublisher({ slug: "the-nation-politics", name: "The Nation (politics)", host: "thenationonlineng.net", feedPath: "/politics/feed/", note: "Politics section only. Major national daily; the main feed is still an unverified candidate." });
export const INDEPENDENT_POLITICS = nationalPublisher({ slug: "independent-politics", name: "Independent Nigeria (politics)", host: "independent.ng", feedPath: "/category/politics/feed/", note: "Politics section only." });
export const DAILY_REPORT_POLITICS = nationalPublisher({ slug: "daily-report-politics", name: "Daily Report Nigeria (politics)", host: "dailyreport.ng", feedPath: "/politics/feed/", note: "Politics section only." });
export const NEWSGURU_POLITICS = nationalPublisher({ slug: "newsguru-politics", name: "The NewsGuru (politics)", host: "thenewsguru.com", feedPath: "/category/politics/feed/", note: "Politics section only.", tier: "regional_publisher" });
export const THE_TIDE = nationalPublisher({ slug: "the-tide", name: "The Tide (Rivers State)", host: "thetidenewsonline.com", feedPath: "/feed/", tier: "regional_publisher" });
export const HERALD = nationalPublisher({ slug: "herald", name: "The Herald", host: "herald.ng", feedPath: "/feed/" });

/**
 * GDELT DOC API: title-and-link leads from hundreds of Nigerian outlets, which is how coverage reaches beyond the
 * feeds listed here. No excerpt exists, so classification rests on the headline alone. Articles from outlets read
 * directly are dropped (see gdelt.ts), every GDELT source shares one independence group, and one article matched
 * by several GDELT queries is stored once (the article identity uses the group, not the query).
 * Each query returns up to 250 articles; GDELT asks for one request per 5 seconds, so a scheduled run executes
 * only two of these (rotating) and spaces them out. See the cron route.
 */
function gdeltSource(input: { slug: string; name: string; query: string; note: string }): IngestionSource {
  const params = new URLSearchParams({ query: input.query, mode: "artlist", format: "json", maxrecords: "250", timespan: "90min", sort: "datedesc" });
  return {
    slug: input.slug,
    name: input.name,
    sourceType: "aggregator",
    tier: "aggregator",
    baseUrl: "https://api.gdeltproject.org",
    feedUrl: `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`,
    accessMethod: "gdelt",
    independenceGroup: "gdelt",
    licenceStatus: "restricted",
    attribution: "Headline and link via the GDELT Project; the article belongs to the outlet it links to.",
    reliabilityNote: input.note,
    active: true,
    allowedHosts: ["api.gdeltproject.org"],
    maxItems: 250,
    excerptLimit: 80,
    crawlDelayMs: 10_000,
    maxAgeDays: 2,
    linkPolicy: "any_public_https",
  };
}

const GDELT_NOTE =
  "Aggregator index. Headline and link only, no excerpt. Counts as one independent source group however many outlets it lists.";

function zoneTerms(zone: ZoneId): string {
  const names = STATES.filter((state) => state.zone === zone).map((state) => (state.id === "NG-FC" ? "Abuja" : state.name));
  return `(${names.map((name) => (name.includes(" ") ? `"${name}"` : name)).join(" OR ")})`;
}

/** The domestic query keeps its original name; the others add depth by region and cover foreign outlets. */
export const GDELT_NIGERIA: IngestionSource = gdeltSource({
  slug: "gdelt-nigeria",
  name: "GDELT (Nigerian news outlets)",
  query: "sourcecountry:NI sourcelang:english",
  note: GDELT_NOTE,
});
const GDELT_SOURCES: readonly IngestionSource[] = [
  GDELT_NIGERIA,
  gdeltSource({
    slug: "gdelt-international",
    name: "GDELT (foreign outlets on Nigeria)",
    query: "Nigeria sourcelang:english -sourcecountry:NI",
    note: GDELT_NOTE,
  }),
  ...ZONE_IDS.map((zone) =>
    gdeltSource({
      slug: `gdelt-${zone}`,
      name: `GDELT · ${zone.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}`,
      query: `sourcecountry:NI sourcelang:english ${zoneTerms(zone)}`,
      note: GDELT_NOTE,
    }),
  ),
];

/**
 * Official weather warnings: NiMet's Common Alerting Protocol feed, listed in the WMO Alerting Authority register.
 * Alerts name regions, so unlike most national bulletins they can be placed on the state map.
 */
export const NIMET_ALERTS = nationalPublisher({
  slug: "nimet-alerts",
  name: "NiMet weather alerts (official)",
  host: "cap-sources.s3.amazonaws.com",
  feedPath: "/ng-nimet-en/rss.xml",
  tier: "official",
  sourceType: "official",
  note: "Official Nigerian Meteorological Agency weather warnings (CAP, English). Warnings, not news reports; severity is software-assigned.",
});

const BUILT_IN_SOURCES: readonly IngestionSource[] = [
  PREMIUM_TIMES,
  CHANNELS_TV,
  PUNCH,
  VANGUARD,
  DAILY_TRUST,
  BUSINESSDAY,
  TRIBUNE,
  DAILY_POST,
  BLUEPRINT,
  LEADERSHIP,
  PM_NEWS,
  RIPPLES,
  THE_WILL,
  INFORMATION_NG,
  POINT_BLANK,
  HALLMARK,
  THE_TIDE,
  HERALD,
  THE_NATION_POLITICS,
  INDEPENDENT_POLITICS,
  DAILY_REPORT_POLITICS,
  NEWSGURU_POLITICS,
  NIMET_ALERTS,
  ...GDELT_SOURCES,
];

/**
 * How well each registered feed is evidenced. Honest labels, because none of the feeds below was fetched by
 * the build tooling (it has no internet access):
 *   verified     - observed returning RSS by the project author (docs/DATA_SOURCES.md, 2 Nov 2026)
 *   third_party  - a feed reader, relay or licensing marketplace shows recent posts from this feed
 *   directory    - listed with this feed URL in a public feed directory (FeedSpot, updated 20 Aug 2026)
 * `npm run sources:check` is the first-hand test; a source that fails it is skipped at runtime anyway.
 */
export type EvidenceLevel = "verified" | "third_party" | "directory";
const BUILT_IN_EVIDENCE: Readonly<Record<string, { level: EvidenceLevel; note: string }>> = {
  "premium-times": { level: "verified", note: "Fetched and robots reviewed 5 Nov 2026." },
  "channels-tv": { level: "verified", note: "HTTP 200 RSS on 2 Nov 2026." },
  punch: { level: "verified", note: "HTTP 200 RSS on 2 Nov 2026. A relay also reads a Punch feed from rss.punchng.com." },
  vanguard: { level: "verified", note: "HTTP 200 RSS on 2 Nov 2026; also in FeedSpot (Aug 2026)." },
  "daily-trust": { level: "verified", note: "HTTP 200 RSS on 2 Nov 2026." },
  businessday: { level: "verified", note: "HTTP 200 RSS on 2 Nov 2026; also in FeedSpot (Aug 2026)." },
  "nigerian-tribune": { level: "verified", note: "HTTP 200 RSS on 2 Nov 2026." },
  "daily-post": { level: "third_party", note: "RSS Parrot posting from it (last seen 3 Mar 2026), Feeder and a feed catalogue list it; FeedSpot (Aug 2026)." },
  blueprint: { level: "third_party", note: "RSS Parrot relaying it, last post 3 Mar 2026." },
  leadership: { level: "third_party", note: "In FeedSpot (Aug 2026); RSS Parrot last relayed it 22 Dec 2025, so activity is less certain." },
  "pm-news": { level: "directory", note: "FeedSpot (Aug 2026)." },
  "ripples-nigeria": { level: "directory", note: "FeedSpot (Aug 2026)." },
  "the-will": { level: "directory", note: "FeedSpot (Aug 2026)." },
  "information-ng": { level: "directory", note: "FeedSpot (Aug 2026)." },
  "point-blank-news": { level: "directory", note: "FeedSpot (Aug 2026)." },
  hallmark: { level: "directory", note: "FeedSpot (Aug 2026)." },
  "the-tide": { level: "directory", note: "FeedSpot (Aug 2026); Rivers State government-owned daily." },
  herald: { level: "directory", note: "FeedSpot (Aug 2026)." },
  "the-nation-politics": { level: "directory", note: "FeedSpot politics list (Aug 2026), politics section feed." },
  "independent-politics": { level: "directory", note: "FeedSpot politics list (Aug 2026), politics section feed." },
  "daily-report-politics": { level: "directory", note: "FeedSpot politics list (Aug 2026), politics section feed." },
  "newsguru-politics": { level: "directory", note: "FeedSpot politics list (Aug 2026), politics section feed." },
  "nimet-alerts": { level: "third_party", note: "Listed as NiMet's official English CAP feed in the WMO Alerting Authority register." },
  ...Object.fromEntries(
    ["gdelt-nigeria", "gdelt-international", ...ZONE_IDS.map((zone) => `gdelt-${zone}`)].map((slug) => [
      slug,
      { level: "third_party" as const, note: "GDELT DOC 2.0 API: the endpoint, operators, 250-article cap and 5-second limit are documented by several independent tools; not yet fetched by the build tooling." },
    ]),
  ),
};

/** One entry of src/config/extra-sources.json: add a site there to start ingesting it, no code needed. */
export const extraSourceEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "slug: 3-40 lowercase letters, digits or hyphens"),
  name: z.string().trim().min(2).max(80),
  feedUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "feedUrl must be https"),
  tier: z.enum(["major_publisher", "regional_publisher", "unknown"]).optional(),
  note: z.string().max(300).optional(),
  evidence: z
    .object({
      level: z.enum(["verified", "third_party", "directory"]),
      note: z.string().min(3).max(300),
    })
    .optional(),
});
export type ExtraSourceEntry = z.infer<typeof extraSourceEntrySchema>;

/**
 * Builds sources from the JSON file. Every entry is `restricted` like the built-in ones, goes through the same
 * robots.txt check and failure isolation, and a bad entry throws, so a typo fails the build instead of
 * silently ingesting from the wrong place. Slugs must not clash with built-in sources or each other.
 */
export function buildExtraSources(
  entries: unknown,
  taken: ReadonlySet<string>,
): { sources: IngestionSource[]; evidence: Record<string, { level: EvidenceLevel; note: string }> } {
  const parsed = z.array(extraSourceEntrySchema).parse(entries);
  const seen = new Set(taken);
  const sources: IngestionSource[] = [];
  const evidence: Record<string, { level: EvidenceLevel; note: string }> = {};
  for (const entry of parsed) {
    if (seen.has(entry.slug)) throw new Error(`extra-sources.json: slug "${entry.slug}" is already used.`);
    seen.add(entry.slug);
    const feed = new URL(entry.feedUrl);
    sources.push(
      nationalPublisher({
        slug: entry.slug,
        name: entry.name,
        host: feed.hostname,
        feedPath: feed.pathname + feed.search,
        tier: entry.tier,
        note: entry.note,
      }),
    );
    evidence[entry.slug] = entry.evidence ?? { level: "directory", note: "Added through src/config/extra-sources.json; not yet checked." };
  }
  return { sources, evidence };
}

const EXTRA = buildExtraSources(extraSourcesJson, new Set(BUILT_IN_SOURCES.map((source) => source.slug)));

export const INGESTION_SOURCES: readonly IngestionSource[] = [...BUILT_IN_SOURCES, ...EXTRA.sources];
export const SOURCE_EVIDENCE: Readonly<Record<string, { level: EvidenceLevel; note: string }>> = {
  ...BUILT_IN_EVIDENCE,
  ...EXTRA.evidence,
};

export interface FeedCandidate {
  slug: string;
  name: string;
  feedUrl: string;
  note?: string;
}

/**
 * NOT ingestible. Outlets that are real but whose feed is not yet evidenced well enough, or is known to
 * fail from automated clients. URLs marked (FeedSpot) come from a public directory; the rest are
 * conventional guesses. Run `npm run sources:check -- --candidates` from a machine with internet access;
 * promote an entry into INGESTION_SOURCES (with an evidence entry) only when it reports READY and you have
 * considered the publisher's terms.
 */
export const UNVERIFIED_FEED_CANDIDATES: readonly FeedCandidate[] = [
  { slug: "guardian-ng", name: "The Guardian Nigeria", feedUrl: "https://guardian.ng/feed/", note: "403 to automated requests on 2 Nov 2026; relays read it until Jan 2026." },
  { slug: "legit-ng", name: "Legit.ng", feedUrl: "https://www.legit.ng/rss/all.rss", note: "Did not resolve for the project author on 2 Nov 2026; a relay read this URL in Mar 2026." },
  { slug: "the-nation", name: "The Nation", feedUrl: "https://thenationonlineng.net/feed/" },
  { slug: "the-sun", name: "The Sun", feedUrl: "https://thesun.ng/feed/" },
  { slug: "independent", name: "Independent Nigeria", feedUrl: "https://independent.ng/feed/" },
  { slug: "thisday", name: "ThisDay", feedUrl: "https://www.thisdaylive.com/feed/" },
  { slug: "nairametrics", name: "Nairametrics", feedUrl: "https://nairametrics.com/feed/" },
  { slug: "daily-nigerian", name: "Daily Nigerian", feedUrl: "https://dailynigerian.com/feed/" },
  { slug: "peoples-gazette", name: "The Peoples Gazette", feedUrl: "https://gazettengr.com/feed/" },
  { slug: "tvc-news", name: "TVC News", feedUrl: "https://www.tvcnews.tv/feed/" },
  { slug: "arise", name: "Arise News", feedUrl: "https://www.arise.tv/feed/" },
  { slug: "nan", name: "News Agency of Nigeria", feedUrl: "https://nannews.ng/feed/" },
  { slug: "converseer", name: "Converseer", feedUrl: "https://converseer.com/feed/", note: "FeedSpot" },
  { slug: "news-chronicle", name: "The News Chronicle", feedUrl: "https://thenews-chronicle.com/feed/", note: "FeedSpot" },
  { slug: "daily-news-reporters", name: "Daily News Reporters", feedUrl: "https://dailynewsreporters.com/feed/", note: "FeedSpot" },
  { slug: "the-bureau", name: "The Bureau", feedUrl: "https://thebureau.com.ng/feed/", note: "FeedSpot" },
  { slug: "newsblenda", name: "NewsBlenda", feedUrl: "https://newsblenda.com/feed/", note: "FeedSpot" },
  { slug: "media-nigeria", name: "Media Nigeria", feedUrl: "https://medianigeria.com/feed/", note: "FeedSpot" },
  { slug: "the-infostride", name: "The Infostride", feedUrl: "https://theinfostride.com/feed/", note: "FeedSpot" },
  { slug: "african-examiner", name: "African Examiner", feedUrl: "https://africanexaminer.com/feed/", note: "FeedSpot" },
  { slug: "naijnaira", name: "NaijNaira", feedUrl: "https://naijnaira.com/feed/", note: "FeedSpot" },
];

/** Hosts of the publishers read directly, so an aggregator can skip articles already captured from their feeds. */
export function registeredPublisherHosts(): Set<string> {
  return new Set(
    INGESTION_SOURCES.filter((source) => source.accessMethod === "rss").flatMap((source) => [...source.allowedHosts]),
  );
}

/** An inactive source built from an unverified candidate, used only by `npm run sources:check` to probe it. */
export function probeSourceFor(candidate: FeedCandidate): IngestionSource {
  const feed = new URL(candidate.feedUrl);
  return {
    ...nationalPublisher({
      slug: candidate.slug,
      name: candidate.name,
      host: feed.hostname,
      feedPath: feed.pathname + feed.search,
    }),
    active: false,
  };
}

/** Slugs switched off with INGESTION_DISABLE=slug,slug, e.g. after a publisher asks to be removed. No redeploy of code needed. */
export function disabledSourceSlugs(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.INGESTION_DISABLE ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Active sources selected by a comma list of slugs or "all", minus anything in INGESTION_DISABLE. Unknown slugs fail loudly. */
export function selectIngestionSources(
  selection: string,
  env: Record<string, string | undefined> = process.env,
): IngestionSource[] {
  const disabled = disabledSourceSlugs(env);
  const wanted = selection
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) throw new Error("No ingestion source selected.");
  if (wanted.includes("all")) return INGESTION_SOURCES.filter((source) => source.active && !disabled.has(source.slug));
  const seen = new Set<string>();
  return wanted.flatMap((slug) => {
    if (seen.has(slug)) return [];
    seen.add(slug);
    const source = requireIngestionSource(slug);
    if (!source.active) throw new Error(`Ingestion source ${slug} is not active.`);
    if (disabled.has(slug)) throw new Error(`Ingestion source ${slug} is disabled by INGESTION_DISABLE.`);
    return [source];
  });
}

const SOURCE_BY_SLUG = new Map(INGESTION_SOURCES.map((source) => [source.slug, source]));

export function ingestionSource(slug: string): IngestionSource | null {
  return SOURCE_BY_SLUG.get(slug) ?? null;
}

export function requireIngestionSource(slug: string): IngestionSource {
  const source = ingestionSource(slug);
  if (!source) {
    throw new Error(
      `Unknown ingestion source "${slug}". Available: ${INGESTION_SOURCES.map((item) => item.slug).join(", ")}.`,
    );
  }
  return source;
}

function assertSource(source: IngestionSource): void {
  const base = new URL(source.baseUrl);
  const feed = new URL(source.feedUrl);
  if (base.protocol !== "https:" || feed.protocol !== "https:") {
    throw new Error(`Ingestion source ${source.slug} must use HTTPS.`);
  }
  if (!source.allowedHosts.includes(feed.hostname)) {
    throw new Error(`Feed host ${feed.hostname} is not in the allowed host list for ${source.slug}.`);
  }
  if (!source.allowedHosts.includes(base.hostname)) {
    throw new Error(`Base host ${base.hostname} is not in the allowed host list for ${source.slug}.`);
  }
  const maxAllowed = source.accessMethod === "gdelt" ? 250 : 100;
  if (source.maxItems < 1 || source.maxItems > maxAllowed) {
    throw new Error(`Source ${source.slug} maxItems must be between 1 and ${maxAllowed}.`);
  }
  if (source.excerptLimit < 80 || source.excerptLimit > 500) {
    throw new Error(`Source ${source.slug} excerptLimit must be between 80 and 500.`);
  }
  if (source.crawlDelayMs < 1_000) {
    throw new Error(`Source ${source.slug} crawlDelayMs must be at least 1000ms.`);
  }
  if (source.licenceStatus === "rejected") {
    throw new Error(`Source ${source.slug} is rejected and cannot be ingested.`);
  }
}

for (const source of INGESTION_SOURCES) assertSource(source);
