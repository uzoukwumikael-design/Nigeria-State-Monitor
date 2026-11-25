import type { DatasetMode } from "@/lib/dataset-labels";
import {
  CATEGORIES,
  VERIFICATION_CONFIG,
  categoryConfig,
  zoneConfig,
} from "@/lib/config";
import { formatDayKey, lagosDayKey } from "@/lib/format";
import { STATES, stateById } from "@/lib/geo/states";
import {
  SEVERITIES,
  type Category,
  type Filters,
  type IntelligenceEvent,
  type Severity,
  type StateGeo,
  type VerificationStatus,
  type ZoneId,
} from "@/lib/types";

export interface StateStats {
  stateId: string;
  reportedEvents: number;
  last24h: number;
  critical: number;
  corroborated: number;
  disputed: number;
  latestReportedAt: string | null;
  topCategory: Category | null;
  categories: Record<Category, number>;
  severities: Record<Severity, number>;
  verification: Record<VerificationStatus, number>;
  independentSourceGroups: number;
}

export interface NamedCount {
  id: string;
  name: string;
  count: number;
  share: number;
  color?: string;
}

export interface CategoryBreakdown {
  category: Category;
  label: string;
  color: string;
  count: number;
  share: number;
}

export interface SeverityBreakdown {
  severity: Severity;
  label: string;
  color: string;
  count: number;
  share: number;
}

export interface ZoneSummary {
  zone: ZoneId;
  name: string;
  shortName: string;
  color: string;
  reportedEvents: number;
  share: number;
  critical: number;
  disputed: number;
  statesReporting: number;
  topCategory: Category | null;
  topStates: NamedCount[];
  categories: Record<Category, number>;
  latestReportedAt: string | null;
}

export interface TrendPoint {
  day: string;
  label: string;
  total: number;
  critical: number;
  severity4Plus: number;
  byCategory: Record<Category, number>;
}

export interface SourceBreakdown {
  id: string;
  name: string;
  tier: string;
  count: number;
  share: number;
  isDemo: boolean;
}

export interface NationalSummary {
  totals: {
    reportedEvents: number;
    last24h: number;
    critical: number;
    severity4Plus: number;
    corroborated: number;
    disputed: number;
    singleSource: number;
    unassessed: number;
    nationalEvents: number;
    statesWithReports: number;
    independentSourceGroups: number;
  };
  topStates: NamedCount[];
  categories: CategoryBreakdown[];
  severity: SeverityBreakdown[];
  zones: ZoneSummary[];
  sourceDistribution: SourceBreakdown[];
  assessment: string;
  assessmentKind: "automated_demo_summary";
  scopeLabel: string;
}

function emptyCategoryCounts(): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((category) => [category.id, 0])) as Record<Category, number>;
}

function emptySeverityCounts(): Record<Severity, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function emptyVerificationCounts(): Record<VerificationStatus, number> {
  return Object.fromEntries(
    Object.keys(VERIFICATION_CONFIG).map((status) => [status, 0]),
  ) as Record<VerificationStatus, number>;
}

export function countByCategory(events: readonly IntelligenceEvent[]): Record<Category, number> {
  const counts = emptyCategoryCounts();
  for (const event of events) counts[event.category] += 1;
  return counts;
}

export function countBySeverity(events: readonly IntelligenceEvent[]): Record<Severity, number> {
  const counts = emptySeverityCounts();
  for (const event of events) counts[event.severity] += 1;
  return counts;
}

export function categoryBreakdown(events: readonly IntelligenceEvent[]): CategoryBreakdown[] {
  const total = events.length;
  return CATEGORIES.map((category) => {
    const count = events.filter((event) => event.category === category.id).length;
    return {
      category: category.id,
      label: category.shortLabel,
      color: category.color,
      count,
      share: total > 0 ? count / total : 0,
    };
  }).sort((a, b) => b.count - a.count);
}

export function severityBreakdown(events: readonly IntelligenceEvent[]): SeverityBreakdown[] {
  const total = events.length;
  return SEVERITIES.map((severity) => {
    const count = events.filter((event) => event.severity === severity).length;
    return {
      severity,
      label: severity === 1 ? "Info" : severity === 2 ? "Low" : severity === 3 ? "Moderate" : severity === 4 ? "High" : "Critical",
      color: ["#64748B", "#35BDF2", "#FFB020", "#FB923C", "#FF4757"][severity - 1] ?? "#64748B",
      count,
      share: total > 0 ? count / total : 0,
    };
  });
}

export function verificationBreakdown(
  events: readonly IntelligenceEvent[],
): Array<{ status: VerificationStatus; label: string; count: number; color: string }> {
  const counts = emptyVerificationCounts();
  for (const event of events) counts[event.verificationStatus] += 1;
  return (Object.keys(counts) as VerificationStatus[]).map((status) => ({
    status,
    label: VERIFICATION_CONFIG[status].label,
    count: counts[status],
    color: VERIFICATION_CONFIG[status].color,
  }));
}

