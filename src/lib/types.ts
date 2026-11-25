export const CATEGORY_IDS = [
  "security",
  "politics",
  "economy",
  "infrastructure",
  "environment",
  "health",
] as const;
export type Category = (typeof CATEGORY_IDS)[number];

export const ZONE_IDS = [
  "north-central",
  "north-east",
  "north-west",
  "south-east",
  "south-south",
  "south-west",
] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export const SEVERITIES = [1, 2, 3, 4, 5] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERIFICATION_STATUSES = [
  "unassessed",
  "single_source",
  "multiple_sources",
  "corroborated",
  "official_confirmation",
  "disputed",
  "retracted",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const GEO_PRECISIONS = ["exact", "lga", "state", "national", "unknown"] as const;
export type GeoPrecision = (typeof GEO_PRECISIONS)[number];

export const TIME_WINDOW_IDS = ["24h", "7d", "30d", "90d", "365d", "all"] as const;
export type TimeWindow = (typeof TIME_WINDOW_IDS)[number];

export const REGIONAL_TREND_DAYS = [7, 14, 30] as const;
export type RegionalTrendDays = (typeof REGIONAL_TREND_DAYS)[number];

export const SOURCE_TIERS = [
  "official",
  "major_publisher",
  "regional_publisher",
  "aggregator",
  "unknown",
] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export type SourceType = "news" | "official" | "international" | "aggregator" | "research" | "demo";
export type SourceRelationship = "primary" | "supporting" | "conflicting" | "retracted" | "background";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface StateGeo {
  id: string;
  name: string;
  iso: string;
  zone: ZoneId;
  zoneName: string;
  capital: string;
  capitalLga: string;
  areaKm2: number;
  labelPoint: LatLng;
  capitalPoint: LatLng;
  bbox: BoundingBox;
}

export interface EventSourceRef {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceTier: SourceTier;
  sourceType: SourceType;
  headline: string;
  url: string | null;
  publishedAt: string;
  retrievedAt: string;
  relationship: SourceRelationship;
  independenceGroup: string;
  isDemo: boolean;
}

export type EventUpdateType =
  | "new_report"
  | "casualty_update"
  | "official_statement"
  | "correction"
  | "retraction"
  | "location_update"
  | "verification_change"
  | "context";

export interface EventTimelineEntry {
  id: string;
  type: EventUpdateType;
  description: string;
  sourceId: string | null;
  sourceName: string | null;
  actor: "pipeline" | "reviewer" | "system";
  createdAt: string;
}

export interface IntelligenceEvent {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: Category;
  subcategory: string;
  severity: Severity;
  severityRationale: string;
  stateId: string | null;
  stateName: string | null;
  zone: ZoneId | null;
  lga: string | null;
  coordinates: LatLng | null;
  geoPrecision: GeoPrecision;
  geoConfidence: number;
  occurrenceAt: string | null;
  firstReportedAt: string;
  lastUpdatedAt: string;
  verificationStatus: VerificationStatus;
  confidence: number;
  independentSourceCount: number;
  articleCount: number;
  sources: EventSourceRef[];
  timeline: EventTimelineEntry[];
  uncertainties: string[];
  analysis: string;
  analysisKind: "automated_demo_summary" | "ai_analysis" | "none";
  isDemo: boolean;
  relatedEventIds: string[];
}

export interface SourceRegistryEntry {
  id: string;
  name: string;
  sourceType: SourceType;
  tier: SourceTier;
  independenceGroup: string;
  baseUrl: string | null;
  accessMethod: "rss" | "api" | "html" | "manual" | "demo";
  active: boolean;
  lastSuccessfulSync: string | null;
  isDemo: boolean;
  reliabilityNote: string;
}

export interface DatasetCoverage {
  from: string | null;
  to: string | null;
  basis: "demo_snapshot" | "live_ingestion";
  label: string;
}

export interface DashboardSnapshot {
  mode: "demo" | "production";
  datasetVersion: string;
  generatedAt: string;
  referenceTime: string;
  states: StateGeo[];
  events: IntelligenceEvent[];
  sources: SourceRegistryEntry[];
  coverage: DatasetCoverage;
  disclaimer: string | null;
  limitations: string[];
}

export interface Filters {
  category: Category | "all";
  zone: ZoneId | "all";
  stateId: string | null;
  severity: Severity | "all";
  verification: VerificationStatus | "all";
  window: TimeWindow;
  q: string;
}

export const DEFAULT_FILTERS: Filters = {
  category: "all",
  zone: "all",
  stateId: null,
  severity: "all",
  verification: "all",
  window: "30d",
  q: "",
};

export interface SearchHit {
  kind: "state" | "event" | "category" | "zone";
  id: string;
  title: string;
  subtitle: string;
  icon: Category | "state" | "zone";
}

export interface SearchResults {
  states: SearchHit[];
  events: SearchHit[];
  categories: SearchHit[];
  zones: SearchHit[];
}
