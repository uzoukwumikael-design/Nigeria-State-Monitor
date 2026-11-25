import { CATEGORIES, ZONES, categoryConfig, zoneConfig } from "@/lib/config";
import { relativeTime } from "@/lib/format";
import { STATES, stateById } from "@/lib/geo/states";
import type { IntelligenceEvent, SearchHit, SearchResults } from "@/lib/types";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function score(haystack: string, needle: string): number {
  const value = normalize(haystack);
  const query = normalize(needle);
  if (!query) return 0;
  if (value === query) return 100;
  if (value.startsWith(query)) return 80;
  if (value.includes(` ${query}`)) return 60;
  if (value.includes(query)) return 40;
  const tokens = query.split(" ").filter(Boolean);
  const matched = tokens.filter((token) => value.includes(token)).length;
  return matched > 0 ? (matched / tokens.length) * 30 : 0;
}

export function searchSnapshot(
  query: string,
  events: readonly IntelligenceEvent[],
  referenceIso: string,
  limit = 12,
): SearchResults {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { states: [], events: [], categories: [], zones: [] };
  }

  const stateHits: Array<SearchHit & { score: number }> = [];
  for (const state of STATES) {
    const haystack = `${state.name} ${state.capital} ${state.zoneName} ${state.id} ${state.name === "Federal Capital Territory" ? "FCT Abuja" : ""}`;
    const hitScore = score(haystack, trimmed);
    if (hitScore > 0) {
      stateHits.push({
        kind: "state",
        id: state.id,
        title: state.name,
        subtitle: `${state.zoneName} · Capital ${state.capital}`,
        icon: "state",
        score: hitScore,
      });
    }
  }

  const eventHits: Array<SearchHit & { score: number }> = [];
  for (const event of events) {
    const category = categoryConfig(event.category);
    const haystack = `${event.title} ${event.summary} ${event.stateName ?? ""} ${event.lga ?? ""} ${event.subcategory} ${category.label} ${event.sources.map((source) => source.sourceName).join(" ")}`;
    const hitScore = score(haystack, trimmed);
    if (hitScore > 0) {
      eventHits.push({
        kind: "event",
        id: event.id,
        title: event.title,
        subtitle: `${category.shortLabel} · ${event.stateName ?? "National"} · ${relativeTime(event.lastUpdatedAt, referenceIso)}`,
        icon: event.category,
        score: hitScore,
      });
    }
  }

  const categoryHits: Array<SearchHit & { score: number }> = [];
  for (const category of CATEGORIES) {
    const hitScore = score(`${category.label} ${category.shortLabel} ${category.description}`, trimmed);
    if (hitScore > 0) {
      categoryHits.push({
        kind: "category",
        id: category.id,
        title: category.label,
        subtitle: `${category.description}`,
        icon: category.id,
        score: hitScore,
      });
    }
  }

  const zoneHits: Array<SearchHit & { score: number }> = [];
  for (const zone of ZONES) {
    const hitScore = score(`${zone.name} ${zone.shortName} ${zone.description}`, trimmed);
    if (hitScore > 0) {
      zoneHits.push({
        kind: "zone",
        id: zone.id,
        title: `${zone.name} geopolitical zone`,
        subtitle: zone.description,
        icon: "zone",
        score: hitScore,
      });
    }
  }

  const sortAndSlice = (hits: Array<SearchHit & { score: number }>, count: number): SearchHit[] =>
    hits
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, count)
      .map(({ score: _score, ...hit }) => hit);

  return {
    states: sortAndSlice(stateHits, Math.min(6, limit)),
    events: sortAndSlice(eventHits, limit),
    categories: sortAndSlice(categoryHits, 4),
    zones: sortAndSlice(zoneHits, 4),
  };
}

export function eventSearchSubtitle(event: IntelligenceEvent, referenceIso: string): string {
  const state = stateById(event.stateId);
  return `${categoryConfig(event.category).shortLabel} · ${state?.name ?? "National"} · ${relativeTime(event.lastUpdatedAt, referenceIso)}`;
}

export function zoneSearchSubtitle(zoneId: string): string {
  if (!ZONES.some((zone) => zone.id === zoneId)) return "Geopolitical zone";
  return zoneConfig(zoneId as (typeof ZONES)[number]["id"]).description;
}
