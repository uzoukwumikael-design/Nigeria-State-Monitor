import type { SourceRegistryEntry } from "@/lib/types";

/** A live source counts as healthy when it last synced successfully within this window. */
export const HEALTHY_SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SourceHealthSummary {
  total: number;
  live: number;
  demo: number;
  healthy: number;
  /** Most recent successful sync across live sources (ISO), or null if none ever succeeded. */
  lastSuccessfulSync: string | null;
}

/** Summarises sync status from the sources the dashboard already holds. Demo sources are never counted as live or healthy. */
export function summariseSourceHealth(
  sources: readonly Pick<SourceRegistryEntry, "isDemo" | "lastSuccessfulSync">[],
  now: Date = new Date(),
): SourceHealthSummary {
  const live = sources.filter((source) => !source.isDemo);
  let latest: number | null = null;
  let healthy = 0;
  for (const source of live) {
    if (!source.lastSuccessfulSync) continue;
    const time = Date.parse(source.lastSuccessfulSync);
    if (Number.isNaN(time)) continue;
    if (latest === null || time > latest) latest = time;
    if (now.getTime() - time <= HEALTHY_SYNC_WINDOW_MS && time <= now.getTime() + 60_000) healthy += 1;
  }
  return {
    total: sources.length,
    live: live.length,
    demo: sources.length - live.length,
    healthy,
    lastSuccessfulSync: latest === null ? null : new Date(latest).toISOString(),
  };
}
