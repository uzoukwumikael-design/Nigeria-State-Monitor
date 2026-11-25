import { createHash } from "node:crypto";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";

export interface MigrationBundle {
  version: string;
  filename: string;
  upSql: string;
  downSql: string;
}

interface AppliedMigrationRow {
  version: string;
  checksum_up: string;
  checksum_down: string;
}

const LEDGER_TABLE = "_nsm_migrations";

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function assertVersion(version: string): void {
  if (!/^\d{4}$/.test(version)) {
    throw new Error(`Migration filename must start with a four-digit version, received: ${version}`);
  }
}

export async function ensureMigrationLedger(driver: DatabaseDriver): Promise<void> {
  await driver.exec(`
    create table if not exists ${LEDGER_TABLE} (
      version        text primary key,
      filename       text not null,
      checksum_up    text not null,
      checksum_down  text not null,
      applied_at     timestamptz not null default now()
    );
  `);
}

async function appliedMigrations(driver: DatabaseDriver): Promise<AppliedMigrationRow[]> {
  const result = await driver.query<AppliedMigrationRow>(
    `select version, checksum_up, checksum_down from ${LEDGER_TABLE} order by version`,
  );
  return result.rows;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  changed: string[];
  unknown: string[];
}

/**
 * Read-only migration inspection used by `db:doctor` and `db:verify`. Unlike
 * applyMigrations, this never creates the ledger or executes migration SQL.
 */
export async function inspectMigrations(
  driver: DatabaseDriver,
  bundles: readonly MigrationBundle[],
): Promise<MigrationStatus> {
  const sorted = [...bundles].sort((a, b) => a.version.localeCompare(b.version));
  const ledger = await driver.query<{ exists: boolean }>(
    "select to_regclass('public._nsm_migrations') is not null as exists",
  );
  if (!ledger.rows[0]?.exists) {
    return {
      applied: [],
      pending: sorted.map((bundle) => bundle.filename),
      changed: [],
      unknown: [],
    };
  }

  const rows = await appliedMigrations(driver);
  const byVersion = new Map(sorted.map((bundle) => [bundle.version, bundle]));
  const appliedVersions = new Set(rows.map((row) => row.version));

  return {
    applied: rows.map((row) => byVersion.get(row.version)?.filename ?? row.version),
    pending: sorted
      .filter((bundle) => !appliedVersions.has(bundle.version))
      .map((bundle) => bundle.filename),
    changed: rows
      .filter((row) => {
        const bundle = byVersion.get(row.version);
        return (
          bundle !== undefined &&
          (checksum(bundle.upSql) !== row.checksum_up ||
            checksum(bundle.downSql) !== row.checksum_down)
        );
      })
      .map((row) => byVersion.get(row.version)?.filename ?? row.version),
    unknown: rows.filter((row) => !byVersion.has(row.version)).map((row) => row.version),
  };
}

export async function applyMigrations(
  driver: DatabaseDriver,
  bundles: readonly MigrationBundle[],
  log: (message: string) => void = () => undefined,
): Promise<string[]> {
  await ensureMigrationLedger(driver);
  const applied = new Map((await appliedMigrations(driver)).map((row) => [row.version, row]));
  const sorted = [...bundles].sort((a, b) => a.version.localeCompare(b.version));
  const appliedNow: string[] = [];

  for (const bundle of sorted) {
    assertVersion(bundle.version);
    const upChecksum = checksum(bundle.upSql);
    const downChecksum = checksum(bundle.downSql);
    const existing = applied.get(bundle.version);
    if (existing) {
      if (existing.checksum_up !== upChecksum || existing.checksum_down !== downChecksum) {
        throw new Error(
          `Migration ${bundle.filename} changed after it was applied. Add a new migration instead of editing history.`,
        );
      }
      continue;
    }

    await driver.transaction(async (tx) => {
      await tx.exec(bundle.upSql);
      await tx.query(
        `insert into ${LEDGER_TABLE} (version, filename, checksum_up, checksum_down)
         values ($1, $2, $3, $4)`,
        [bundle.version, bundle.filename, upChecksum, downChecksum],
      );
    });
    appliedNow.push(bundle.version);
    log(`applied ${bundle.filename}`);
  }

  return appliedNow;
}

export async function rollbackMigrations(
  driver: DatabaseDriver,
  bundles: readonly MigrationBundle[],
  options: { steps?: number; all?: boolean } = {},
  log: (message: string) => void = () => undefined,
): Promise<string[]> {
  await ensureMigrationLedger(driver);
  const byVersion = new Map(bundles.map((bundle) => [bundle.version, bundle]));
  const applied = [...(await appliedMigrations(driver))].reverse();
  const requested = options.all ? applied.length : Math.max(1, options.steps ?? 1);
  const selected = applied.slice(0, requested);
  const rolledBack: string[] = [];

  for (const row of selected) {
    const bundle = byVersion.get(row.version);
    if (!bundle) {
      throw new Error(`No rollback source found for applied migration version ${row.version}.`);
    }
    if (checksum(bundle.downSql) !== row.checksum_down) {
      throw new Error(
        `Rollback ${bundle.filename} changed after it was applied. Refusing to run an unverified rollback.`,
      );
    }
    await driver.transaction(async (tx) => {
      await tx.exec(bundle.downSql);
      await tx.query(`delete from ${LEDGER_TABLE} where version = $1`, [row.version]);
    });
    rolledBack.push(row.version);
    log(`rolled back ${bundle.filename}`);
  }

  return rolledBack;
}
