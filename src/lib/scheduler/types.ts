import type { IngestionRunResult } from "@/lib/ingestion/pipeline";
import type { IngestionSource, IngestionStore } from "@/lib/ingestion/types";
import type { FetchLike } from "@/lib/ingestion/fetch";

/** Database-backed lease. A lease is advisory and expires if a process dies. */
export interface SchedulerLease {
  acquire(lockKey: string, token: string, ttlSeconds: number): Promise<boolean>;
  release(lockKey: string, token: string): Promise<void>;
}

export const SCHEDULER_LOCK_KEY_PATTERN = /^[a-z0-9][a-z0-9:._-]{2,127}$/;

export interface ScheduledIngestionInput {
  source: IngestionSource;
  store: IngestionStore;
  lease: SchedulerLease;
  lockKey: string;
  lockTtlSeconds: number;
  limit?: number;
  fetchImpl?: FetchLike;
  contact?: string;
  now?: Date;
  runId?: string;
}

export interface ScheduledIngestionOutcome {
  status: "locked" | "ran";
  source: string;
  lockKey: string;
  result: IngestionRunResult | null;
}

export type CronAuthorization =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "unauthorized" };

export function validateLeaseInput(
  lockKey: string,
  ttlSeconds: number,
): { ok: true } | { ok: false; message: string } {
  if (!SCHEDULER_LOCK_KEY_PATTERN.test(lockKey)) {
    return {
      ok: false,
      message: "Scheduler lock key must be 3–128 lowercase characters: letters, digits, colons, dots, underscores or hyphens.",
    };
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3_600) {
    return { ok: false, message: "Scheduler lock TTL must be an integer between 30 and 3600 seconds." };
  }
  return { ok: true };
}
