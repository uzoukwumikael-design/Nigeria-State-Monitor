import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { applyMigrations, inspectMigrations, type MigrationBundle } from "@/lib/data/postgres/migrations";
import { seedRegistry } from "@/lib/data/postgres/seed";

export interface SetupSummary {
  dryRun: boolean;
  /** Migrations applied by this call (empty when the schema was already current, or in a dry run). */
  applied: string[];
  /** Migration versions still waiting. Only meaningful in a dry run. */
  pending: string[];
  statesSeeded: number | null;
  counts: { states: number; migrationsApplied: number } | null;
  ready: boolean;
}

/**
 * One-call database setup, the same steps as `npm run db:setup:registry` minus the terminal: apply pending
 * migrations in order, then seed the 37-state registry. Safe to run repeatedly: applied migrations are skipped
 * (and checked against their recorded checksums) and the seed upserts. A dry run only reports what is pending.
 */
export async function runSetup(
  driver: DatabaseDriver,
  bundles: readonly MigrationBundle[],
  options: { dryRun?: boolean; log?: (message: string) => void } = {},
): Promise<SetupSummary> {
  if (options.dryRun) {
    const status = await inspectMigrations(driver, bundles);
    return {
      dryRun: true,
      applied: [],
      pending: status.pending,
      statesSeeded: null,
      counts: null,
      ready: false,
    };
  }
  const applied = await applyMigrations(driver, bundles, options.log);
  const seeded = await driver.transaction((tx) => seedRegistry(tx));
  const states = await driver.query<{ count: string }>("select count(*)::text as count from states");
  const ledger = await driver.query<{ count: string }>("select count(*)::text as count from _nsm_migrations");
  const counts = { states: Number(states.rows[0]?.count ?? 0), migrationsApplied: Number(ledger.rows[0]?.count ?? 0) };
  return {
    dryRun: false,
    applied,
    pending: [],
    statesSeeded: seeded.states,
    counts,
    ready: counts.states === 37 && counts.migrationsApplied >= bundles.length,
  };
}
