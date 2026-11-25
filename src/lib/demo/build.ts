import lgaData from "@/data/lga-gazetteer.json";
import { STATES, stateById } from "@/lib/geo/states";
import type {
  Category,
  DashboardSnapshot,
  EventSourceRef,
  EventTimelineEntry,
  IntelligenceEvent,
  Severity,
  SourceRelationship,
  VerificationStatus,
  ZoneId,
} from "@/lib/types";
import { demoAgeHours, type DemoScenario } from "@/lib/demo/scenarios";
import { ALL_SCENARIOS } from "@/lib/demo/scenarios";
import { DEMO_SOURCE_BY_ID, DEMO_SOURCES } from "@/lib/demo/sources";

export const DEMO_REFERENCE_TIME = "2026-11-02T09:00:00.000Z";

interface GazetteerEntry {
  name: string;
  stateId: string;
  lat: number;
  lng: number;
  areaKm2: number;
}

const gazetteer = lgaData as GazetteerEntry[];
const lgaByStateAndName = new Map(
  gazetteer.map((lga) => [`${lga.stateId}|${lga.name.toLowerCase()}`, lga]),
);

const CATEGORY_SOURCE_ID: Record<Category, string> = {
  security: "demo-capital-desk",
  politics: "demo-governance-monitor",
  economy: "demo-market-wire",
  infrastructure: "demo-capital-desk",
  environment: "demo-emergency-bulletin",
  health: "demo-health-desk",
};

const REGIONAL_SOURCE: Record<ZoneId, string> = {
  "north-central": "demo-northern-report",
  "north-east": "demo-northern-report",
  "north-west": "demo-northern-report",
  "south-east": "demo-southern-report",
  "south-south": "demo-southern-report",
  "south-west": "demo-southern-report",
};

const SEVERITY_RATIONALE: Record<Severity, string> = {
  1: "Informational demo record with no reported direct impact.",
  2: "Low reported impact, limited to a local area or planning process.",
  3: "Moderate reported disruption that may affect local services or communities.",
  4: "High reported impact in this fictional scenario; requires close verification.",
  5: "Critical reported impact in this fictional scenario; urgent verification would be required.",
};

const CATEGORY_ANALYSIS: Record<Category, string> = {
  security:
    "Security reports are sensitive to unverified claims. This demo summary should be treated as an allegation-level record: location, actors and impact are not independently established.",
  politics:
    "Governance records move through proposal, hearing, decision and implementation stages. This demo record should not be read as a final policy outcome.",
  economy:
    "Business announcements often describe intentions rather than completed investment. This demo record does not represent a verified commercial commitment or a price observation.",
  infrastructure:
    "Project announcements usually precede procurement and construction. This demo record does not establish that work has started or that funding has been released.",
  environment:
    "Preparedness and response planning should be distinguished from a confirmed hazard event. This demo record is not an emergency declaration.",
  health:
    "Health-service and preparedness records should not be read as an outbreak declaration unless explicitly stated. This demo record is not a medical advisory.",
};

function verificationFor(
  scenario: DemoScenario,
  independentSourceCount: number,
): VerificationStatus {
  if (scenario.retracted) return "retracted";
  if (scenario.unassessed) return "unassessed";
  if (scenario.disputed) return "disputed";
  if (scenario.official) return "official_confirmation";
  if (scenario.corroborated) return "corroborated";
  return independentSourceCount >= 2 ? "multiple_sources" : "single_source";
}

function confidenceFor(status: VerificationStatus, sourceCount: number): number {
  const base: Record<VerificationStatus, number> = {
    unassessed: 0.25,
    single_source: 0.42,
    multiple_sources: 0.62,
    corroborated: 0.84,
    official_confirmation: 0.88,
    disputed: 0.5,
    retracted: 0.3,
  };
  return Math.min(0.95, Math.round((base[status] + Math.min(0.06, sourceCount * 0.02)) * 100) / 100);
}

