import type { Filters, IntelligenceEvent, TimeWindow } from "@/lib/types";
import { categoryConfig } from "@/lib/config";

export const WINDOW_MS: Record<Exclude<TimeWindow, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000,
};

export function windowStart(window: TimeWindow, referenceIso: string): number | null {
  if (window === "all") return null;
  return new Date(referenceIso).getTime() - WINDOW_MS[window];
}

export function eventTimestamp(event: IntelligenceEvent): number {
  return new Date(event.occurrenceAt ?? event.firstReportedAt).getTime();
}

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function matchesQuery(event: IntelligenceEvent, query: string): boolean {
  const q = normalized(query.trim());
  if (!q) return true;
  const category = categoryConfig(event.category);
  const haystack = normalized(
    [
      event.title,
      event.summary,
      event.subcategory,
      event.stateName ?? "",
      event.lga ?? "",
      category.label,
      ...event.sources.map((source) => source.sourceName),
    ].join(" "),
  );
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

function matchesNonWindowFilters(event: IntelligenceEvent, filters: Filters): boolean {
  if (filters.stateId && event.stateId !== filters.stateId) return false;
  if (filters.zone !== "all" && event.zone !== filters.zone) return false;
  if (filters.category !== "all" && event.category !== filters.category) return false;
  if (filters.severity !== "all" && event.severity !== filters.severity) return false;
  if (filters.verification !== "all" && event.verificationStatus !== filters.verification) return false;
  if (filters.q && !matchesQuery(event, filters.q)) return false;
  return true;
}

export function filterEvents(
  events: readonly IntelligenceEvent[],
  filters: Filters,
  referenceIso: string,
): IntelligenceEvent[] {
  const start = windowStart(filters.window, referenceIso);
  const filtered = events.filter((event) => {
    if (!matchesNonWindowFilters(event, filters)) return false;
    if (start !== null && eventTimestamp(event) < start) return false;
    return true;
  });

  const sorted = [...filtered];
  switch (filters.window) {
    case "all":
    case "365d":
      sorted.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
      break;
    default:
      sorted.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  }
  return sorted;
}

/** Events in the equally sized period immediately before the active window. */
export function previousPeriodEvents(
  events: readonly IntelligenceEvent[],
  filters: Filters,
  referenceIso: string,
): IntelligenceEvent[] {
  if (filters.window === "all") return [];
  const reference = new Date(referenceIso).getTime();
  const duration = WINDOW_MS[filters.window];
  const end = reference - duration;
  const start = end - duration;
  return events.filter((event) => {
    if (!matchesNonWindowFilters(event, filters)) return false;
    const timestamp = eventTimestamp(event);
    return timestamp >= start && timestamp < end;
  });
}

export function filterByZone(
  events: readonly IntelligenceEvent[],
  zone: Filters["zone"],
): IntelligenceEvent[] {
  if (zone === "all") return [...events];
  return events.filter((event) => event.zone === zone);
}

export function filterByState(
  events: readonly IntelligenceEvent[],
  stateId: string | null,
): IntelligenceEvent[] {
  if (!stateId) return [...events];
  return events.filter((event) => event.stateId === stateId);
}
