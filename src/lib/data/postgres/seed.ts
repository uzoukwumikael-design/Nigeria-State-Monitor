import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATES } from "@/lib/geo/states";
import type { QueryExecutor } from "@/lib/data/postgres/driver";
import type { DashboardSnapshot, IntelligenceEvent } from "@/lib/types";
import type { FeatureCollection, Polygon } from "geojson";

interface StateFeatureProperties {
  id: string;
}

export interface RegistrySeedResult {
  states: number;
}

export interface DemoSeedResult {
  states: number;
  sources: number;
  events: number;
  evidenceLinks: number;
  timelineEntries: number;
  relations: number;
}

function stableUuid(key: string): string {
  const hex = createHash("sha1").update(`nsm-v1:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  hex[16] = variant;
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function contentHash(key: string): string {
  return createHash("sha256").update(`nsm-demo-article:${key}`).digest("hex");
}

function readStateFeatures(): Map<string, Polygon> {
  const file = path.join(process.cwd(), "public", "data", "nigeria-states.geojson");
  const collection = JSON.parse(fs.readFileSync(file, "utf8")) as FeatureCollection<
    Polygon,
    StateFeatureProperties
  >;
  if (collection.features.length !== 37) {
    throw new Error(`Expected 37 state features, received ${collection.features.length}`);
  }
  return new Map(collection.features.map((feature) => [feature.properties.id, feature.geometry]));
}

export async function seedRegistry(client: QueryExecutor): Promise<RegistrySeedResult> {
  if (STATES.length !== 37) {
    throw new Error(`State registry must contain 37 entries, received ${STATES.length}`);
  }
  const features = readStateFeatures();

  for (const state of STATES) {
    const geometry = features.get(state.id);
    if (!geometry) throw new Error(`No boundary feature for ${state.id}`);
    await client.query(
      `insert into states (
         id, name, iso_code, zone, capital, capital_lga,
         boundary, label_point, capital_point, area_km2,
         bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
       ) values (
         $1, $2, $3, $4, $5, $6,
         extensions.ST_Multi(extensions.ST_GeomFromGeoJSON($7))::extensions.geometry(MultiPolygon, 4326),
         extensions.ST_SetSRID(extensions.ST_MakePoint($8, $9), 4326),
         extensions.ST_SetSRID(extensions.ST_MakePoint($10, $11), 4326),
         $12, $13, $14, $15, $16
       )
       on conflict (id) do update set
         name = excluded.name,
         iso_code = excluded.iso_code,
         zone = excluded.zone,
         capital = excluded.capital,
         capital_lga = excluded.capital_lga,
         boundary = excluded.boundary,
         label_point = excluded.label_point,
         capital_point = excluded.capital_point,
         area_km2 = excluded.area_km2,
         bbox_min_lng = excluded.bbox_min_lng,
         bbox_min_lat = excluded.bbox_min_lat,
         bbox_max_lng = excluded.bbox_max_lng,
         bbox_max_lat = excluded.bbox_max_lat,
         updated_at = now()`,
      [
        state.id,
        state.name,
        state.iso,
        state.zone,
        state.capital,
        state.capitalLga,
        JSON.stringify(geometry),
        state.labelPoint.lng,
        state.labelPoint.lat,
        state.capitalPoint.lng,
        state.capitalPoint.lat,
        state.areaKm2,
        state.bbox.minLng,
        state.bbox.minLat,
        state.bbox.maxLng,
        state.bbox.maxLat,
      ],
    );
  }

  return { states: STATES.length };
}

function sourceRowId(sourceSlug: string): string {
  return stableUuid(`source:${sourceSlug}`);
}

function eventRowId(publicId: string): string {
  return stableUuid(`event:${publicId}`);
}

function articleRowId(publicId: string): string {
  return stableUuid(`article:${publicId}`);
}

export async function seedDemoData(
  client: QueryExecutor,
  snapshot: DashboardSnapshot,
): Promise<DemoSeedResult> {
  if (snapshot.mode !== "demo") {
    throw new Error("Refusing to seed demo data from a non-demo snapshot.");
  }
  if (!snapshot.events.every((event) => event.isDemo) || !snapshot.sources.every((source) => source.isDemo)) {
    throw new Error("Refusing to seed a mixed snapshot.");
  }

  const guard = await client.query<{
    production_events: number;
    production_sources: number;
    production_articles: number;
    production_snapshots: number;
  }>(
    `select
       (select count(*)::integer from events where not is_demo) as production_events,
       (select count(*)::integer from sources where not is_demo) as production_sources,
       (select count(*)::integer from articles where not is_demo) as production_articles,
       (select count(*)::integer from dataset_snapshots
          where mode = 'production' and is_active) as production_snapshots`,
  );
  const counts = guard.rows[0];
  if (
    !counts ||
    counts.production_events > 0 ||
    counts.production_sources > 0 ||
    counts.production_articles > 0 ||
    counts.production_snapshots > 0
  ) {
    throw new Error(
      "Refusing to seed demo data into a database containing production records or an active production snapshot.",
    );
  }

  await client.query(
    `delete from event_clusters
     where event_id in (select id from events where is_demo)
        or article_id in (select id from articles where is_demo)`,
  );
  await client.query("delete from events where is_demo");
  await client.query("delete from articles where is_demo");
  await client.query("delete from raw_items where is_demo");
  await client.query("delete from sources where is_demo");
  await client.query("delete from dataset_snapshots where mode = 'demo'");

  const sourceIds = new Map<string, string>();
  for (const [index, source] of snapshot.sources.entries()) {
    const id = sourceRowId(source.id);
    sourceIds.set(source.id, id);
    await client.query(
      `insert into sources (
         id, slug, name, source_type, tier, base_url, feed_url, access_method,
         independence_group, licence_status, attribution, reliability_note,
         active, is_demo, sort_order, last_successful_sync
       ) values (
         $1, $2, $3, $4, $5, $6, null, $7,
         $8, 'unreviewed', null, $9,
         $10, true, $11, $12
       )`,
      [
        id,
        source.id,
        source.name,
        source.sourceType,
        source.tier,
        source.baseUrl,
        source.accessMethod,
        source.independenceGroup,
        source.reliabilityNote,
        source.active,
        index,
        source.lastSuccessfulSync,
      ],
    );
  }

  const eventIds = new Map<string, string>();
  for (const event of snapshot.events) {
    eventIds.set(event.id, eventRowId(event.id));
  }

  for (const event of snapshot.events) {
    await client.query(
      `insert into events (
         id, public_id, slug, title, summary, category, subcategory, severity,
         severity_rationale, state_id, lga, location, geo_precision, geo_confidence,
         occurrence_at, first_reported_at, last_updated_at, verification_status,
         confidence, uncertainties, analysis, analysis_kind, is_demo, published
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, extensions.ST_GeogFromText($12), $13, $14,
         $15, $16, $17, $18,
         $19, $20::jsonb, $21, $22, true, true
       )`,
      eventParams(event),
    );
  }

  const articleIds = new Map<string, string>();
  for (const event of snapshot.events) {
    for (const source of event.sources) {
      const id = articleRowId(source.id);
      articleIds.set(source.id, id);
      await client.query(
        `insert into articles (
           id, public_id, source_id, external_id, original_title, original_url,
           canonical_url, excerpt, body_hash, content_hash, published_at,
           retrieved_at, language, state_id, lga, raw_item_id, is_demo
         ) values (
           $1, $2, $3, null, $4, $5,
           $6, null, null, $7, $8,
           $9, 'en', $10, $11, null, true
         )`,
        [
          id,
          source.id,
          sourceIds.get(source.sourceId),
          source.headline,
          source.url,
          null,
          contentHash(source.id),
          source.publishedAt,
          source.retrievedAt,
          event.stateId,
          event.lga,
        ],
      );
    }
  }

  let evidenceLinks = 0;
  for (const event of snapshot.events) {
    for (const source of event.sources) {
      const articleId = articleIds.get(source.id);
      const sourceRow = sourceIds.get(source.sourceId);
      if (!articleId || !sourceRow) {
        throw new Error(`Demo evidence reference ${source.id} is incomplete.`);
      }
      await client.query(
        `insert into event_sources (
           id, public_id, event_id, article_id, relationship,
           independence_group, added_at
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          stableUuid(`event-source:${source.id}`),
          source.id,
          eventIds.get(event.id),
          articleId,
          source.relationship,
          source.independenceGroup,
          source.publishedAt,
        ],
      );
      evidenceLinks += 1;
    }
  }

  let timelineEntries = 0;
  for (const event of snapshot.events) {
    for (const entry of event.timeline) {
      await client.query(
        `insert into event_updates (
           id, public_id, event_id, update_type, description,
           source_id, article_id, actor, created_at
         ) values ($1, $2, $3, $4, $5, $6, null, $7, $8)`,
        [
          stableUuid(`event-update:${entry.id}`),
          entry.id,
          eventIds.get(event.id),
          entry.type,
          entry.description,
          entry.sourceId ? sourceIds.get(entry.sourceId) : null,
          entry.actor,
          entry.createdAt,
        ],
      );
      timelineEntries += 1;
    }
  }

  let relations = 0;
  for (const event of snapshot.events) {
    for (const [index, relatedId] of event.relatedEventIds.entries()) {
      await client.query(
        `insert into event_relations (
           event_id, related_event_id, relation_type, sort_order
         ) values ($1, $2, 'related', $3)`,
        [eventIds.get(event.id), eventIds.get(relatedId), index],
      );
      relations += 1;
    }
  }

  await client.query(
    `insert into dataset_snapshots (
       id, mode, version, reference_time, generated_at, coverage_from, coverage_to,
       coverage_basis, coverage_label, disclaimer, limitations, is_active
     ) values (
       $1, 'demo', $2, $3, $4, $5, $6,
       $7, $8, $9, $10::jsonb, true
     )`,
    [
      stableUuid(`dataset-snapshot:${snapshot.datasetVersion}`),
      snapshot.datasetVersion,
      snapshot.referenceTime,
      snapshot.generatedAt,
      snapshot.coverage.from,
      snapshot.coverage.to,
      snapshot.coverage.basis,
      snapshot.coverage.label,
      snapshot.disclaimer,
      JSON.stringify(snapshot.limitations),
    ],
  );

  return {
    states: snapshot.states.length,
    sources: snapshot.sources.length,
    events: snapshot.events.length,
    evidenceLinks,
    timelineEntries,
    relations,
  };
}

function eventParams(event: IntelligenceEvent): unknown[] {
  const location = event.coordinates
    ? `SRID=4326;POINT(${event.coordinates.lng} ${event.coordinates.lat})`
    : null;
  return [
    eventRowId(event.id),
    event.id,
    event.slug,
    event.title,
    event.summary,
    event.category,
    event.subcategory,
    event.severity,
    event.severityRationale,
    event.stateId,
    event.lga,
    location,
    event.geoPrecision,
    event.geoConfidence,
    event.occurrenceAt,
    event.firstReportedAt,
    event.lastUpdatedAt,
    event.verificationStatus,
    event.confidence,
    JSON.stringify(event.uncertainties),
    event.analysis,
    event.analysisKind,
  ];
}