function selectSourceIds(scenario: DemoScenario, zone: ZoneId | null): string[] {
  const categorySource = CATEGORY_SOURCE_ID[scenario.category];
  const regional = zone ? REGIONAL_SOURCE[zone] : null;
  const candidates = [
    regional,
    categorySource,
    scenario.official ? "demo-emergency-bulletin" : null,
    "demo-national-wire",
  ].filter((id): id is string => Boolean(id));

  const unique: string[] = [];
  for (const id of candidates) {
    if (!unique.includes(id) && DEMO_SOURCE_BY_ID.has(id)) unique.push(id);
  }
  for (const source of DEMO_SOURCES) {
    if (!unique.includes(source.id)) unique.push(source.id);
  }

  const requested = scenario.official
    ? Math.max(3, scenario.sourceCount ?? 3)
    : (scenario.sourceCount ?? 2);
  const count = Math.min(4, Math.max(1, requested));
  return unique.slice(0, count);
}

function headlineFor(
  scenario: DemoScenario,
  sourceId: string,
  index: number,
  relationship: SourceRelationship,
): string {
  if (index === 0) return scenario.title;
  if (sourceId === "demo-emergency-bulletin") return `Demo official bulletin: ${scenario.title}`;
  if (relationship === "conflicting") return `Conflicting demo account: ${scenario.title}`;
  const prefixes = ["Update:", "Briefing:", "What we know:", "Second demo report:"];
  return `${prefixes[index % prefixes.length] ?? "Update:"} ${scenario.title}`;
}

function iso(date: Date): string {
  return date.toISOString();
}

