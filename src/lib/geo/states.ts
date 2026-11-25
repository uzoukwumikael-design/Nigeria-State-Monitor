import registryData from "@/data/state-registry.json";
import metaData from "@/data/states.generated.json";
import { ZONE_BY_ID, zoneConfig } from "@/lib/config";
import type { LatLng, StateGeo, ZoneId } from "@/lib/types";

interface RegistryEntry {
  id: string;
  name: string;
  geoName: string;
  iso: string;
  capital: string;
  capitalLga: string;
  zone: ZoneId;
}

interface GeneratedStateMeta {
  id: string;
  name: string;
  iso: string;
  zone: ZoneId;
  capital: string;
  capitalLga: string;
  areaKm2: number;
  labelPoint: LatLng;
  capitalPoint: LatLng;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
}

const registry = registryData as RegistryEntry[];
const generated = metaData as GeneratedStateMeta[];
const generatedById = new Map(generated.map((state) => [state.id, state]));

function buildStates(): StateGeo[] {
  if (registry.length !== 37) {
    throw new Error(`State registry must contain 37 entries, received ${registry.length}`);
  }
  const seen = new Set<string>();
  const states = registry.map((entry) => {
    if (seen.has(entry.id)) throw new Error(`Duplicate state ID: ${entry.id}`);
    seen.add(entry.id);
    const meta = generatedById.get(entry.id);
    if (!meta) throw new Error(`Missing generated geometry metadata for ${entry.id}`);
    if (!ZONE_BY_ID.has(entry.zone)) throw new Error(`Unknown zone for ${entry.id}: ${entry.zone}`);
    return {
      id: entry.id,
      name: entry.name,
      iso: entry.iso,
      zone: entry.zone,
      zoneName: zoneConfig(entry.zone).name,
      capital: entry.capital,
      capitalLga: entry.capitalLga,
      areaKm2: meta.areaKm2,
      labelPoint: meta.labelPoint,
      capitalPoint: meta.capitalPoint,
      bbox: meta.bbox,
    } satisfies StateGeo;
  });
  return states.sort((a, b) => a.name.localeCompare(b.name));
}

export const STATES: readonly StateGeo[] = buildStates();

export const STATE_BY_ID = new Map(STATES.map((state) => [state.id, state]));

export function stateById(id: string | null | undefined): StateGeo | null {
  if (!id) return null;
  return STATE_BY_ID.get(id) ?? null;
}

export function stateByName(name: string): StateGeo | null {
  const normalized = name.trim().toLowerCase();
  return (
    STATES.find((state) => state.name.toLowerCase() === normalized) ??
    (normalized === "fct" || normalized === "abuja" || normalized === "abuja fct"
      ? (STATE_BY_ID.get("NG-FC") ?? null)
      : null)
  );
}

export function statesInZone(zone: ZoneId): StateGeo[] {
  return STATES.filter((state) => state.zone === zone);
}

export const STATE_IDS_BY_ZONE: Record<ZoneId, readonly string[]> = {
  "north-central": STATES.filter((s) => s.zone === "north-central").map((s) => s.id),
  "north-east": STATES.filter((s) => s.zone === "north-east").map((s) => s.id),
  "north-west": STATES.filter((s) => s.zone === "north-west").map((s) => s.id),
  "south-east": STATES.filter((s) => s.zone === "south-east").map((s) => s.id),
  "south-south": STATES.filter((s) => s.zone === "south-south").map((s) => s.id),
  "south-west": STATES.filter((s) => s.zone === "south-west").map((s) => s.id),
};

export const NIGERIA_BOUNDS = {
  minLng: 2.6,
  minLat: 4.2,
  maxLng: 14.8,
  maxLat: 14.1,
} as const;

export const NIGERIA_CENTER: LatLng = { lat: 9.082, lng: 8.6753 };
