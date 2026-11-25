import { categoryConfig } from "@/lib/config";
import { formatDayKey, lagosDayKey } from "@/lib/format";
import { STATE_BY_ID } from "@/lib/geo/states";
import {
  categoryBreakdown,
  severityBreakdown,
  topStates,
  zoneSummaries,
  type CategoryBreakdown,
  type NamedCount,
  type SeverityBreakdown,
  type ZoneSummary,
} from "@/lib/intelligence/aggregate";
import { eventTimestamp, WINDOW_MS } from "@/lib/intelligence/filter";
import { CATEGORY_IDS } from "@/lib/types";
import type {
  Category,
  DatasetCoverage,
  IntelligenceEvent,
  StateGeo,
  TimeWindow,
  VerificationStatus,
  ZoneId,
} from "@/lib/types";

/** Africa/Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET = "+01:00";
const DAY_MS = 86_400_000;
export const MAX_HISTORY_DAYS = 3_660;

export type HistoryBucket = "day" | "week" | "month";

export interface HistoryScope {
  stateId: string | null;
  zone: ZoneId | null;
  category: Category | null;
}

export interface HistoryRange {
  /** Inclusive Lagos calendar days, YYYY-MM-DD. */
  from: string;
  to: string;
}

export interface HistoryPoint {
  /** First Lagos day of the bucket. */
  start: string;
  label: string;
  /** False when the bucket lies wholly outside the dates records are held for (unobserved, not quiet). */
  observed: boolean;
  total: number;
  severity4Plus: number;
  critical: number;
  byCategory: Record<Category, number>;
}

export interface HistoryTimelineEntry {
  id: string;
  title: string;
  category: Category;
  categoryLabel: string;
  severity: number;
  stateId: string | null;
  stateName: string | null;
  zone: ZoneId | null;
  verificationStatus: VerificationStatus;
  at: string;
  isDemo: boolean;
}

export interface HistoryCoverage {
  from: string | null;
  to: string | null;
  basis: DatasetCoverage["basis"];
  label: string;
  /** Requested range reaches outside the dates records exist for. */
  partial: boolean;
  /** Requested range has no overlap with held records at all. */
  empty: boolean;
  note: string;
}

export interface HistoryPeriodComparison {
  from: string;
  to: string;
  total: number;
  severity4Plus: number;
  /** Fully inside held records; if false, the comparison is not like-for-like. */
  comparable: boolean;
}

export interface HistoryResult {
  range: HistoryRange;
  days: number;
  bucket: HistoryBucket;
  scope: HistoryScope & { label: string };
  totals: { events: number; severity4Plus: number; critical: number; corroborated: number; statesReporting: number };
  series: HistoryPoint[];
  previous: HistoryPeriodComparison;
  delta: { events: number; percent: number | null };
  categories: CategoryBreakdown[];
  severities: SeverityBreakdown[];
  topStates: NamedCount[];
  zones: ZoneSummary[];
  timeline: HistoryTimelineEntry[];
  coverage: HistoryCoverage;
  basis: "occurrence_time_else_first_reported";
}

// ---- day-key arithmetic (UTC math on calendar keys; no time zone drift) ----

function keyToUtc(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  return utcToKey(keyToUtc(key) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtc(to) - keyToUtc(from)) / DAY_MS) + 1;
}

export function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = keyToUtc(value);
  return !Number.isNaN(ms) && utcToKey(ms) === value;
}

function dayStartMs(key: string): number {
  return Date.parse(`${key}T00:00:00.000${LAGOS_OFFSET}`);
}

function dayEndMs(key: string): number {
  return Date.parse(`${key}T23:59:59.999${LAGOS_OFFSET}`);
}

