// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import {
  applyMigrations,
  inspectMigrations,
  rollbackMigrations,
} from "@/lib/data/postgres/migrations";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import { seedDemoData, seedRegistry } from "@/lib/data/postgres/seed";
import { buildDemoSnapshot } from "@/lib/demo/build";
import type { DashboardSnapshot } from "@/lib/types";

describe.sequential("Postgres/PostGIS data foundation", () => {
  let driver: PgliteDriver;
  let demo: DashboardSnapshot;
  let databaseSnapshot: DashboardSnapshot;
  const bundles = loadMigrationBundles();

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, bundles);
    demo = buildDemoSnapshot();
    await driver.transaction(async (tx) => {
      await seedRegistry(tx);
      await seedDemoData(tx, demo);
    });
    databaseSnapshot = await new PostgresRepository(driver, "demo").getSnapshot();
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  });

  it("round-trips the demo snapshot through PostGIS without changing event meaning", () => {
    expect(databaseSnapshot.mode).toBe("demo");
    expect(databaseSnapshot.datasetVersion).toBe(demo.datasetVersion);
    expect(databaseSnapshot.referenceTime).toBe(demo.referenceTime);
    expect(databaseSnapshot.generatedAt).toBe(demo.generatedAt);
    expect(databaseSnapshot.coverage).toEqual(demo.coverage);
    expect(databaseSnapshot.disclaimer).toBe(demo.disclaimer);
    expect(databaseSnapshot.limitations).toEqual(demo.limitations);
    expect(databaseSnapshot.states).toEqual(demo.states);
    expect(databaseSnapshot.sources).toEqual(demo.sources);

    const eventsById = new Map(databaseSnapshot.events.map((event) => [event.id, event]));
    expect(eventsById.size).toBe(demo.events.length);
    for (const expected of demo.events) {
      expect(eventsById.get(expected.id)).toEqual(expected);
    }
  });

  it("serves an individual event and preserves evidence/timeline relations", async () => {
    const repository = new PostgresRepository(driver, "demo");
    const event = await repository.getEventById("evt-demo-001");
    expect(event).not.toBeNull();
    expect(event?.isDemo).toBe(true);
    expect(event?.sources.length).toBeGreaterThan(0);
    expect(event?.timeline.length).toBeGreaterThan(0);
    expect(await repository.getEventById("missing-event")).toBeNull();
  });

  it("reapplies migrations idempotently", async () => {
    const applied = await applyMigrations(driver, bundles);
    expect(applied).toEqual([]);
    const status = await inspectMigrations(driver, bundles);
    expect(status.pending).toEqual([]);
    expect(status.changed).toEqual([]);
    expect(status.unknown).toEqual([]);
  });

  it("rejects edits to applied or rollback SQL", async () => {
    const editedUp = bundles.map((bundle, index) =>
      index === 0 ? { ...bundle, upSql: `${bundle.upSql}\n-- edited after apply` } : bundle,
    );
    await expect(applyMigrations(driver, editedUp)).rejects.toThrow(/changed after it was applied/);

    const editedDown = bundles.map((bundle, index) =>
      index === bundles.length - 1
        ? { ...bundle, downSql: `${bundle.downSql}\n-- edited rollback` }
        : bundle,
    );
    await expect(rollbackMigrations(driver, editedDown, { steps: 1 })).rejects.toThrow(
      /Refusing to run an unverified rollback/,
    );
  });

  it("refuses production mode when demo rows are present", async () => {
    const bare = new PostgresRepository(driver, "production");
    await expect(bare.getSnapshot()).rejects.toThrow(/No active production dataset snapshot/);

    await driver.query(
      `insert into dataset_snapshots (
         mode, version, reference_time, generated_at, coverage_basis,
         coverage_label, limitations, is_active
       ) values (
         'production', 'test-production-guard', now(), now(), 'live_ingestion',
         'test', '[]'::jsonb, true
       )`,
    );
    try {
      await expect(bare.getSnapshot()).rejects.toThrow(/refuses a database containing demo records/);
    } finally {
      await driver.query("delete from dataset_snapshots where version = 'test-production-guard'");
    }
  });

  it("exposes only non-demo public views to anon and denies raw tables", async () => {
    const counts = await driver.transaction(async (tx) => {
      await tx.exec("set local role anon");
      const published = await tx.query<{ count: number }>(
        "select count(*)::integer as count from published_events",
      );
      const states = await tx.query<{ count: number }>(
        "select count(*)::integer as count from public_states",
      );
      const evidence = await tx.query<{ count: number }>(
        "select count(*)::integer as count from published_event_sources",
      );
      return {
        published: published.rows[0]?.count,
        states: states.rows[0]?.count,
        evidence: evidence.rows[0]?.count,
      };
    });
    expect(counts).toEqual({ published: 0, states: 37, evidence: 0 });

    const privilege = await driver.query<{ denied: boolean }>(
      "select not has_table_privilege('anon', 'public.events', 'select') as denied",
    );
    expect(privilege.rows[0]?.denied).toBe(true);
  });

  it("rolls every migration back to an empty application schema", async () => {
    const rolledBack = await rollbackMigrations(driver, bundles, { all: true });
    expect(rolledBack.length).toBe(bundles.length);
    const status = await inspectMigrations(driver, bundles);
    expect(status.applied).toEqual([]);
    expect(status.pending).toHaveLength(bundles.length);
    const remaining = await driver.query<{ count: number }>(
      `select count(*)::integer as count from pg_tables
       where schemaname = 'public' and tablename <> '_nsm_migrations'`,
    );
    expect(remaining.rows[0]?.count).toBe(0);
  }, 60_000);
});
