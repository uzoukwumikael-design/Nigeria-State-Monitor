import assert from "node:assert/strict";
import {
  describePostgresConnection,
  PostgresDriver,
  type PostgresConnectionInfo,
} from "@/lib/data/postgres/client";
import { inspectMigrations } from "@/lib/data/postgres/migrations";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import { buildDemoSnapshot } from "@/lib/demo/build";
import { STATES } from "@/lib/geo/states";
import { resolveDatabaseUrl } from "./connection";
import { loadMigrationBundles } from "./load-migrations";

interface CountRow {
  count: number;
}

interface PostgisRow {
  version: string;
  schema: string;
}

interface ActiveSnapshotRow {
  mode: "demo" | "production";
  version: string;
}

const REQUIRED_TABLES = [
  "states",
  "dataset_snapshots",
  "sources",
  "raw_items",
  "articles",
  "events",
  "event_sources",
  "event_updates",
  "event_relations",
  "event_clusters",
  "ingestion_logs",
  "source_health",
  "economic_indicators",
  "economic_observations",
  "audit_logs",
] as const;

function targetLine(info: PostgresConnectionInfo): string {
  return `${info.user}@${info.host}:${info.port}/${info.database}`;
}

function checkSsl(info: PostgresConnectionInfo, warnings: string[]): void {
  if (info.isSupabase && info.sslMode === "disable") {
    throw new Error(
      "SSL is disabled for a Supabase host. Remove DATABASE_SSL=disable and use require or verify-full.",
    );
  }
  if (info.sslMode === "require") {
    warnings.push(
      "SSL is encrypted but the server certificate is not verified. " +
        "For production use DATABASE_SSL=verify-full with DATABASE_SSL_CA.",
    );
  }
  if (!info.isSupabase && info.sslMode === "default" && info.host !== "localhost" && info.host !== "127.0.0.1") {
    warnings.push(
      "A remote non-Supabase host has no explicit SSL setting. Set DATABASE_SSL=require or verify-full.",
    );
  }
  if (!info.isSupabase && info.sslMode === "disable" && info.host !== "localhost" && info.host !== "127.0.0.1") {
    warnings.push("SSL is disabled for a remote non-Supabase host.");
  }
}

function checkPooler(info: PostgresConnectionInfo, role: "admin" | "runtime", warnings: string[]): void {
  if (role === "admin" && info.pooler === "transaction") {
    warnings.push(
      "The admin connection uses a transaction pooler. Prefer MIGRATION_DATABASE_URL with the session (5432) or direct URL for migrations.",
    );
  }
  if (role === "admin" && info.isSupabase && info.pooler === "direct") {
    warnings.push(
      "Supabase direct connections are IPv6 by default. On an IPv4-only network use the shared session pooler on port 5432.",
    );
  }
  if (role === "runtime" && info.pooler === "transaction" && info.poolMax > 5) {
    warnings.push(
      `DATABASE_POOL_MAX is ${info.poolMax}. Serverless runtimes usually need 1 connection per instance.`,
    );
  }
}

async function readPostgis(
  driver: PostgresDriver,
  label: string,
): Promise<PostgisRow> {
  const postgis = await driver.query<PostgisRow>(
    `select e.extversion as version, n.nspname as schema
     from pg_extension e
     join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'postgis'`,
  );
  const row = postgis.rows[0];
  assert.ok(
    row,
    `${label}: PostGIS is not installed. Enable it with: create extension postgis with schema extensions;`,
  );
  assert.equal(
    row.schema,
    "extensions",
    `${label}: PostGIS is installed in schema "${row.schema}", but NSM requires "extensions".`,
  );
  const qualified = await driver.query<{ version: string }>(
    "select extensions.postgis_version() as version",
  );
  console.log(`  PostGIS: ${qualified.rows[0]?.version ?? row.version} in schema extensions`);
  return row;
}

async function readServer(
  driver: PostgresDriver,
  label: string,
): Promise<{ role: string; version: string; schemas: string[] }> {
  const result = await driver.query<{
    role: string;
    database: string;
    version: string;
    schemas: string[];
  }>(
    `select current_user as role,
            current_database() as database,
            current_setting('server_version') as version,
            current_schemas(false)::text[] as schemas`,
  );
  const row = result.rows[0];
  assert.ok(row, `${label}: unable to read the database server identity.`);
  assert.ok(
    row.role !== "anon" && row.role !== "authenticated",
    `${label}: connected as ${row.role}; use the postgres/admin connection string.`,
  );
  console.log(`  Server: PostgreSQL ${row.version}; role: ${row.role}`);
  console.log(`  Schemas on search_path: ${row.schemas.join(", ") || "(none)"}`);
  return row;
}

