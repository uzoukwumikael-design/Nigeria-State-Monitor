#!/usr/bin/env node
/**
 * Nigeria State Monitor — reproducible geographic build.
 *
 * Inputs (research/, downloaded from GRID3 via geoBoundaries, CC BY 4.0):
 *   nga-adm1.geojson  (37 states + FCT)
 *   nga-adm2.geojson  (774 LGAs)
 *
 * Outputs:
 *   public/data/nigeria-states.geojson   simplified, validated web geometry
 *   public/data/nigeria-svg-map.json     pre-projected SVG paths for lite mode
 *   src/data/states.generated.json       registry + derived geographic metadata
 *   src/data/lga-gazetteer.json          774 LGA representative points + parent state
 *
 * The script fails loudly rather than guessing. Do not hand-edit outputs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import polylabel from "polylabel";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESEARCH = path.join(ROOT, "research");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const SRC_DATA = path.join(ROOT, "src", "data");

const SIMPLIFY_TOLERANCE = 0.004; // ~440 m at the equator
const SVG_WIDTH = 1000;
const SVG_PADDING = 24;
const EARTH_RADIUS_KM = 6371.0088;
const NIGERIA_BOUNDS = { minLng: 2.6, maxLng: 14.8, minLat: 4.2, maxLat: 14.0 };

const registry = JSON.parse(fs.readFileSync(path.join(SRC_DATA, "state-registry.json"), "utf8"));
const adm1 = JSON.parse(fs.readFileSync(path.join(RESEARCH, "nga-adm1.geojson"), "utf8"));
const adm2 = JSON.parse(fs.readFileSync(path.join(RESEARCH, "nga-adm2.geojson"), "utf8"));

const fail = (message) => {
  console.error(`\nGEO BUILD FAILED: ${message}\n`);
  process.exit(1);
};

if (registry.length !== 37) fail(`registry has ${registry.length} entries, expected 37`);
if (adm1.features.length !== 37) fail(`ADM1 has ${adm1.features.length} features, expected 37`);
if (adm2.features.length !== 774) fail(`ADM2 has ${adm2.features.length} features, expected 774`);

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function ringAreaKm2(ring) {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total +=
      ((lng2 - lng1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

function polygonAreaKm2(polygon) {
  const [outer, ...holes] = polygon;
  return Math.max(0, ringAreaKm2(outer) - holes.reduce((sum, h) => sum + ringAreaKm2(h), 0));
}

function geometryAreaKm2(geometry) {
  if (geometry.type === "Polygon") return polygonAreaKm2(geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((sum, p) => sum + polygonAreaKm2(p), 0);
  }
  return 0;
}

function squaredDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.sqrt(squaredDistance(point, start));
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const proj = [start[0] + clamped * dx, start[1] + clamped * dy];
  return Math.sqrt(squaredDistance(point, proj));
}

function simplifyRdp(points, tolerance) {
  if (points.length <= 4) return points;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyRdp(points.slice(0, index + 1), tolerance);
    const right = simplifyRdp(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

function simplifyRing(ring, tolerance) {
  if (ring.length <= 5) return ring;
  const open = ring.slice(0, -1);
  const closed = ring[ring.length - 1];
  // Rotate the start point to avoid a degenerate anchor in RDP.
  const first = open[0];
  const last = open[open.length - 1];
  const simplified = simplifyRdp([...open, first], tolerance);
  simplified.pop();
  if (simplified.length < 3) return ring;
  const rounded = simplified.map(([lng, lat]) => [round(lng, 5), round(lat, 5)]);
  if (squaredDistance(rounded[0], rounded[rounded.length - 1]) > 0) {
    rounded.push([...rounded[0]]);
  }
  void closed;
  void last;
  return rounded;
}

function simplifyGeometry(geometry, tolerance) {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map((r) => simplifyRing(r, tolerance)) };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((poly) => poly.map((r) => simplifyRing(r, tolerance))),
    };
  }
  fail(`unsupported geometry type ${geometry.type}`);
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) if (pointInRing(point, polygon[i])) return false;
  return true;
}

function pointInGeometry(point, geometry) {
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((p) => pointInPolygon(point, p));
  return false;
}

function largestPolygon(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  return geometry.coordinates.reduce((best, p) => (polygonAreaKm2(p) > polygonAreaKm2(best) ? p : best));
}

function polylabelPoint(polygon) {
  const [outer, ...holes] = polygon;
  const result = polylabel([outer, ...holes], 0.002);
  return { lng: round(result[0], 5), lat: round(result[1], 5) };
}

function bboxOfGeometry(geometry) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    for (const c of coords) visit(c);
  };
  visit(geometry.coordinates);
  return { minLng, minLat, maxLng, maxLat };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function assertValidCoordinate([lng, lat], label) {
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < NIGERIA_BOUNDS.minLng ||
    lng > NIGERIA_BOUNDS.maxLng ||
    lat < NIGERIA_BOUNDS.minLat ||
    lat > NIGERIA_BOUNDS.maxLat
  ) {
    fail(`coordinate outside Nigeria bounds for ${label}: ${lng},${lat}`);
  }
}

// ---------------------------------------------------------------------------
// Match ADM1 to the authoritative registry
// ---------------------------------------------------------------------------

const byGeoName = new Map(adm1.features.map((f) => [f.properties.shapeName, f]));
const matched = [];
for (const entry of registry) {
  const feature = byGeoName.get(entry.geoName);
  if (!feature) fail(`no ADM1 feature for ${entry.name} (geoName "${entry.geoName}")`);
  if (matched.some((m) => m.entry.id === entry.id)) fail(`duplicate registry ID ${entry.id}`);
  matched.push({ entry, feature });
}
if (matched.length !== 37) fail(`matched ${matched.length} states, expected 37`);

const stateSourceGeometry = new Map(matched.map(({ entry, feature }) => [entry.id, feature.geometry]));
const stateMeta = [];

for (const { entry, feature } of matched) {
  const sourceArea = geometryAreaKm2(feature.geometry);
  const simplified = simplifyGeometry(feature.geometry, SIMPLIFY_TOLERANCE);
  const simplifiedArea = geometryAreaKm2(simplified);
  const areaRatio = simplifiedArea / sourceArea;
  if (areaRatio < 0.97 || areaRatio > 1.03) {
    fail(`${entry.name} area ratio ${areaRatio.toFixed(3)} outside [0.97, 1.03]`);
  }
  const bbox = bboxOfGeometry(feature.geometry);
  assertValidCoordinate([bbox.minLng, bbox.minLat], entry.name);
  assertValidCoordinate([bbox.maxLng, bbox.maxLat], entry.name);

  const poly = largestPolygon(feature.geometry);
  const labelPoint = polylabelPoint(poly);
  if (!pointInGeometry([labelPoint.lng, labelPoint.lat], feature.geometry)) {
    fail(`label point for ${entry.name} is outside its boundary`);
  }

  stateMeta.push({
    id: entry.id,
    name: entry.name,
    iso: entry.iso,
    zone: entry.zone,
    capital: entry.capital,
    capitalLga: entry.capitalLga,
    areaKm2: round(sourceArea, 1),
    labelPoint,
    bbox: {
      minLng: round(bbox.minLng, 4),
      minLat: round(bbox.minLat, 4),
      maxLng: round(bbox.maxLng, 4),
      maxLat: round(bbox.maxLat, 4),
    },
    _simplified: simplified,
  });
}

const totalArea = stateMeta.reduce((sum, s) => sum + s.areaKm2, 0);
console.log(`Total ADM1 area: ${totalArea.toLocaleString()} km²`);
if (totalArea < 900_000 || totalArea > 960_000) fail(`implausible Nigeria area total: ${totalArea}`);

// ---------------------------------------------------------------------------
// Web GeoJSON
// ---------------------------------------------------------------------------

const webFeatures = stateMeta.map((state) => ({
  type: "Feature",
  properties: {
    id: state.id,
    name: state.name,
    zone: state.zone,
    capital: state.capital,
    areaKm2: state.areaKm2,
  },
  geometry: state._simplified,
}));

const webGeojson = {
  type: "FeatureCollection",
  metadata: {
    source: "GRID3 Nigeria State Boundaries (2022), via geoBoundaries NGA-ADM1",
    licence: "CC BY 4.0",
    sourceUrl: "https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/",
    simplifiedToleranceDegrees: SIMPLIFY_TOLERANCE,
    generatedAt: new Date().toISOString().slice(0, 10),
  },
  features: webFeatures,
};

fs.mkdirSync(PUBLIC_DATA, { recursive: true });
const webGeoJsonPath = path.join(PUBLIC_DATA, "nigeria-states.geojson");
fs.writeFileSync(webGeoJsonPath, JSON.stringify(webGeojson));
console.log(
  `Wrote ${webGeoJsonPath} (${(fs.statSync(webGeoJsonPath).size / 1024).toFixed(0)} kB, 37 features)`,
);

// ---------------------------------------------------------------------------
// LGA gazetteer (774) with parent assignment
// ---------------------------------------------------------------------------

const lgaRecords = [];
for (const feature of adm2.features) {
  const name = feature.properties.shapeName;
  const poly = largestPolygon(feature.geometry);
  const point = polylabelPoint(poly);
  const coord = [point.lng, point.lat];
  assertValidCoordinate(coord, `LGA ${name}`);
  const parent = [...stateSourceGeometry.entries()].find(([, geometry]) => pointInGeometry(coord, geometry));
  if (!parent) fail(`LGA ${name} (${coord}) does not fall inside any state`);
  lgaRecords.push({
    name,
    stateId: parent[0],
    lat: point.lat,
    lng: point.lng,
    areaKm2: round(geometryAreaKm2(feature.geometry), 1),
  });
}

if (lgaRecords.length !== 774) fail(`LGA gazetteer has ${lgaRecords.length} records, expected 774`);
const perState = new Map();
for (const lga of lgaRecords) {
  perState.set(lga.stateId, (perState.get(lga.stateId) ?? 0) + 1);
}
for (const state of stateMeta) {
  const count = perState.get(state.id) ?? 0;
  if (count === 0) fail(`no LGAs assigned to ${state.name}`);
}
console.log(
  `LGA counts by state: min ${Math.min(...perState.values())}, max ${Math.max(...perState.values())}, total ${lgaRecords.length}`,
);

const duplicateLgaNames = new Map();
for (const lga of lgaRecords) {
  const key = lga.name.toLowerCase();
  duplicateLgaNames.set(key, (duplicateLgaNames.get(key) ?? 0) + 1);
}
console.log(`LGA names shared across states: ${[...duplicateLgaNames.values()].filter((n) => n > 1).length}`);

// Validate capital LGA references.
for (const state of stateMeta) {
  const capital = lgaRecords.find(
    (lga) => lga.stateId === state.id && lga.name.toLowerCase() === state.capitalLga.toLowerCase(),
  );
  if (!capital) fail(`capital LGA "${state.capitalLga}" not found in ${state.name}`);
  state.capitalPoint = { lat: capital.lat, lng: capital.lng };
}

// ---------------------------------------------------------------------------
// SVG lite map projection
// ---------------------------------------------------------------------------

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercatorX = (lng) => (lng * Math.PI) / 180;

let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
for (const state of stateMeta) {
  for (const poly of state._simplified.type === "Polygon" ? [state._simplified.coordinates] : state._simplified.coordinates) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        const x = mercatorX(lng);
        const y = mercatorY(lat);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
}
const scale = (SVG_WIDTH - SVG_PADDING * 2) / (maxX - minX);
const svgHeight = Math.round((maxY - minY) * scale + SVG_PADDING * 2);
const project = (lng, lat) => [
  round(SVG_PADDING + (mercatorX(lng) - minX) * scale, 1),
  round(SVG_PADDING + (maxY - mercatorY(lat)) * scale, 1),
];

const svgStates = stateMeta.map((state) => {
  const polygons =
    state._simplified.type === "Polygon" ? [state._simplified.coordinates] : state._simplified.coordinates;
  const d = polygons
    .flatMap((poly) => poly.map((ring) => `${ring.map(([lng, lat], i) => `${i === 0 ? "M" : "L"}${project(lng, lat).join(" ")}`).join(" ")}Z`))
    .join(" ");
  return {
    id: state.id,
    name: state.name,
    zone: state.zone,
    path: d,
    label: [...project(state.labelPoint.lng, state.labelPoint.lat), state.areaKm2],
    capital: project(state.capitalPoint.lng, state.capitalPoint.lat),
  };
});

const svgMap = {
  viewBox: `0 0 ${SVG_WIDTH} ${svgHeight}`,
  width: SVG_WIDTH,
  height: svgHeight,
  projection: { minX, maxY, scale, padding: SVG_PADDING },
  source: "GRID3 Nigeria State Boundaries (2022) via geoBoundaries — CC BY 4.0",
  states: svgStates,
};

const svgPath = path.join(PUBLIC_DATA, "nigeria-svg-map.json");
fs.writeFileSync(svgPath, JSON.stringify(svgMap));
console.log(`Wrote ${svgPath} (${(fs.statSync(svgPath).size / 1024).toFixed(0)} kB)`);

// ---------------------------------------------------------------------------
// State metadata (small, client-importable)
// ---------------------------------------------------------------------------

const publicStateMeta = stateMeta
  .map(({ _simplified, ...rest }) => rest)
  .sort((a, b) => a.name.localeCompare(b.name));

const generatedPath = path.join(SRC_DATA, "states.generated.json");
fs.writeFileSync(generatedPath, JSON.stringify(publicStateMeta, null, 2));
console.log(`Wrote ${generatedPath}`);

const gazetteerPath = path.join(SRC_DATA, "lga-gazetteer.json");
fs.writeFileSync(gazetteerPath, JSON.stringify(lgaRecords));
console.log(`Wrote ${gazetteerPath} (${(fs.statSync(gazetteerPath).size / 1024).toFixed(0)} kB)`);

console.log("\nGeo build complete. All 37 states matched; all 774 LGAs assigned.");
