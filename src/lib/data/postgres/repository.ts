import type { DataMode, DataRepository, DataRuntime } from "@/lib/data/types";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { displaySummary } from "@/lib/publication/excerpt";
import type {
  DashboardSnapshot,
  EventSourceRef,
  EventTimelineEntry,
  GeoPrecision,
  IntelligenceEvent,
  LatLng,
  SourceRegistryEntry,
  StateGeo,
  VerificationStatus,
  ZoneId,
} from "@/lib/types";

interface SnapshotRow {
  mode: DataMode;
  version: string;
  reference_time: unknown;
  generated_at: unknown;
  coverage_from: unknown;
  coverage_to: unknown;
  coverage_basis: "demo_snapshot" | "live_ingestion";
  coverage_label: string;
  disclaimer: string | null;
  limitations: unknown;
}

interface MixGuardRow {
  demo_events: number;
  demo_sources: number;
  demo_articles: number;
  production_events: number;
  production_sources: number;
  production_articles: number;
}

interface StateRow {
  id: string;
  name: string;
  iso_code: string;
  zone: ZoneId;
  capital: string;
  capital_lga: string;
  area_km2: number;
  label_lng: number;
  label_lat: number;
  capital_lng: number;
  capital_lat: number;
  bbox_min_lng: number;
  bbox_min_lat: number;
  bbox_max_lng: number;
  bbox_max_lat: number;
}

interface SourceRow {
  slug: string;
  name: string;
  source_type: SourceRegistryEntry["sourceType"];
  tier: SourceRegistryEntry["tier"];
  independence_group: string;
  base_url: string | null;
  access_method: SourceRegistryEntry["accessMethod"];
  active: boolean;
  last_successful_sync: unknown;
  is_demo: boolean;
  reliability_note: string;
}

interface EventRow {
  id: string;
  public_id: string;
  slug: string;
  title: string;
  summary: string;
  category: IntelligenceEvent["category"];
  subcategory: string;
  severity: IntelligenceEvent["severity"];
  severity_rationale: string;
  state_id: string | null;
  lga: string | null;
  lng: number | null;
  lat: number | null;
  geo_precision: GeoPrecision;
  geo_confidence: number;
  occurrence_at: unknown;
  first_reported_at: unknown;
  last_updated_at: unknown;
  verification_status: VerificationStatus;
  confidence: number;
  uncertainties: unknown;
  analysis: string;
  analysis_kind: IntelligenceEvent["analysisKind"];
  is_demo: boolean;
}

interface EvidenceRow {
  event_id: string;
  public_id: string;
  source_slug: string;
  source_name: string;
  source_tier: EventSourceRef["sourceTier"];
  source_type: EventSourceRef["sourceType"];
  headline: string;
  url: string | null;
  published_at: unknown;
  retrieved_at: unknown;
  relationship: EventSourceRef["relationship"];
  independence_group: string;
  is_demo: boolean;
}

interface UpdateRow {
  event_id: string;
  public_id: string;
  update_type: EventTimelineEntry["type"];
  description: string;
  actor: EventTimelineEntry["actor"];
  created_at: unknown;
  source_slug: string | null;
  source_name: string | null;
}

interface RelationRow {
  event_id: string;
  related_public_id: string;
}

function requiredIso(value: unknown, label: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new Error(`Expected a timestamp for ${label}.`);
}

function nullableIso(value: unknown, label: string): string | null {
  return value == null ? null : requiredIso(value, label);
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Expected a numeric value for ${label}.`);
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`Expected a boolean value for ${label}.`);
}

function stringArray(value: unknown, label: string): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`Expected a JSON array for ${label}.`);
    }
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected an array of strings for ${label}.`);
  }
  return parsed;
}

function groupByEvent<T extends { event_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const existing = map.get(row.event_id);
    if (existing) existing.push(row);
    else map.set(row.event_id, [row]);
  }
  return map;
}

/**
 * Database-backed repository. The same SQL and mapping run against PGlite with
 * PostGIS in integration tests and against PostgreSQL/Supabase in deployment.
 */
export class PostgresRepository implements DataRepository {
  readonly kind = "postgres" as const;