async function checkSchemaObjects(
  driver: PostgresDriver,
  warnings: string[],
): Promise<boolean> {
  const bundles = loadMigrationBundles();
  const status = await inspectMigrations(driver, bundles);
  if (status.changed.length > 0) {
    throw new Error(
      `Applied migrations changed after execution: ${status.changed.join(", ")}. Add a new migration instead of editing history.`,
    );
  }
  if (status.unknown.length > 0) {
    throw new Error(`The migration ledger contains unknown versions: ${status.unknown.join(", ")}.`);
  }
  if (status.pending.length > 0) {
    warnings.push(
      `Pending migrations: ${status.pending.join(", ")}. Run npm run db:migrate.`,
    );
    return false;
  }
  console.log(`  Migrations: ${status.applied.length}/${bundles.length} applied, checksums current`);

  const tables = await driver.query<{ tablename: string; rowsecurity: boolean }>(
    `select tablename, rowsecurity
     from pg_tables
     where schemaname = 'public' and tablename = any($1::text[])`,
    [[...REQUIRED_TABLES]],
  );
  const missing = REQUIRED_TABLES.filter(
    (name) => !tables.rows.some((row) => row.tablename === name),
  );
  assert.deepEqual(missing, [], `Missing application tables: ${missing.join(", ")}.`);
  const rlsDisabled = tables.rows.filter((row) => !row.rowsecurity).map((row) => row.tablename);
  assert.deepEqual(rlsDisabled, [], `RLS is not enabled on: ${rlsDisabled.join(", ")}.`);
  console.log(`  Tables: ${tables.rows.length}/${REQUIRED_TABLES.length} present; RLS enabled on all`);

  const states = await driver.query<CountRow>("select count(*)::integer as count from states");
  if (states.rows[0]?.count !== STATES.length) {
    warnings.push(`State registry has ${states.rows[0]?.count ?? 0}/${STATES.length} rows. Run db:seed-registry.`);
  } else {
    console.log(`  States: ${STATES.length}/${STATES.length}`);
  }

  const rawAccess = await driver.query<CountRow>(
    `select count(*)::integer as count
     from pg_tables t
     where t.schemaname = 'public'
       and t.tablename = any($1::text[])
       and (
         has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'select')
         or has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'select')
       )`,
    [[...REQUIRED_TABLES]],
  );
  assert.equal(
    rawAccess.rows[0]?.count,
    0,
    "anon/authenticated still have SELECT on raw application tables.",
  );
  console.log("  RLS/privileges: raw application tables denied to anon/authenticated");

  return true;
}

async function checkApplicationData(
  driver: PostgresDriver,
  label: string,
  warnings: string[],
): Promise<void> {
  const active = await driver.query<ActiveSnapshotRow>(
    "select mode, version from dataset_snapshots where is_active order by mode",
  );
  if (active.rows.length === 0) {
    warnings.push(`${label}: no active dataset snapshot. Run npm run db:setup (demo) or publish production data.`);
    return;
  }
  if (active.rows.length > 1) {
    throw new Error(`${label}: both demo and production snapshots are active.`);
  }
  const snapshot = active.rows[0];
  assert.ok(snapshot);

  if (snapshot.mode === "demo") {
    const expected = buildDemoSnapshot();
    const counts = await driver.query<{
      events: number;
      sources: number;
      articles: number;
    }>(
      `select
         (select count(*)::integer from events where is_demo) as events,
         (select count(*)::integer from sources where is_demo) as sources,
         (select count(*)::integer from articles where is_demo) as articles`,
    );
    const row = counts.rows[0];
    assert.ok(row);
    if (
      row.events !== expected.events.length ||
      row.sources !== expected.sources.length ||
      row.articles === 0
    ) {
      warnings.push(
        `${label}: demo row counts (${row.events} events, ${row.sources} sources, ${row.articles} articles) ` +
          `do not match the checked-in snapshot (${expected.events.length} events, ${expected.sources.length} sources). ` +
          "Run npm run db:seed-demo.",
      );
    }
  } else {
    const counts = await driver.query<{
      demo_events: number;
      demo_sources: number;
      demo_articles: number;
    }>(
      `select
         (select count(*)::integer from events where is_demo) as demo_events,
         (select count(*)::integer from sources where is_demo) as demo_sources,
         (select count(*)::integer from articles where is_demo) as demo_articles`,
    );
    const row = counts.rows[0];
    assert.ok(row);
    if (row.demo_events > 0 || row.demo_sources > 0 || row.demo_articles > 0) {
      throw new Error(`${label}: production mode database contains demo rows.`);
    }
  }

  const repository = new PostgresRepository(driver, snapshot.mode);
  const data = await repository.getSnapshot();
  console.log(
    `  Runtime repository: ${data.mode}:${data.datasetVersion}; ` +
      `${data.events.length} events, ${data.sources.length} sources, ${data.states.length} states`,
  );
}