function buildEvent(scenario: DemoScenario, index: number): IntelligenceEvent {
  const state = stateById(scenario.stateId);
  if (scenario.stateId && !state) {
    throw new Error(`Demo scenario ${index} references unknown state ${scenario.stateId}`);
  }
  if (!scenario.stateId && scenario.lga) {
    throw new Error(`Demo scenario ${index} has an LGA without a state`);
  }
  const zone = state?.zone ?? null;

  let coordinates: { lat: number; lng: number } | null = null;
  let geoPrecision: IntelligenceEvent["geoPrecision"] = "national";
  let geoConfidence = 0.95;

  if (state) {
    if (scenario.lga) {
      const lga = lgaByStateAndName.get(`${state.id}|${scenario.lga.toLowerCase()}`);
      if (!lga) {
        throw new Error(
          `Demo scenario ${index} references unknown LGA "${scenario.lga}" in ${state.name}`,
        );
      }
      coordinates = { lat: lga.lat, lng: lga.lng };
      geoPrecision = "lga";
      geoConfidence = 0.62;
    } else {
      coordinates = { lat: state.labelPoint.lat, lng: state.labelPoint.lng };
      geoPrecision = "state";
      geoConfidence = 0.42;
    }
  }

  const referenceMs = new Date(DEMO_REFERENCE_TIME).getTime();
  const ageHours = scenario.hoursAgo ?? demoAgeHours(index);
  const occurrenceMs = referenceMs - ageHours * 3_600_000;
  const occurrenceAt = new Date(occurrenceMs);
  const sourceIds = selectSourceIds(scenario, zone);
  const reportDelayHours = 1 + ((index * 3) % 6);
  const firstReportMs = Math.min(occurrenceMs + reportDelayHours * 3_600_000, referenceMs - 25 * 60_000);
  const availableSpan = Math.max(15 * 60_000, referenceMs - firstReportMs - 5 * 60_000);
  const step = availableSpan / Math.max(1, sourceIds.length);

  const relationships: SourceRelationship[] = sourceIds.map((_, i) =>
    i === 0 ? "primary" : "supporting",
  );
  if (scenario.retracted) relationships[0] = "retracted";
  if (scenario.disputed && relationships.length > 1) relationships[1] = "conflicting";

  const sources: EventSourceRef[] = sourceIds.map((sourceId, i) => {
    const source = DEMO_SOURCE_BY_ID.get(sourceId);
    if (!source) throw new Error(`Unknown demo source ${sourceId}`);
    const publishedMs = Math.min(firstReportMs + i * step, referenceMs - 5 * 60_000);
    return {
      id: `evt-demo-${String(index + 1).padStart(3, "0")}-src-${i + 1}`,
      sourceId,
      sourceName: source.name,
      sourceTier: source.tier,
      sourceType: source.sourceType,
      headline: headlineFor(scenario, sourceId, i, relationships[i] ?? "supporting"),
      url: null,
      publishedAt: iso(new Date(publishedMs)),
      retrievedAt: iso(new Date(Math.min(publishedMs + 10 * 60_000, referenceMs))),
      relationship: relationships[i] ?? "supporting",
      independenceGroup: source.independenceGroup,
      isDemo: true,
    };
  });

  const independentGroups = new Set(
    sources
      .filter((source) => source.relationship !== "retracted")
      .map((source) => source.independenceGroup),
  );
  const independentSourceCount = independentGroups.size;
  const verificationStatus = verificationFor(scenario, independentSourceCount);
  const sourceTimes = sources.map((source) => new Date(source.publishedAt).getTime());
  const firstReportedMs = Math.min(...sourceTimes);
  const lastSourceMs = Math.max(...sourceTimes);

  const timeline: EventTimelineEntry[] = sources.map((source, i) => ({
    id: `evt-demo-${String(index + 1).padStart(3, "0")}-upd-${i + 1}`,
    type: "new_report",
    description:
      i === 0
        ? `First demo report logged from ${source.sourceName}.`
        : `Additional demo source recorded: ${source.sourceName}.`,
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    actor: "pipeline",
    createdAt: source.publishedAt,
  }));

  const verificationMs = Math.min(lastSourceMs + 2 * 60_000, referenceMs - 3 * 60_000);
  timeline.push({
    id: `evt-demo-${String(index + 1).padStart(3, "0")}-upd-verification`,
    type: "verification_change",
    description: `Demo verification state set to ${verificationStatus.replaceAll("_", " ")}.`,
    sourceId: null,
    sourceName: null,
    actor: "system",
    createdAt: iso(new Date(verificationMs)),
  });

  if (scenario.official) {
    timeline.push({
      id: `evt-demo-${String(index + 1).padStart(3, "0")}-upd-official`,
      type: "official_statement",
      description: "A fictional official-style bulletin is represented in this demo event.",
      sourceId: "demo-emergency-bulletin",
      sourceName: "Demo Emergency Bulletin",
      actor: "pipeline",
      createdAt: iso(new Date(Math.min(verificationMs + 3 * 60_000, referenceMs - 2 * 60_000))),
    });
  }

  if (scenario.disputed) {
    timeline.push({
      id: `evt-demo-${String(index + 1).padStart(3, "0")}-upd-disputed`,
      type: "context",
      description: "Demo reports conflict on material details; the event remains disputed.",
      sourceId: null,
      sourceName: null,
      actor: "reviewer",
      createdAt: iso(new Date(Math.min(verificationMs + 4 * 60_000, referenceMs - 2 * 60_000))),
    });
  }

  if (scenario.retracted) {
    const retractionMs = Math.min(lastSourceMs + 12 * 3_600_000, referenceMs - 60_000);
    timeline.push({
      id: `evt-demo-${String(index + 1).padStart(3, "0")}-upd-retraction`,
      type: "retraction",
      description: "The originating demo source retracted its report. The record is retained for the audit trail.",
      sourceId: sources[0]?.sourceId ?? null,
      sourceName: sources[0]?.sourceName ?? null,
      actor: "reviewer",
      createdAt: iso(new Date(retractionMs)),
    });
  }

  const lastUpdatedMs = Math.max(lastSourceMs, ...timeline.map((entry) => new Date(entry.createdAt).getTime()));
  const uncertainties = [
    "Fictional demo record: no real-world incident or verification exists.",
    ...(geoPrecision === "lga"
      ? ["Location is approximate: the marker is the LGA representative point, not a confirmed incident location."]
      : []),
    ...(geoPrecision === "state"
      ? ["Only state-level location is available; no LGA was confidently identified."]
      : []),
    ...(scenario.disputed ? ["The demo sources conflict on material details."] : []),
    ...(verificationStatus === "single_source"
      ? ["Only one independent demo source group is represented."]
      : []),
    ...(verificationStatus === "retracted" ? ["The originating demo source has retracted the report."] : []),
    ...(verificationStatus === "unassessed" ? ["No verification review has been completed."] : []),
  ];

  const severityRationale = SEVERITY_RATIONALE[scenario.severity];
  const analysis = `${CATEGORY_ANALYSIS[scenario.category]} This event is a fictional demo record with ${independentSourceCount} independent demo source group${independentSourceCount === 1 ? "" : "s"} and ${geoPrecision.toUpperCase()} geographic precision. Reported event volume is not a measure of incidence, risk or safety.`;

  return {
    id: `evt-demo-${String(index + 1).padStart(3, "0")}`,
    slug: `demo-${scenario.category}-${state?.id.toLowerCase() ?? "national"}-${String(index + 1).padStart(3, "0")}`,
    title: scenario.title,
    summary: scenario.summary,
    category: scenario.category,
    subcategory: scenario.subcategory,
    severity: scenario.severity,
    severityRationale,
    stateId: state?.id ?? null,
    stateName: state?.name ?? null,
    zone,
    lga: scenario.lga,
    coordinates,
    geoPrecision,
    geoConfidence: Math.round(geoConfidence * 100) / 100,
    occurrenceAt: iso(occurrenceAt),
    firstReportedAt: iso(new Date(firstReportedMs)),
    lastUpdatedAt: iso(new Date(lastUpdatedMs)),
    verificationStatus,
    confidence: confidenceFor(verificationStatus, sources.length),
    independentSourceCount,
    articleCount: sources.length,
    sources,
    timeline: timeline.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    uncertainties,
    analysis,
    analysisKind: "automated_demo_summary",
    isDemo: true,
    relatedEventIds: [],
  };
}