  constructor(
    private readonly driver: DatabaseDriver,
    readonly mode: DataMode,
  ) {}

  runtime(): DataRuntime {
    return { mode: this.mode, repository: this.kind, database: "connected" };
  }

  async getSnapshot(): Promise<DashboardSnapshot> {
    const snapshotResult = await this.driver.query<SnapshotRow>(
      `select mode, version, reference_time, generated_at,
              coverage_from, coverage_to, coverage_basis, coverage_label,
              disclaimer, limitations
       from dataset_snapshots
       where mode = $1 and is_active
       limit 1`,
      [this.mode],
    );
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) {
      throw new Error(
        `No active ${this.mode} dataset snapshot. Run the registry and demo seed commands, or publish a production snapshot.`,
      );
    }
    if (snapshot.mode !== this.mode) {
      throw new Error("Active dataset snapshot mode does not match the repository mode.");
    }
    if (this.mode === "demo" && snapshot.coverage_basis !== "demo_snapshot") {
      throw new Error("Demo repository requires a demo_snapshot coverage basis.");
    }
    if (this.mode === "production" && snapshot.coverage_basis === "demo_snapshot") {
      throw new Error("Production repository cannot serve a demo snapshot.");
    }

    await this.assertNoMixedData();

    const stateResult = await this.driver.query<StateRow>(
      `select id, name, iso_code, zone, capital, capital_lga,
              area_km2::float8 as area_km2,
              extensions.ST_X(label_point)::float8 as label_lng,
              extensions.ST_Y(label_point)::float8 as label_lat,
              extensions.ST_X(capital_point)::float8 as capital_lng,
              extensions.ST_Y(capital_point)::float8 as capital_lat,
              bbox_min_lng::float8 as bbox_min_lng,
              bbox_min_lat::float8 as bbox_min_lat,
              bbox_max_lng::float8 as bbox_max_lng,
              bbox_max_lat::float8 as bbox_max_lat
       from states
       order by name`,
    );
    if (stateResult.rows.length !== 37) {
      throw new Error(
        `State registry is incomplete: expected 37 rows, received ${stateResult.rows.length}.`,
      );
    }
    const states = stateResult.rows.map(mapState);
    const stateById = new Map(states.map((state) => [state.id, state]));

    const demo = this.mode === "demo";
    const sourceResult = await this.driver.query<SourceRow>(
      `select slug, name, source_type, tier, independence_group, base_url,
              access_method, active, last_successful_sync, is_demo, reliability_note
       from sources
       where is_demo = $1
       order by sort_order, name`,
      [demo],
    );
    const sources = sourceResult.rows.map(mapSource);

    const eventResult = await this.driver.query<EventRow>(
      `select id::text as id, public_id, slug, title, summary, category,
              subcategory, severity, severity_rationale, state_id, lga,
              extensions.ST_X(location::extensions.geometry)::float8 as lng,
              extensions.ST_Y(location::extensions.geometry)::float8 as lat,
              geo_precision, geo_confidence::float8 as geo_confidence,
              occurrence_at, first_reported_at, last_updated_at,
              verification_status, confidence::float8 as confidence,
              uncertainties, analysis, analysis_kind, is_demo
       from events
       where published = true and is_demo = $1
       order by last_updated_at desc, public_id`,
      [demo],
    );
    if (demo && eventResult.rows.length === 0) {
      throw new Error("Demo repository has no published demo events. Run db:seed-demo.");
    }
    const eventIds = eventResult.rows.map((row) => row.id);