async function main(): Promise<void> {
  const admin = resolveDatabaseUrl("admin");
  if (!admin) {
    throw new Error(
      "MIGRATION_DATABASE_URL or DATABASE_URL is required. Copy .env.example to .env.local and add the Supabase session/transaction pooler strings.",
    );
  }
  const runtime = resolveDatabaseUrl("runtime");
  const warnings: string[] = [];

  if (process.env.NEXT_PUBLIC_DATABASE_URL) {
    warnings.push(
      "NEXT_PUBLIC_DATABASE_URL is set. Remove it: database credentials must never be exposed to the browser.",
    );
  }

  if (process.env.NSM_MODE === "production") {
    if (process.env.NSM_REPOSITORY !== "postgres") {
      throw new Error("NSM_MODE=production requires NSM_REPOSITORY=postgres.");
    }
  } else if (process.env.NSM_REPOSITORY && process.env.NSM_REPOSITORY !== "postgres") {
    warnings.push(
      `NSM_REPOSITORY is "${process.env.NSM_REPOSITORY}". DATABASE_URL will be configured but the app will use the in-memory demo repository.`,
    );
  }

  const adminInfo = describePostgresConnection(admin.url);
  console.log("NSM database doctor");
  console.log(`Admin (${admin.variable}): ${targetLine(adminInfo)}`);
  console.log(
    `  Pooler: ${adminInfo.pooler}; SSL: ${adminInfo.sslMode}; ` +
      `search_path: ${adminInfo.searchPath} (${adminInfo.usesStartupSearchPath ? "startup option" : "schema-qualified SQL"}); ` +
      `pool max: ${adminInfo.poolMax}`,
  );
  checkSsl(adminInfo, warnings);
  checkPooler(adminInfo, "admin", warnings);

  const adminDriver = new PostgresDriver(admin.url);
  let migrated = false;
  try {
    await readServer(adminDriver, "Admin");
    await readPostgis(adminDriver, "Admin");
    migrated = await checkSchemaObjects(adminDriver, warnings);
    if (migrated) await checkApplicationData(adminDriver, "Admin", warnings);
  } finally {
    await adminDriver.close();
  }

  if (runtime && runtime.url !== admin.url) {
    const runtimeInfo = describePostgresConnection(runtime.url);
    console.log(`Runtime (${runtime.variable}): ${targetLine(runtimeInfo)}`);
    console.log(
      `  Pooler: ${runtimeInfo.pooler}; SSL: ${runtimeInfo.sslMode}; ` +
        `search_path: ${runtimeInfo.searchPath} (${runtimeInfo.usesStartupSearchPath ? "startup option" : "schema-qualified SQL"}); ` +
        `pool max: ${runtimeInfo.poolMax}`,
    );
    checkSsl(runtimeInfo, warnings);
    checkPooler(runtimeInfo, "runtime", warnings);

    const runtimeDriver = new PostgresDriver(runtime.url);
    try {
      await readServer(runtimeDriver, "Runtime");
      await readPostgis(runtimeDriver, "Runtime");
      if (migrated) await checkApplicationData(runtimeDriver, "Runtime", warnings);
    } finally {
      await runtimeDriver.close();
    }
  } else if (runtime) {
    console.log("Runtime uses the same URL as admin.");
  }

  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  console.log(
    migrated
      ? "PASS — connection, SSL, PostGIS, migrations, RLS and repository configuration are usable."
      : "PASS (connection only) — connection, SSL and PostGIS are usable; apply migrations next.",
  );
}

main().catch((error: unknown) => {
  console.error("Database doctor failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
