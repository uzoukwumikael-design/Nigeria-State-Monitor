import lgaData from "@/data/lga-gazetteer.json";

/**
 * Authoritative LGA names from the checked-in GRID3/geoBoundaries gazetteer.
 * This helper is server-side: it is used to validate AI proposals and to build
 * bounded prompt context, never to invent a location.
 */
export interface LgaGazetteerEntry {
  name: string;
  stateId: string;
  lat: number;
  lng: number;
  areaKm2: number;
}

const entries = lgaData as LgaGazetteerEntry[];

export const LGA_ENTRIES: readonly LgaGazetteerEntry[] = entries;

function normalizeLgaName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const byState = new Map<string, LgaGazetteerEntry[]>();
const byStateAndName = new Map<string, LgaGazetteerEntry>();

for (const entry of entries) {
  const list = byState.get(entry.stateId) ?? [];
  list.push(entry);
  byState.set(entry.stateId, list);

  const key = `${entry.stateId}|${normalizeLgaName(entry.name)}`;
  if (!byStateAndName.has(key)) byStateAndName.set(key, entry);
}

for (const list of byState.values()) {
  list.sort((a, b) => a.name.localeCompare(b.name));
}

export function lgasForState(stateId: string | null | undefined): readonly LgaGazetteerEntry[] {
  if (!stateId) return [];
  return byState.get(stateId) ?? [];
}

/**
 * Returns the canonical gazetteer spelling for an LGA only when it belongs to
 * the supplied state. Punctuation and case are normalised; the stored value is
 * always the source spelling, never the model's spelling.
 */
export function canonicalLgaName(
  stateId: string | null | undefined,
  value: string | null | undefined,
): string | null {
  if (!stateId || !value) return null;
  const normalized = normalizeLgaName(value);
  if (!normalized) return null;
  return byStateAndName.get(`${stateId}|${normalized}`)?.name ?? null;
}