    const [evidenceResult, updateResult, relationResult] = await Promise.all([
      this.driver.query<EvidenceRow>(
        `select es.event_id::text as event_id, es.public_id,
                src.slug as source_slug, src.name as source_name,
                src.tier as source_tier, src.source_type,
                a.original_title as headline, a.original_url as url,
                a.published_at, a.retrieved_at,
                es.relationship, es.independence_group, a.is_demo
         from event_sources es
         join articles a on a.id = es.article_id
         join sources src on src.id = a.source_id
         where es.event_id = any($1::uuid[])
           and a.is_demo = $2 and src.is_demo = $2
         order by es.event_id, a.published_at, es.public_id`,
        [eventIds, demo],
      ),
      this.driver.query<UpdateRow>(
        `select eu.event_id::text as event_id, eu.public_id, eu.update_type,
                eu.description, eu.actor, eu.created_at,
                src.slug as source_slug, src.name as source_name
         from event_updates eu
         left join sources src on src.id = eu.source_id
         where eu.event_id = any($1::uuid[])
         order by eu.event_id, eu.created_at, eu.public_id`,
        [eventIds],
      ),
      this.driver.query<RelationRow>(
        `select er.event_id::text as event_id, related.public_id as related_public_id
         from event_relations er
         join events related on related.id = er.related_event_id
         where er.event_id = any($1::uuid[])
           and related.published = true and related.is_demo = $2
         order by er.event_id, er.sort_order, related.public_id`,
        [eventIds, demo],
      ),
    ]);

    const evidenceByEvent = groupByEvent(evidenceResult.rows);
    const updatesByEvent = groupByEvent(updateResult.rows);
    const relationsByEvent = groupByEvent(relationResult.rows);

    const events = eventResult.rows.map((row) => {
      const state = row.state_id ? stateById.get(row.state_id) : null;
      if (row.state_id && !state) {
        throw new Error(`Event ${row.public_id} references missing state ${row.state_id}.`);
      }
      const rowEvidence = evidenceByEvent.get(row.id) ?? [];
      const eventSources = rowEvidence.map(mapEvidence);
      const independentGroups = new Set(
        eventSources
          .filter((source) => source.relationship !== "retracted")
          .map((source) => source.independenceGroup),
      );
      const timeline = (updatesByEvent.get(row.id) ?? []).map(mapUpdate);
      const relatedEventIds = (relationsByEvent.get(row.id) ?? []).map(
        (relation) => relation.related_public_id,
      );
      const coordinates: LatLng | null =
        row.lat != null && row.lng != null
          ? { lat: requiredNumber(row.lat, "event latitude"), lng: requiredNumber(row.lng, "event longitude") }
          : null;

      return {
        id: row.public_id,
        slug: row.slug,
        title: row.title,
        summary: row.is_demo ? row.summary : displaySummary(row.summary, row.title),
        category: row.category,
        subcategory: row.subcategory,
        severity: row.severity,
        severityRationale: row.severity_rationale,
        stateId: row.state_id,
        stateName: state?.name ?? null,
        zone: state?.zone ?? null,
        lga: row.lga,
        coordinates,
        geoPrecision: row.geo_precision,
        geoConfidence: requiredNumber(row.geo_confidence, "geo confidence"),
        occurrenceAt: nullableIso(row.occurrence_at, "occurrence time"),
        firstReportedAt: requiredIso(row.first_reported_at, "first reported time"),
        lastUpdatedAt: requiredIso(row.last_updated_at, "last updated time"),
        verificationStatus: row.verification_status,
        confidence: requiredNumber(row.confidence, "event confidence"),
        independentSourceCount: independentGroups.size,
        articleCount: eventSources.length,
        sources: eventSources,
        timeline,
        uncertainties: stringArray(row.uncertainties, "event uncertainties"),
        analysis: row.analysis,
        analysisKind: row.analysis_kind,
        isDemo: requiredBoolean(row.is_demo, "event demo flag"),
        relatedEventIds,
      } satisfies IntelligenceEvent;
    });