function weekStart(key: string): string {
  const weekday = new Date(keyToUtc(key)).getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  return addDays(key, -sinceMonday);
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function chooseBucket(days: number): HistoryBucket {
  if (days <= 62) return "day";
  if (days <= 400) return "week";
  return "month";
}

function bucketStart(key: string, bucket: HistoryBucket): string {
  if (bucket === "day") return key;
  if (bucket === "week") return weekStart(key);
  return monthStart(key);
}

function bucketLabel(start: string, bucket: HistoryBucket): string {
  if (bucket === "month") {
    const [year, month] = start.split("-").map(Number);
    return new Intl.DateTimeFormat("en-NG", { month: "short", year: "2-digit", timeZone: "UTC" }).format(
      new Date(Date.UTC(year!, month! - 1, 1)),
    );
  }
  return formatDayKey(start);
}

function nextBucketStart(start: string, bucket: HistoryBucket): string {
  if (bucket === "day") return addDays(start, 1);
  if (bucket === "week") return addDays(start, 7);
  const [year, month] = start.split("-").map(Number);
  return utcToKey(Date.UTC(year!, month!, 1));
}

// ---- range resolution ----

export type HistoryRangeRequest =
  | { kind: "custom"; from: string; to: string }
  | { kind: "window"; window: TimeWindow };

export type RangeResolution =
  | { ok: true; range: HistoryRange }
  | { ok: false; message: string };

/**
 * Turns a preset window or custom Lagos dates into an inclusive day range.
 * "all" spans the first held record to the reference day; with no records it
 * collapses to the reference day so nothing is implied about earlier periods.
 */
export function resolveHistoryRange(
  request: HistoryRangeRequest,
  referenceIso: string,
  coverage: Pick<DatasetCoverage, "from" | "to">,
): RangeResolution {
  const today = lagosDayKey(referenceIso);
  if (request.kind === "custom") {
    if (!isValidDayKey(request.from) || !isValidDayKey(request.to)) {
      return { ok: false, message: "Dates must be real calendar days in YYYY-MM-DD format." };
    }
    if (request.from > request.to) {
      return { ok: false, message: "The start date must not be after the end date." };
    }
    if (daysBetween(request.from, request.to) > MAX_HISTORY_DAYS) {
      return { ok: false, message: `The range must not exceed ${MAX_HISTORY_DAYS} days.` };
    }
    return { ok: true, range: { from: request.from, to: request.to } };
  }
  if (request.window === "all") {
    const first = coverage.from ? lagosDayKey(coverage.from) : today;
    const from = first > today ? today : first;
    return { ok: true, range: { from, to: today } };
  }
  const from = lagosDayKey(new Date(new Date(referenceIso).getTime() - WINDOW_MS[request.window]));
  return { ok: true, range: { from, to: today } };
}

function describeCoverage(range: HistoryRange, coverage: DatasetCoverage): HistoryCoverage {
  const base = { from: coverage.from, to: coverage.to, basis: coverage.basis, label: coverage.label };
  if (!coverage.from || !coverage.to) {
    return {
      ...base,
      partial: true,
      empty: true,
      note: "No records are held yet. An empty history here means unobserved, not quiet.",
    };
  }
  const first = lagosDayKey(coverage.from);
  const last = lagosDayKey(coverage.to);
  if (range.to < first || range.from > last) {
    return {
      ...base,
      partial: true,
      empty: true,
      note: `No records are held for these dates. Held records run from ${first} to ${last}; outside that span is unobserved, not quiet.`,
    };
  }
  const notes: string[] = [];
  if (range.from < first) {
    notes.push(`Records begin on ${first}; earlier days in this range are unobserved, not quiet.`);
  }
  if (range.to > last) {
    notes.push(`Records end on ${last}; later days in this range are unobserved.`);
  }
  return {
    ...base,
    partial: notes.length > 0,
    empty: false,
    note:
      notes.join(" ") ||
      `Range lies within held records (${first} to ${last}). ${coverage.basis === "demo_snapshot" ? "These are fictional demo records." : ""}`.trim(),
  };
}

function emptyCategories(): Record<Category, number> {
  return Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<Category, number>;
}

function inScope(event: IntelligenceEvent, scope: HistoryScope): boolean {
  if (scope.stateId && event.stateId !== scope.stateId) return false;
  if (scope.zone && event.zone !== scope.zone) return false;
  if (scope.category && event.category !== scope.category) return false;
  return true;
}

function inRange(event: IntelligenceEvent, range: HistoryRange): boolean {
  const timestamp = eventTimestamp(event);
  return timestamp >= dayStartMs(range.from) && timestamp <= dayEndMs(range.to);
}

function scopeLabel(scope: HistoryScope): string {
  const parts: string[] = [];
  if (scope.stateId) parts.push(STATE_BY_ID.get(scope.stateId)?.name ?? scope.stateId);
  else if (scope.zone) parts.push(`${scope.zone.replace("-", " ")} zone`);
  else parts.push("Nigeria (national)");
  if (scope.category) parts.push(categoryConfig(scope.category).label);
  return parts.join(" · ");
}

export function buildHistory(input: {
  events: readonly IntelligenceEvent[];
  states: readonly StateGeo[];
  coverage: DatasetCoverage;
  referenceIso: string;
  range: HistoryRange;
  scope: HistoryScope;
}): HistoryResult {
  const { events, states, coverage, referenceIso, range, scope } = input;
  const days = daysBetween(range.from, range.to);
  const bucket = chooseBucket(days);

  const scoped = events.filter((event) => inScope(event, scope));
  const current = scoped.filter((event) => inRange(event, range));

  const firstHeld = coverage.from ? lagosDayKey(coverage.from) : null;
  const lastHeld = coverage.to ? lagosDayKey(coverage.to) : null;

  // zero-filled buckets across the whole requested range
  const points = new Map<string, HistoryPoint>();
  for (let start = bucketStart(range.from, bucket); start <= range.to; start = nextBucketStart(start, bucket)) {
    const lastDay = addDays(nextBucketStart(start, bucket), -1);
    points.set(start, {
      start,
      label: bucketLabel(start, bucket),
      observed: firstHeld !== null && lastHeld !== null && lastDay >= firstHeld && start <= lastHeld,
      total: 0,
      severity4Plus: 0,
      critical: 0,
      byCategory: emptyCategories(),
    });
  }
  for (const event of current) {
    const key = bucketStart(lagosDayKey(new Date(eventTimestamp(event))), bucket);
    const point = points.get(key);
    if (!point) continue;
    point.total += 1;
    point.byCategory[event.category] += 1;
    if (event.severity >= 4) point.severity4Plus += 1;
    if (event.severity === 5) point.critical += 1;
  }

  // equal-length period immediately before
  const previousRange: HistoryRange = { from: addDays(range.from, -days), to: addDays(range.from, -1) };
  const previousEvents = scoped.filter((event) => inRange(event, previousRange));
  const previousCoverage = describeCoverage(previousRange, coverage);
  const previous: HistoryPeriodComparison = {
    ...previousRange,
    total: previousEvents.length,
    severity4Plus: previousEvents.filter((event) => event.severity >= 4).length,
    comparable: !previousCoverage.partial,
  };

  const notable = current
    .filter(
      (event) =>
        event.severity >= 4 ||
        event.verificationStatus === "corroborated" ||
        event.verificationStatus === "official_confirmation",
    )
    .sort((a, b) => eventTimestamp(b) - eventTimestamp(a))
    .slice(0, 40)
    .map<HistoryTimelineEntry>((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      categoryLabel: categoryConfig(event.category).shortLabel,
      severity: event.severity,
      stateId: event.stateId,
      stateName: event.stateName,
      zone: event.zone,
      verificationStatus: event.verificationStatus,
      at: new Date(eventTimestamp(event)).toISOString(),
      isDemo: event.isDemo,
    }));

  return {
    range,
    days,
    bucket,
    scope: { ...scope, label: scopeLabel(scope) },
    totals: {
      events: current.length,
      severity4Plus: current.filter((event) => event.severity >= 4).length,
      critical: current.filter((event) => event.severity === 5).length,
      corroborated: current.filter(
        (event) => event.verificationStatus === "corroborated" || event.verificationStatus === "official_confirmation",
      ).length,
      statesReporting: new Set(current.map((event) => event.stateId).filter(Boolean)).size,
    },
    series: [...points.values()],
    previous,
    delta: {
      events: current.length - previous.total,
      percent: previous.total > 0 ? (current.length - previous.total) / previous.total : null,
    },
    categories: categoryBreakdown(current),
    severities: severityBreakdown(current),
    topStates: topStates(current, states, 8),
    zones: zoneSummaries(current, referenceIso),
    timeline: notable,
    coverage: describeCoverage(range, coverage),
    basis: "occurrence_time_else_first_reported",
  };
}
