import type { DatasetMode } from "@/lib/dataset-labels";
import { categoryConfig, zoneConfig } from "@/lib/config";
import { statesInZone } from "@/lib/geo/states";
import {
  categoryBreakdown,
  nationalSummary,
  severityBreakdown,
  sourceDistribution,
  trendSeries,
  verificationBreakdown,
  zoneSummaries,
  type CategoryBreakdown,
  type NamedCount,
  type NationalSummary,
  type SeverityBreakdown,
  type SourceBreakdown,
  type TrendPoint,
  type ZoneSummary,
} from "@/lib/intelligence/aggregate";
import { eventTimestamp } from "@/lib/intelligence/filter";
import type {
  Filters,
  IntelligenceEvent,
  VerificationStatus,
  ZoneId,
} from "@/lib/types";

export const DEFAULT_REGIONAL_DAYS = 14;

export interface ZoneComparison extends ZoneSummary {
  severity4Plus: number;
  corroborated: number;
  singleSource: number;
  sourceGroups: number;
  statesTotal: number;
  trend: TrendPoint[];
  trendTotal: number;
  activeDays: number;
}

export interface ZoneStateRow {
  id: string;
  name: string;
  count: number;
  share: number;
  critical: number;
  latestReportedAt: string | null;
}

export interface ZoneVerificationRow {
  status: VerificationStatus;
  label: string;
  count: number;
  share: number;
  color: string;
}

export interface ZoneProfileTotals {
  reportedEvents: number;
  last24h: number;
  critical: number;
  severity4Plus: number;
  corroborated: number;
  disputed: number;
  singleSource: number;
  unassessed: number;
  independentSourceGroups: number;
  statesReporting: number;
  statesTotal: number;
  zonalShare: number;
  nationalShare: number;
}

export interface ZoneProfileComparison {
  zonalAverageEvents: number;
  equalShare: number;
  highSeverityShare: number;
  corroboratedShare: number;
  disputedShare: number;
  stateCoverageShare: number;
  nationalHighSeverityShare: number;
  nationalCorroboratedShare: number;
  nationalDisputedShare: number;
  nationalStateCoverageShare: number;
}

export interface ZoneProfile {
  zone: ZoneId;
  name: string;
  shortName: string;
  color: string;
  description: string;
  totals: ZoneProfileTotals;
  categories: CategoryBreakdown[];
  severity: SeverityBreakdown[];
  verification: ZoneVerificationRow[];
  topStates: NamedCount[];
  states: ZoneStateRow[];
  trend: TrendPoint[];
  trendDays: number;
  recentEvents: IntelligenceEvent[];
  sources: SourceBreakdown[];
  comparison: ZoneProfileComparison;
  assessment: string;
  assessmentKind: "automated_demo_summary";
  limitations: string[];
}

export interface RegionalIntelligence {
  zones: ZoneComparison[];
  selected: ZoneProfile | null;
  selectedLabel: string | null;
  totals: NationalSummary["totals"];
  categories: NationalSummary["categories"];
  assessment: string;
  assessmentKind: "automated_demo_summary";
  volumeIsRisk: false;
  days: number;
  zonalTotal: number;
  nationalEvents: number;
  limitations: string[];
}

/** Limitations shown with regional views; wording follows the dataset so real records are never called fictional. */
export function regionalLimitations(mode: DatasetMode): string[] {
  const demo = mode === "demo";
  return [
    demo
      ? "Every event, source, headline and count is fictional demo content, not a real incident."
      : "Events are built from publisher reports; several may rest on a single source, and AI analysis is kept separate from reported facts.",
    "Reported-event volume is not incidence, risk, danger or a state safety ranking.",
    demo
      ? "A state or zone with no reported record is unobserved in this demo snapshot, not safe."
      : "A state or zone with no reported record is unobserved in the loaded records, not safe.",
    demo
      ? "The demo snapshot has no historical completeness; comparisons describe only the active filters."
      : "The loaded records do not claim historical completeness; comparisons describe only the active filters.",
    "Zone comparisons exclude national-scope records that are not assigned to a state.",
  ];
}

export const REGIONAL_LIMITATIONS = [
  "Every event, source, headline and count is fictional demo content, not a real incident.",
  "Reported-event volume is not incidence, risk, danger or a state safety ranking.",
  "A state or zone with no reported record is unobserved in this demo snapshot, not safe.",
  "The demo snapshot has no historical completeness; comparisons describe only the active filters.",
  "Zone comparisons exclude national-scope records that are not assigned to a state.",
] as const;