function attachRelatedEvents(events: IntelligenceEvent[]): IntelligenceEvent[] {
  return events.map((event) => {
    const related = events
      .filter(
        (candidate) =>
          candidate.id !== event.id &&
          candidate.category === event.category &&
          candidate.stateId === event.stateId,
      )
      .sort((a, b) => Math.abs(new Date(a.occurrenceAt ?? a.firstReportedAt).getTime() - new Date(event.occurrenceAt ?? event.firstReportedAt).getTime()) - Math.abs(new Date(b.occurrenceAt ?? b.firstReportedAt).getTime() - new Date(event.occurrenceAt ?? event.firstReportedAt).getTime()))
      .slice(0, 2)
      .map((candidate) => candidate.id);
    return { ...event, relatedEventIds: related };
  });
}

let cachedSnapshot: DashboardSnapshot | null = null;

export function buildDemoSnapshot(): DashboardSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  if (ALL_SCENARIOS.length < 60) {
    throw new Error("Demo dataset unexpectedly small");
  }
  const events = attachRelatedEvents(
    ALL_SCENARIOS.map((scenario, index) => buildEvent(scenario, index)).sort((a, b) =>
      b.lastUpdatedAt.localeCompare(a.lastUpdatedAt),
    ),
  );

  const occurrenceTimes = events
    .map((event) => event.occurrenceAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const coverageFrom = occurrenceTimes[0] ?? null;
  const coverageTo = events.map((e) => e.lastUpdatedAt).sort().at(-1) ?? null;

  cachedSnapshot = {
    mode: "demo",
    datasetVersion: "demo-2026-11-02.1",
    generatedAt: DEMO_REFERENCE_TIME,
    referenceTime: DEMO_REFERENCE_TIME,
    states: [...STATES],
    events,
    sources: [...DEMO_SOURCES],
    coverage: {
      from: coverageFrom,
      to: coverageTo,
      basis: "demo_snapshot",
      label: "Fictional demo snapshot — not live coverage",
    },
    disclaimer: "DEMO DATA — NOT A REAL INCIDENT",
    limitations: [
      "Every event and source in this dataset is fictional.",
      "The snapshot is static; captured articles do not publish events and no live dashboard feed, AI enrichment or realtime channel is connected.",
      "LGA and state markers are representative points, not confirmed incident coordinates.",
      "Reported event volume is not incidence, risk, danger or a state safety ranking.",
      "Historical coverage does not extend beyond this demo snapshot.",
    ],
  };
  return cachedSnapshot;
}
