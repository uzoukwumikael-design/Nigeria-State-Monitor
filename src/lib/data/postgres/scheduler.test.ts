// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { PostgresSchedulerLease } from "@/lib/scheduler/run";

vi.setConfig({ testTimeout: 60_000 });

const TOKEN_A = "00000000-0000-4000-8000-000000000501";
const TOKEN_B = "00000000-0000-4000-8000-000000000502";
const TOKEN_C = "00000000-0000-4000-8000-000000000503";
const TOKEN_D = "00000000-0000-4000-8000-000000000504";
const WRONG = "00000000-0000-4000-8000-000000000505";

describe.sequential("Postgres scheduler lease", () => {
  let driver: PgliteDriver;
  let lease: PostgresSchedulerLease;

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, loadMigrationBundles());
    lease = new PostgresSchedulerLease(driver);
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  }, 30_000);

  it("allows exactly one live lease and never steals it", async () => {
    expect(await lease.acquire("ingest:premium-times", TOKEN_A, 60)).toBe(true);
    expect(await lease.acquire("ingest:premium-times", TOKEN_B, 60)).toBe(false);

    const rows = await driver.query<{ lock_token: string }>(
      "select lock_token from scheduler_locks where lock_key = $1",
      ["ingest:premium-times"],
    );
    expect(rows.rows).toEqual([{ lock_token: TOKEN_A }]);
  });

  it("releases only for the owning token, then allows reacquisition", async () => {
    await lease.release("ingest:premium-times", WRONG);
    expect(
      (await driver.query("select 1 from scheduler_locks where lock_key = $1", [
        "ingest:premium-times",
      ])).rows,
    ).toHaveLength(1);

    await lease.release("ingest:premium-times", TOKEN_A);
    expect(
      (await driver.query("select 1 from scheduler_locks where lock_key = $1", [
        "ingest:premium-times",
      ])).rows,
    ).toHaveLength(0);

    expect(await lease.acquire("ingest:premium-times", TOKEN_C, 60)).toBe(true);
  });

  it("allows a new process to acquire an expired lease", async () => {
    await driver.query(
      `update scheduler_locks
       set locked_until = now() - interval '1 minute'
       where lock_key = $1`,
      ["ingest:premium-times"],
    );
    expect(await lease.acquire("ingest:premium-times", TOKEN_D, 60)).toBe(true);

    const rows = await driver.query<{ lock_token: string }>(
      "select lock_token from scheduler_locks where lock_key = $1",
      ["ingest:premium-times"],
    );
    expect(rows.rows).toEqual([{ lock_token: TOKEN_D }]);
  });

  it("rejects invalid lock arguments before touching the table", async () => {
    await expect(lease.acquire("INVALID", WRONG, 60)).rejects.toThrow(/lock key/i);
    await expect(lease.acquire("ingest:ok", WRONG, 10)).rejects.toThrow(/TTL/);
  });
});
