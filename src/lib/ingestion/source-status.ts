import { circuitState } from "@/lib/ingestion/circuit";
import type { EvidenceLevel } from "@/lib/ingestion/sources";
import type { IngestionSource } from "@/lib/ingestion/types";

export type SourceRunState = "healthy" | "failing" | "paused" | "never_run" | "unknown" | "disabled";

export interface SourceHealthRecord {
  status: string;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessfulSync: string | null;
  lastError: string | null;
}

export interface SourceActivityRecord {
  articlesLast24h: number;
  articlesTotal: number;
}

export interface SourceStatusRow {
  slug: string;
  name: string;
  tier: IngestionSource["tier"];
  host: string;
  licenceStatus: IngestionSource["licenceStatus"];
  evidenceLevel: EvidenceLevel;
  evidenceNote: string;
  state: SourceRunState;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessfulSync: string | null;
  lastError: string | null;
  retryAt: string | null;
  articlesLast24h: number | null;
  articlesTotal: number | null;
}

export interface SourceStatusSummary {
  total: number;
  healthy: number;
  failing: number;
  paused: number;
  neverRun: number;
  unknown: number;
  disabled: number;
}

/**
 * Combines the registry, its evidence labels and (when a database exists) recorded health and activity into
 * what the sources panel shows. Without a database every source is "unknown": nothing is invented.
 */
export function buildSourceStatus(input: {
  sources: readonly IngestionSource[];
  evidence: Readonly<Record<string, { level: EvidenceLevel; note: string }>>;
  health: ReadonlyMap<string, SourceHealthRecord> | null;
  activity: ReadonlyMap<string, SourceActivityRecord> | null;
  /** Slugs switched off with INGESTION_DISABLE. */
  disabled?: ReadonlySet<string>;
  now?: Date;
}): { rows: SourceStatusRow[]; summary: SourceStatusSummary } {
  const now = input.now ?? new Date();
  const rows = input.sources.map<SourceStatusRow>((source) => {
    const health = input.health?.get(source.slug) ?? null;
    const activity = input.activity?.get(source.slug) ?? null;
    const evidence = input.evidence[source.slug] ?? { level: "directory" as const, note: "No evidence recorded." };
    const circuit = health ? circuitState({ consecutiveFailures: health.consecutiveFailures, lastCheckedAt: health.lastCheckedAt }, now) : null;

    let state: SourceRunState;
    if (input.disabled?.has(source.slug)) state = "disabled";
    else if (input.health === null) state = "unknown";
    else if (!health) state = "never_run";
    else if (circuit?.open) state = "paused";
    else if (health.consecutiveFailures > 0 || health.status === "down") state = "failing";
    else state = "healthy";

    return {
      slug: source.slug,
      name: source.name,
      tier: source.tier,
      host: new URL(source.feedUrl).hostname,
      licenceStatus: source.licenceStatus,
      evidenceLevel: evidence.level,
      evidenceNote: evidence.note,
      state,
      consecutiveFailures: health?.consecutiveFailures ?? 0,
      lastCheckedAt: health?.lastCheckedAt ?? null,
      lastSuccessfulSync: health?.lastSuccessfulSync ?? null,
      lastError: health?.lastError ?? null,
      retryAt: circuit?.open ? circuit.retryAt : null,
      articlesLast24h: input.activity === null ? null : (activity?.articlesLast24h ?? 0),
      articlesTotal: input.activity === null ? null : (activity?.articlesTotal ?? 0),
    };
  });
  const count = (state: SourceRunState) => rows.filter((row) => row.state === state).length;
  return {
    rows,
    summary: {
      total: rows.length,
      healthy: count("healthy"),
      failing: count("failing"),
      paused: count("paused"),
      neverRun: count("never_run"),
      unknown: count("unknown"),
      disabled: count("disabled"),
    },
  };
}
