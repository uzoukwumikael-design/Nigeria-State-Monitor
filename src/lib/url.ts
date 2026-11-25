import {
  CATEGORY_IDS,
  DEFAULT_FILTERS,
  REGIONAL_TREND_DAYS,
  SEVERITIES,
  TIME_WINDOW_IDS,
  VERIFICATION_STATUSES,
  ZONE_IDS,
  type Filters,
  type RegionalTrendDays,
  type VerificationStatus,
  type ZoneId,
} from "@/lib/types";
import { STATE_BY_ID } from "@/lib/geo/states";

export interface UrlView {
  filters: Filters;
  eventId: string | null;
  regionalOpen: boolean;
  regionalZone: ZoneId | null;
  regionalDays: RegionalTrendDays;
}

export interface RegionalUrlState {
  open: boolean;
  zone: ZoneId | null;
  days: RegionalTrendDays;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function validState(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().toUpperCase();
  return STATE_BY_ID.has(candidate) ? candidate : null;
}

function validWindow(value: string | undefined): Filters["window"] {
  if (!value) return DEFAULT_FILTERS.window;
  return (TIME_WINDOW_IDS as readonly string[]).includes(value)
    ? (value as Filters["window"])
    : DEFAULT_FILTERS.window;
}

function validCategory(value: string | undefined): Filters["category"] {
  if (!value) return "all";
  return (CATEGORY_IDS as readonly string[]).includes(value)
    ? (value as Filters["category"])
    : "all";
}

function validZone(value: string | undefined): Filters["zone"] {
  if (!value) return "all";
  return (ZONE_IDS as readonly string[]).includes(value) ? (value as Filters["zone"]) : "all";
}

function validRegionalZone(value: string | undefined): ZoneId | null {
  if (!value) return null;
  return (ZONE_IDS as readonly string[]).includes(value) ? (value as ZoneId) : null;
}

function validRegionalDays(value: string | undefined): RegionalTrendDays {
  const parsed = Number(value);
  return (REGIONAL_TREND_DAYS as readonly number[]).includes(parsed)
    ? (parsed as RegionalTrendDays)
    : 14;
}

function validSeverity(value: string | undefined): Filters["severity"] {
  if (!value) return "all";
  const parsed = Number(value);
  return (SEVERITIES as readonly number[]).includes(parsed) ? (parsed as Filters["severity"]) : "all";
}

function validVerification(value: string | undefined): VerificationStatus | "all" {
  if (!value) return "all";
  return (VERIFICATION_STATUSES as readonly string[]).includes(value)
    ? (value as VerificationStatus)
    : "all";
}

function safeQuery(value: string | undefined): string {
  if (!value) return "";
  return value.trim().slice(0, 120);
}

export function viewFromSearchParams(params: URLSearchParams): UrlView {
  const state = validState(params.get("state") ?? undefined);
  let zone = validZone(params.get("zone") ?? undefined);
  if (state && zone !== "all" && STATE_BY_ID.get(state)?.zone !== zone) zone = "all";
  return {
    filters: {
      category: validCategory(params.get("category") ?? undefined),
      zone,
      stateId: state,
      severity: validSeverity(params.get("severity") ?? undefined),
      verification: validVerification(params.get("verification") ?? undefined),
      window: validWindow(params.get("window") ?? undefined),
      q: safeQuery(params.get("q") ?? undefined),
    },
    eventId: safeQuery(params.get("event") ?? undefined) || null,
    regionalOpen: params.get("view") === "regions",
    regionalZone: validRegionalZone(params.get("region") ?? undefined),
    regionalDays: validRegionalDays(params.get("trend") ?? undefined),
  };
}

/**
 * The view to start from on the client. Normally identical to the server-rendered view, but when
 * the HTML came from the offline cache of a different URL, the address bar is the truth.
 */
export function resolveInitialView(serverView: UrlView, search: string): UrlView {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  return trimmed.length > 0 ? viewFromSearchParams(new URLSearchParams(trimmed)) : serverView;
}

export function viewFromNextSearchParams(
  params: Record<string, string | string[] | undefined>,
): UrlView {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = one(value);
    if (first) search.set(key, first);
  }
  return viewFromSearchParams(search);
}

export function filtersToSearchParams(
  filters: Filters,
  eventId: string | null,
  regional?: RegionalUrlState,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.stateId) params.set("state", filters.stateId);
  if (filters.zone !== "all") params.set("zone", filters.zone);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.severity !== "all") params.set("severity", String(filters.severity));
  if (filters.verification !== "all") params.set("verification", filters.verification);
  if (filters.window !== DEFAULT_FILTERS.window) params.set("window", filters.window);
  if (filters.q) params.set("q", filters.q);
  if (eventId) params.set("event", eventId);
  if (regional?.open) {
    params.set("view", "regions");
    if (regional.zone) params.set("region", regional.zone);
    if (regional.days !== 14) params.set("trend", String(regional.days));
  }
  return params;
}

export function urlForView(
  filters: Filters,
  eventId: string | null,
  regional?: RegionalUrlState,
): string {
  const params = filtersToSearchParams(filters, eventId, regional).toString();
  return params ? `?${params}` : window.location.pathname;
}

export function activeFilterCount(filters: Filters): number {
  let count = 0;
  if (filters.stateId) count += 1;
  if (filters.zone !== "all") count += 1;
  if (filters.category !== "all") count += 1;
  if (filters.severity !== "all") count += 1;
  if (filters.verification !== "all") count += 1;
  if (filters.window !== DEFAULT_FILTERS.window) count += 1;
  if (filters.q) count += 1;
  return count;
}

export function isDefaultFilters(filters: Filters): boolean {
  return activeFilterCount(filters) === 0;
}
