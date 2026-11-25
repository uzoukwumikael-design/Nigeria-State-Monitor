import type { Category, SourceTier, SourceType } from "@/lib/types";

export type IngestionLicenceStatus = "approved" | "restricted" | "rejected" | "unreviewed";
export type CandidateStatus = "pending" | "needs_review" | "rejected";

export interface IngestionSource {
  /** Stable slug used by the database and CLI. */
  slug: string;
  name: string;
  sourceType: Exclude<SourceType, "demo">;
  tier: SourceTier;
  baseUrl: string;
  feedUrl: string;
  accessMethod: "rss" | "gdelt";
  independenceGroup: string;
  licenceStatus: IngestionLicenceStatus;
  attribution: string;
  reliabilityNote: string;
  active: boolean;
  /** Exact hosts the feed and its article links may use. */
  allowedHosts: readonly string[];
  /** Maximum feed entries considered in one run. */
  maxItems: number;
  /** Maximum stored excerpt length in characters. */
  excerptLimit: number;
  /** Publisher crawl delay from robots.txt, in milliseconds. */
  crawlDelayMs: number;
  /** Reject items older than this on first capture. */
  maxAgeDays: number;
  /**
   * Where article links may point. Default `allowed_hosts`: only the publisher's own hosts. An aggregator
   * links to many outlets, so it uses `any_public_https` (public HTTPS hosts only; links are stored and
   * shown, never fetched).
   */
  linkPolicy?: "allowed_hosts" | "any_public_https";
}

export interface ParsedRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  categories: string[];
  guid: string | null;
}

export interface ParsedRssFeed {
  title: string;
  items: ParsedRssItem[];
}

export interface CategoryPrior {
  category: Category | null;
  confidence: number;
  scores: Record<Category, number>;
  matches: string[];
  ambiguous: boolean;
}

export interface GeographyPrior {
  stateId: string | null;
  lga: string | null;
  confidence: number;
  matches: string[];
  ambiguous: boolean;
  multipleStates: string[];
  /** True when the text names Nigeria or Nigerians, even without a state. */
  nigeriaMentioned: boolean;
}

export interface CandidateProposal {
  category: Category | null;
  stateId: string | null;
  lga: string | null;
  categoryConfidence: number;
  geoConfidence: number;
  status: CandidateStatus;
  rejectionReason: string | null;
  reasons: string[];
  ruleVersion: string;
}

export interface NormalizedIngestionItem {
  externalId: string | null;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  excerpt: string;
  publishedAt: string | null;
  retrievedAt: string;
  categories: string[];
  language: "en";
  rawHash: string;
  contentHash: string;
  categoryPrior: CategoryPrior;
  geographyPrior: GeographyPrior;
  proposal: CandidateProposal;
}

export interface RejectedFeedItem {
  externalId: string | null;
  title: string;
  url: string | null;
  reason: string;
  detail?: string;
}

export interface FeedCollection {
  source: IngestionSource;
  fetchedAt: string;
  httpStatus: number;
  contentType: string;
  feedHash: string;
  feedTitle: string;
  items: NormalizedIngestionItem[];
  rejected: RejectedFeedItem[];
}

export interface IngestionRunSummary {
  source: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  fetched: number;
  accepted: number;
  rejected: number;
  articlesInserted: number;
  articlesDuplicate: number;
  candidatesInserted: number;
  candidatesExisting: number;
  pending: number;
  needsReview: number;
  autoRejected: number;
  status: "success" | "partial" | "failed" | "skipped";
}

export interface PersistCollectionInput {
  collection: FeedCollection;
  runId: string;
  startedAt: Date;
  finishedAt: Date;
}

export interface PersistCollectionResult {
  sourceId: string;
  fetched: number;
  accepted: number;
  rejected: number;
  articlesInserted: number;
  articlesDuplicate: number;
  candidatesInserted: number;
  candidatesExisting: number;
  pending: number;
  needsReview: number;
  autoRejected: number;
  status: "success" | "partial";
}

export interface RecordFailureInput {
  source: IngestionSource;
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  error: string;
  httpStatus?: number | null;
}

export interface IngestionStore {
  persistCollection(input: PersistCollectionInput): Promise<PersistCollectionResult>;
  recordFailure(input: RecordFailureInput): Promise<void>;
}