function share(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function corroboratedCount(events: readonly IntelligenceEvent[]): number {
  return events.filter(
    (event) =>
      event.verificationStatus === "corroborated" ||
      event.verificationStatus === "official_confirmation",
  ).length;
}

function independentSourceGroups(events: readonly IntelligenceEvent[]): number {
  return new Set(
    events.flatMap((event) => event.sources.map((source) => source.independenceGroup)),
  ).size;
}

function recentEvents(events: readonly IntelligenceEvent[], limit = 5): IntelligenceEvent[] {
  return [...events]
    .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
    .slice(0, limit);
}

/**
 * Like-for-like six-zone comparison. Ordering is descriptive reported volume,
 * never a risk or safety ranking.
 */
export function zoneComparisons(
  events: readonly IntelligenceEvent[],
  referenceIso: string,
  days = DEFAULT_REGIONAL_DAYS,
): ZoneComparison[] {
  return zoneSummaries(events, referenceIso).map((summary) => {
    const zoneEvents = events.filter((event) => event.zone === summary.zone);
    const trend = trendSeries(zoneEvents, referenceIso, days);
    return {
      ...summary,
      severity4Plus: zoneEvents.filter((event) => event.severity >= 4).length,
      corroborated: corroboratedCount(zoneEvents),
      singleSource: zoneEvents.filter((event) => event.verificationStatus === "single_source").length,
      sourceGroups: independentSourceGroups(zoneEvents),
      statesTotal: statesInZone(summary.zone).length,
      trend,
      trendTotal: trend.reduce((sum, point) => sum + point.total, 0),
      activeDays: trend.filter((point) => point.total > 0).length,
    };
  });
}

export function zoneProfile(
  events: readonly IntelligenceEvent[],
  zone: ZoneId,
  referenceIso: string,
  days = DEFAULT_REGIONAL_DAYS,
  mode: DatasetMode = "demo",
): ZoneProfile {
  const config = zoneConfig(zone);
  const zoneEvents = events.filter((event) => event.zone === zone);
  const sortedZoneEvents = [...zoneEvents].sort((a, b) =>
    b.lastUpdatedAt.localeCompare(a.lastUpdatedAt),
  );
  const zonedEvents = events.filter((event) => event.zone !== null);
  const zoneStates = statesInZone(zone);
  const reference = new Date(referenceIso).getTime();
  const total = zoneEvents.length;

  const stateRows: ZoneStateRow[] = zoneStates
    .map((state) => {
      const stateEvents = zoneEvents.filter((event) => event.stateId === state.id);
      const latest = [...stateEvents].sort((a, b) =>
        b.lastUpdatedAt.localeCompare(a.lastUpdatedAt),
      )[0];
      return {
        id: state.id,
        name: state.name,
        count: stateEvents.length,
        share: share(stateEvents.length, total),
        critical: stateEvents.filter((event) => event.severity === 5).length,
        latestReportedAt: latest?.lastUpdatedAt ?? null,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const verification: ZoneVerificationRow[] = verificationBreakdown(zoneEvents).map((row) => ({
    ...row,
    share: share(row.count, total),
  }));

  const severity4Plus = zoneEvents.filter((event) => event.severity >= 4).length;
  const corroborated = corroboratedCount(zoneEvents);
  const disputed = zoneEvents.filter((event) => event.verificationStatus === "disputed").length;
  const statesReporting = stateRows.filter((state) => state.count > 0).length;
  const trend = trendSeries(zoneEvents, referenceIso, days);
  const categories = categoryBreakdown(zoneEvents);
  const topCategory = categories.find((category) => category.count > 0) ?? null;
  const zonalAverageEvents = zonedEvents.length / 6;

  const nationalHighSeverityShare = share(
    zonedEvents.filter((event) => event.severity >= 4).length,
    zonedEvents.length,
  );
  const nationalCorroboratedShare = share(corroboratedCount(zonedEvents), zonedEvents.length);
  const nationalDisputedShare = share(
    zonedEvents.filter((event) => event.verificationStatus === "disputed").length,
    zonedEvents.length,
  );
  const nationalStatesReporting = new Set(
    zonedEvents.map((event) => event.stateId).filter((stateId): stateId is string => Boolean(stateId)),
  ).size;

  const assessment =
    total === 0
      ? `No ${mode === "demo" ? "fictional demo " : ""}events in ${config.name} match the active filters. Absence of records is not evidence of safety or of no activity. No zone conclusion should be drawn from an empty filter result.`
      : `${total} ${mode === "demo" ? "fictional demo " : ""}event${total === 1 ? " is" : "s are"} reported in ${config.name}, ${topCategory ? `${topCategory.label} is the largest reported category (${topCategory.count})` : "with no category count"}. ${statesReporting} of ${zoneStates.length} states have at least one record. ${severity4Plus} are rated severity 4–5, ${corroborated} are corroborated or officially confirmed, and ${disputed} are disputed. This is reported volume from ${mode === "demo" ? "a static fictional dataset" : "published reports"}, not incidence, danger or a state safety ranking.`;

  return {
    zone,
    name: config.name,
    shortName: config.shortName,
    color: config.color,
    description: config.description,
    totals: {
      reportedEvents: total,
      last24h: zoneEvents.filter((event) => eventTimestamp(event) >= reference - 86_400_000).length,
      critical: zoneEvents.filter((event) => event.severity === 5).length,
      severity4Plus,
      corroborated,
      disputed,
      singleSource: zoneEvents.filter((event) => event.verificationStatus === "single_source")
        .length,
      unassessed: zoneEvents.filter((event) => event.verificationStatus === "unassessed").length,
      independentSourceGroups: independentSourceGroups(zoneEvents),
      statesReporting,
      statesTotal: zoneStates.length,
      zonalShare: share(total, zonedEvents.length),
      nationalShare: share(total, events.length),
    },
    categories,
    severity: severityBreakdown(zoneEvents),
    verification,
    topStates: stateRows
      .filter((state) => state.count > 0)
      .slice(0, 3)
      .map((state) => ({
        id: state.id,
        name: state.name,
        count: state.count,
        share: state.share,
      })),
    states: stateRows,
    trend,
    trendDays: days,
    recentEvents: recentEvents(sortedZoneEvents),
    sources: sourceDistribution(zoneEvents),
    comparison: {
      zonalAverageEvents,
      equalShare: 1 / 6,
      highSeverityShare: share(severity4Plus, total),
      corroboratedShare: share(corroborated, total),
      disputedShare: share(disputed, total),
      stateCoverageShare: share(statesReporting, zoneStates.length),
      nationalHighSeverityShare,
      nationalCorroboratedShare,
      nationalDisputedShare,
      nationalStateCoverageShare: share(nationalStatesReporting, 37),
    },
    assessment,
    assessmentKind: "automated_demo_summary",
    limitations: regionalLimitations(mode),
  };
}

export function buildRegionalIntelligence(
  events: readonly IntelligenceEvent[],
  filters: Filters,
  referenceIso: string,
  selectedZone: ZoneId | null,
  days = DEFAULT_REGIONAL_DAYS,
  mode: DatasetMode = "demo",
): RegionalIntelligence {
  const zones = zoneComparisons(events, referenceIso, days);
  const summary = nationalSummary(events, filters, referenceIso, mode);
  const selected = selectedZone ? zoneProfile(events, selectedZone, referenceIso, days, mode) : null;

  return {
    zones,
    selected,
    selectedLabel: selectedZone ? zoneConfig(selectedZone).name : null,
    totals: summary.totals,
    categories: summary.categories,
    assessment: buildRegionalAssessment(events, filters, summary.zones, selected, mode),
    assessmentKind: "automated_demo_summary",
    volumeIsRisk: false,
    days,
    zonalTotal: zones.reduce((sum, zone) => sum + zone.reportedEvents, 0),
    nationalEvents: summary.totals.nationalEvents,
    limitations: regionalLimitations(mode),
  };
}

function buildRegionalAssessment(
  events: readonly IntelligenceEvent[],
  filters: Filters,
  zones: readonly ZoneSummary[],
  selected: ZoneProfile | null,
  mode: DatasetMode,
): string {
  const demo = mode === "demo";
  if (selected) return selected.assessment;
  if (events.length === 0) {
    return `No ${demo ? "fictional demo " : ""}events match the active regional comparison filters. Absence of records is not evidence of safety, and no zone conclusion should be drawn from an empty result.`;
  }
  const reporting = zones.filter((zone) => zone.reportedEvents > 0).length;
  const top = zones[0];
  const topCategory = top?.topCategory ? categoryConfig(top.topCategory).shortLabel : null;
  const scope = [filters.category !== "all" ? "category" : null, filters.q ? "search" : null]
    .filter(Boolean)
    .join(" and ");
  return `${events.length} ${demo ? "fictional demo " : ""}event${events.length === 1 ? " is" : "s are"} across ${reporting} of six zones under the active${scope ? ` ${scope}` : ""} filters. ${top ? `${top.name} has the highest reported volume (${top.reportedEvents})${topCategory ? `, led by ${topCategory}` : ""}.` : ""} This describes reported ${demo ? "demo " : ""}volume only; it is not incidence, danger, a risk score or a state safety ranking.`;
}