    return {
      mode: snapshot.mode,
      datasetVersion: snapshot.version,
      generatedAt: requiredIso(snapshot.generated_at, "dataset generated time"),
      referenceTime: requiredIso(snapshot.reference_time, "dataset reference time"),
      states,
      events,
      sources,
      coverage: {
        from: nullableIso(snapshot.coverage_from, "coverage start"),
        to: nullableIso(snapshot.coverage_to, "coverage end"),
        basis: snapshot.coverage_basis,
        label: snapshot.coverage_label,
      },
      disclaimer: snapshot.disclaimer,
      limitations: stringArray(snapshot.limitations, "dataset limitations"),
    };
  }

  async getEventById(id: string): Promise<IntelligenceEvent | null> {
    const snapshot = await this.getSnapshot();
    return snapshot.events.find((event) => event.id === id) ?? null;
  }

  private async assertNoMixedData(): Promise<void> {
    const result = await this.driver.query<MixGuardRow>(
      `select
         (select count(*)::integer from events where is_demo) as demo_events,
         (select count(*)::integer from sources where is_demo) as demo_sources,
         (select count(*)::integer from articles where is_demo) as demo_articles,
         (select count(*)::integer from events where not is_demo) as production_events,
         (select count(*)::integer from sources where not is_demo) as production_sources,
         (select count(*)::integer from articles where not is_demo) as production_articles`,
    );
    const counts = result.rows[0];
    if (!counts) throw new Error("Unable to verify repository data separation.");
    if (this.mode === "demo") {
      if (counts.production_events > 0 || counts.production_sources > 0 || counts.production_articles > 0) {
        throw new Error("Demo repository refuses a database containing production records.");
      }
    } else if (counts.demo_events > 0 || counts.demo_sources > 0 || counts.demo_articles > 0) {
      throw new Error("Production repository refuses a database containing demo records.");
    }
  }
}

function mapState(row: StateRow): StateGeo {
  return {
    id: row.id,
    name: row.name,
    iso: row.iso_code,
    zone: row.zone,
    zoneName: zoneName(row.zone),
    capital: row.capital,
    capitalLga: row.capital_lga,
    areaKm2: requiredNumber(row.area_km2, "state area"),
    labelPoint: {
      lng: requiredNumber(row.label_lng, "state label longitude"),
      lat: requiredNumber(row.label_lat, "state label latitude"),
    },
    capitalPoint: {
      lng: requiredNumber(row.capital_lng, "state capital longitude"),
      lat: requiredNumber(row.capital_lat, "state capital latitude"),
    },
    bbox: {
      minLng: requiredNumber(row.bbox_min_lng, "state bbox min longitude"),
      minLat: requiredNumber(row.bbox_min_lat, "state bbox min latitude"),
      maxLng: requiredNumber(row.bbox_max_lng, "state bbox max longitude"),
      maxLat: requiredNumber(row.bbox_max_lat, "state bbox max latitude"),
    },
  };
}

function mapSource(row: SourceRow): SourceRegistryEntry {
  return {
    id: row.slug,
    name: row.name,
    sourceType: row.source_type,
    tier: row.tier,
    independenceGroup: row.independence_group,
    baseUrl: row.base_url,
    accessMethod: row.access_method,
    active: requiredBoolean(row.active, "source active flag"),
    lastSuccessfulSync: nullableIso(row.last_successful_sync, "source last sync"),
    isDemo: requiredBoolean(row.is_demo, "source demo flag"),
    reliabilityNote: row.reliability_note,
  };
}

function mapEvidence(row: EvidenceRow): EventSourceRef {
  return {
    id: row.public_id,
    sourceId: row.source_slug,
    sourceName: row.source_name,
    sourceTier: row.source_tier,
    sourceType: row.source_type,
    headline: row.headline,
    url: row.url,
    publishedAt: requiredIso(row.published_at, "source published time"),
    retrievedAt: requiredIso(row.retrieved_at, "source retrieved time"),
    relationship: row.relationship,
    independenceGroup: row.independence_group,
    isDemo: requiredBoolean(row.is_demo, "evidence demo flag"),
  };
}

function mapUpdate(row: UpdateRow): EventTimelineEntry {
  return {
    id: row.public_id,
    type: row.update_type,
    description: row.description,
    sourceId: row.source_slug,
    sourceName: row.source_name,
    actor: row.actor,
    createdAt: requiredIso(row.created_at, "event update time"),
  };
}

const ZONE_NAMES: Record<ZoneId, string> = {
  "north-central": "North Central",
  "north-east": "North East",
  "north-west": "North West",
  "south-east": "South East",
  "south-south": "South South",
  "south-west": "South West",
};

function zoneName(zone: ZoneId): string {
  const name = ZONE_NAMES[zone];
  if (!name) throw new Error(`Unknown zone: ${zone}`);
  return name;
}