export function getStateStats(
  events: readonly IntelligenceEvent[],
  state: StateGeo,
  referenceIso: string,
): StateStats {
  const stateEvents = events.filter((event) => event.stateId === state.id);
  const categories = countByCategory(stateEvents);
  const severities = countBySeverity(stateEvents);
  const verification = emptyVerificationCounts();
  for (const event of stateEvents) verification[event.verificationStatus] += 1;
  const topCategory =
    CATEGORIES.map((category) => ({ id: category.id, count: categories[category.id] }))
      .sort((a, b) => b.count - a.count)[0]?.id ?? null;
  const latest = [...stateEvents].sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0] ?? null;
  const reference = new Date(referenceIso).getTime();
  return {
    stateId: state.id,
    reportedEvents: stateEvents.length,
    last24h: stateEvents.filter(
      (event) => new Date(event.occurrenceAt ?? event.firstReportedAt).getTime() >= reference - 86_400_000,
    ).length,
    critical: stateEvents.filter((event) => event.severity === 5).length,
    corroborated: stateEvents.filter(
      (event) =>
        event.verificationStatus === "corroborated" ||
        event.verificationStatus === "official_confirmation",
    ).length,
    disputed: stateEvents.filter((event) => event.verificationStatus === "disputed").length,
    latestReportedAt: latest?.lastUpdatedAt ?? null,
    topCategory: topCategory && (categories[topCategory] ?? 0) > 0 ? topCategory : null,
    categories,
    severities,
    verification,
    independentSourceGroups: new Set(stateEvents.flatMap((event) => event.sources.map((source) => source.independenceGroup))).size,
  };
}

export function allStateStats(
  events: readonly IntelligenceEvent[],
  states: readonly StateGeo[],
  referenceIso: string,
): Record<string, StateStats> {
  return Object.fromEntries(states.map((state) => [state.id, getStateStats(events, state, referenceIso)]));
}

