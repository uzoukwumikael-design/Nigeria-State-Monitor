// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationBundles } from "@/lib/data/postgres/load-migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { runSetup } from "./run-setup";

const bundles = loadMigrationBundles(process.cwd());
let driver: PgliteDriver;

beforeAll(async () => {
  driver = await PgliteDriver.create();
}, 120_000);

afterAll(async () => {
  await driver?.close();
});

describe("runSetup", () => {
  it("reports every migration as pending in a dry run without changing anything", async () => {
    const dry = await runSetup(driver, bundles, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, applied: [], statesSeeded: null, ready: false });
    expect(dry.pending).toHaveLength(bundles.length);
    const tables = await driver.query<{ count: string }>("select count(*)::text as count from information_schema.tables where table_name = 'states'");
    expect(tables.rows[0]?.count).toBe("0");
  }, 120_000);

  it("applies all migrations and seeds the 37 states, ending ready", async () => {
    const first = await runSetup(driver, bundles);
    expect(first.applied).toHaveLength(bundles.length);
    expect(first).toMatchObject({ dryRun: false, statesSeeded: 37, ready: true });
    expect(first.counts).toEqual({ states: 37, migrationsApplied: bundles.length });
  }, 240_000);

  it("is safe to run again: nothing re-applied, still ready, and a dry run now shows nothing pending", async () => {
    const second = await runSetup(driver, bundles);
    expect(second.applied).toEqual([]);
    expect(second).toMatchObject({ statesSeeded: 37, ready: true });
    expect((await runSetup(driver, bundles, { dryRun: true })).pending).toEqual([]);
  }, 240_000);
});
