import { randomUUID } from "node:crypto";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { runIngestion } from "@/lib/ingestion/pipeline";
import {
  validateLeaseInput,
  type ScheduledIngestionInput,
  type ScheduledIngestionOutcome,
} from "./types";

/**
 * Runs one ingestion attempt behind a lease. If another process holds the
 * lease, this process makes no fetch and writes nothing. The lease is always
 * released in a finally block; a crashed process leaves only an expiring row.
 */
export async function runScheduledIngestion(
  input: ScheduledIngestionInput,
): Promise<ScheduledIngestionOutcome> {
  const validation = validateLeaseInput(input.lockKey, input.lockTtlSeconds);
  if (!validation.ok) throw new Error(validation.message);
  if (!input.source.active) {
    throw new Error(`Ingestion source ${input.source.slug} is not active.`);
  }

  const token = randomUUID();
  const acquired = await input.lease.acquire(input.lockKey, token, input.lockTtlSeconds);
  if (!acquired) {
    return {
      status: "locked",
      source: input.source.slug,
      lockKey: input.lockKey,
      result: null,
    };
  }

  try {
    const result = await runIngestion({
      source: input.source,
      limit: input.limit,
      store: input.store,
      fetchImpl: input.fetchImpl,
      contact: input.contact,
      now: input.now,
      runId: input.runId,
    });
    return {
      status: "ran",
      source: input.source.slug,
      lockKey: input.lockKey,
      result,
    };
  } finally {
    await input.lease.release(input.lockKey, token);
  }
}

/**
 * Postgres/PostGIS lease store. Acquisition is a single atomic upsert; a live
 * lease is never stolen even if two schedulers start at the same instant.
 */
export class PostgresSchedulerLease {
  constructor(private readonly driver: DatabaseDriver) {}

  async acquire(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
    const validation = validateLeaseInput(lockKey, ttlSeconds);
    if (!validation.ok) throw new Error(validation.message);
    const result = await this.driver.query<{ lock_key: string }>(
      `insert into scheduler_locks (lock_key, lock_token, locked_until, updated_at)
       values ($1, $2, now() + make_interval(secs => $3), now())
       on conflict (lock_key) do update
       set lock_token = excluded.lock_token,
           locked_until = excluded.locked_until,
           updated_at = now()
       where scheduler_locks.locked_until <= now()
       returning lock_key`,
      [lockKey, token, ttlSeconds],
    );
    return Boolean(result.rows[0]);
  }

  async release(lockKey: string, token: string): Promise<void> {
    await this.driver.query(
      "delete from scheduler_locks where lock_key = $1 and lock_token = $2",
      [lockKey, token],
    );
  }
}