export function topStates(
  events: readonly IntelligenceEvent[],
  states: readonly StateGeo[],
  limit = 6,
): NamedCount[] {
  const total = events.filter((event) => event.stateId).length;
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.stateId) continue;
    counts.set(event.stateId, (counts.get(event.stateId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      name: stateById(id)?.name ?? id,
      count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function zoneSummaries(events: readonly IntelligenceEvent[], _referenceIso: string): ZoneSummary[] {
  const zoned = events.filter((event) => event.zone);
  return (["north-central", "north-east", "north-west", "south-east", "south-south", "south-west"] as ZoneId[]).map(
    (zoneId) => {
      const config = zoneConfig(zoneId);
      const zoneEvents = zoned.filter((event) => event.zone === zoneId);
      const categories = countByCategory(zoneEvents);
      const topCategory =
        CATEGORIES.map((category) => ({ id: category.id, count: categories[category.id] }))
          .sort((a, b) => b.count - a.count)[0]?.id ?? null;
      const statesReporting = new Set(zoneEvents.map((event) => event.stateId).filter(Boolean)).size;
      const latest = [...zoneEvents].sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0] ?? null;
      return {
        zone: zoneId,
        name: config.name,
        shortName: config.shortName,
        color: config.color,
        reportedEvents: zoneEvents.length,
        share: zoned.length > 0 ? zoneEvents.length / zoned.length : 0,
        critical: zoneEvents.filter((event) => event.severity === 5).length,
        disputed: zoneEvents.filter((event) => event.verificationStatus === "disputed").length,
        statesReporting,
        topCategory: topCategory && (categories[topCategory] ?? 0) > 0 ? topCategory : null,
        topStates: topStates(zoneEvents, STATES, 3),
        categories,
        latestReportedAt: latest?.lastUpdatedAt ?? null,
      };
    },
  ).sort((a, b) => b.reportedEvents - a.reportedEvents);
}

export function sourceDistribution(events: readonly IntelligenceEvent[]): SourceBreakdown[] {
  const counts = new Map<string, { name: string; tier: string; isDemo: boolean; count: number }>();
  for (const event of events) {
    const seen = new Set<string>();
    for (const source of event.sources) {
      if (seen.has(source.sourceId)) continue;
      seen.add(source.sourceId);
      const existing = counts.get(source.sourceId);
      if (existing) existing.count += 1;
      else
        counts.set(source.sourceId, {
          name: source.sourceName,
          tier: source.sourceTier,
          isDemo: source.isDemo,
          count: 1,
        });
    }
  }
  const total = events.length;
  return [...counts.entries()]
    .map(([id, value]) => ({
      id,
      name: value.name,
      tier: value.tier,
      count: value.count,
      share: total > 0 ? value.count / total : 0,
      isDemo: value.isDemo,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export function trendSeries(
  events: readonly IntelligenceEvent[],
  referenceIso: string,
  days = 14,
): TrendPoint[] {
  const safeDays = Math.max(1, Math.min(90, Math.round(days)));
  const reference = new Date(referenceIso).getTime();
  const dayKeys: string[] = [];
  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const key = lagosDayKey(new Date(reference - offset * 86_400_000));
    if (!dayKeys.includes(key)) dayKeys.push(key);
  }
  const bucketMap = new Map<string, TrendPoint>();
  for (const day of dayKeys) {
    bucketMap.set(day, {
      day,
      label: formatDayKey(day),
      total: 0,
      critical: 0,
      severity4Plus: 0,
      byCategory: emptyCategoryCounts(),
    });
  }
  for (const event of events) {
    const timestamp = event.occurrenceAt ?? event.firstReportedAt;
    const bucket = bucketMap.get(lagosDayKey(timestamp));
    if (!bucket) continue;
    bucket.total += 1;
    bucket.byCategory[event.category] += 1;
    if (event.severity === 5) bucket.critical += 1;
    if (event.severity >= 4) bucket.severity4Plus += 1;
  }
  return [...bucketMap.values()];
}

export function scopeLabel(filters: Filters): string {
  const state = stateById(filters.stateId);
  const parts: string[] = [];
  if (state) parts.push(state.name);
  else if (filters.zone !== "all") parts.push(zoneConfig(filters.zone).name);
  else parts.push("Nigeria");
  if (filters.category !== "all") parts.push(categoryConfig(filters.category).shortLabel);
  if (filters.q) parts.push(`“${filters.q}”`);
  return parts.join(" · ");
}

export function buildAssessment(
  events: readonly IntelligenceEvent[],
  filters: Filters,
  referenceIso: string,
  mode: DatasetMode = "demo",
): string {
  const scope = scopeLabel(filters);
  const demo = mode === "demo";
  const demoPrefix = demo ? "fictional demo " : "";
  if (events.length === 0) {
    return `No ${demoPrefix}events match ${scope}. Adjust the state, category, severity, verification or time-window filters. No conclusion should be drawn from an empty filter result.`;
  }
  const categories = categoryBreakdown(events);
  const top = categories[0];
  const stateCount = new Set(events.map((event) => event.stateId).filter(Boolean)).size;
  const critical = events.filter((event) => event.severity === 5).length;
  const corroborated = events.filter(
    (event) =>
      event.verificationStatus === "corroborated" ||
      event.verificationStatus === "official_confirmation",
  ).length;
  const single = events.filter((event) => event.verificationStatus === "single_source").length;
  const disputed = events.filter((event) => event.verificationStatus === "disputed").length;
  const mostActive = topStates(events, STATES, 1)[0];
  const reference = new Date(referenceIso).getTime();
  const last24h = events.filter(
    (event) => new Date(event.occurrenceAt ?? event.firstReportedAt).getTime() >= reference - 86_400_000,
  ).length;

  const parts = [
    `${events.length} ${demoPrefix}event${events.length === 1 ? " is" : "s are"} in view for ${scope}, across ${stateCount} state${stateCount === 1 ? "" : "s"}.`,
    top ? `${top.label} is the largest reported category (${top.count}).` : "",
    mostActive ? `${mostActive.name} accounts for the highest reported volume (${mostActive.count}).` : "",
    `${last24h} occurred within the last 24 hours; ${critical} rated critical and ${corroborated} are corroborated or officially confirmed.`,
    `${single} rely on a single independent ${demo ? "demo " : ""}source group${disputed > 0 ? `, and ${disputed} are disputed` : ""}.`,
    `These are reported volumes from ${demo ? "a static fictional dataset" : "published reports"}, not incidence, danger or a state safety ranking. No operational conclusion should be drawn.`,
  ];
  return parts.filter(Boolean).join(" ");
}

export function nationalSummary(
  events: readonly IntelligenceEvent[],
  filters: Filters,
  referenceIso: string,
  mode: DatasetMode = "demo",
): NationalSummary {
  const reference = new Date(referenceIso).getTime();
  return {
    totals: {
      reportedEvents: events.length,
      last24h: events.filter(
        (event) => new Date(event.occurrenceAt ?? event.firstReportedAt).getTime() >= reference - 86_400_000,
      ).length,
      critical: events.filter((event) => event.severity === 5).length,
      severity4Plus: events.filter((event) => event.severity >= 4).length,
      corroborated: events.filter(
        (event) =>
          event.verificationStatus === "corroborated" ||
          event.verificationStatus === "official_confirmation",
      ).length,
      disputed: events.filter((event) => event.verificationStatus === "disputed").length,
      singleSource: events.filter((event) => event.verificationStatus === "single_source").length,
      unassessed: events.filter((event) => event.verificationStatus === "unassessed").length,
      nationalEvents: events.filter((event) => !event.stateId).length,
      statesWithReports: new Set(events.map((event) => event.stateId).filter(Boolean)).size,
      independentSourceGroups: new Set(
        events.flatMap((event) => event.sources.map((source) => source.independenceGroup)),
      ).size,
    },
    topStates: topStates(events, STATES, 7),
    categories: categoryBreakdown(events),
    severity: severityBreakdown(events),
    zones: zoneSummaries(events, referenceIso),
    sourceDistribution: sourceDistribution(events),
    assessment: buildAssessment(events, filters, referenceIso, mode),
    assessmentKind: "automated_demo_summary",
    scopeLabel: scopeLabel(filters),
  };
}
