import assert from "node:assert/strict";
import { describePostgresConnection } from "@/lib/data/postgres/client";
import { inspectMigrations } from "@/lib/data/postgres/migrations";
import { buildDemoSnapshot } from "@/lib/demo/build";
import { STATES } from "@/lib/geo/states";
import { openDriver, requireDatabaseUrl, resolveDatabaseUrl } from "./connection";
import { loadMigrationBundles } from "./load-migrations";

type Expectation = "auto" | "demo" | "registry" | "production";

interface CountRow {
  count: number;
}

interface SnapshotRow {
  mode: "demo" | "production";
  version: string;
}

interface SnapshotCountsRow {
  demo_snapshots: number;
  production_snapshots: number;
  demo_events: number;
  production_events: number;
  demo_sources: number;
  production_sources: number;
  demo_articles: number;
  production_articles: number;
}

interface TableRow {
  tablename: string;
  rowsecurity: boolean;
}

interface PostgisRow {
  version: string;
  schema: string;
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
  "ingestion_candidates",
  "candidate_reviews",
  "ai_enrichments",
  "economic_indicators",
  "economic_observations",
  "audit_logs",
] as const;

function parseExpectation(): Expectation {
  const argument = process.argv.find((value) => value.startsWith("--expect="));
  if (!argument) return "auto";
  const value = argument.slice("--expect=".length);
  if (value === "auto" || value === "demo" || value === "registry" || value === "production") {
    return value;
  }
  throw new Error("--expect must be one of auto, demo, registry or production.");
}

async function main(): Promise<void> {
  const requestedExpectation = parseExpectation();
  const resolved = resolveDatabaseUrl("admin");
  if (!resolved) requireDatabaseUrl("admin");
  assert.ok(resolved);

  const info = describePostgresConnection(resolved.url);
  console.log(`Connection variable: ${resolved.variable}`);
  console.log(`Target: ${info.user}@${info.host}:${info.port}/${info.database}`);
  console.log(
    `Mode: ${info.pooler} pooler; SSL: ${info.sslMode}; ` +
      `search_path: ${info.searchPath} (${info.usesStartupSearchPath ? "startup option" : "schema-qualified SQL"}); ` +
      `pool max: ${info.poolMax}`,
  );
  if (info.pooler === "transaction") {
    console.warn(
      "Warning: admin verification is using a transaction pooler. Use MIGRATION_DATABASE_URL with the session or direct URL for migrations.",
    );
  }

  const driver = openDriver("admin");
  try {
    const server = await driver.query<{
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
    const serverRow = server.rows[0];
    assert.ok(serverRow, "Unable to read the database server identity.");
    assert.ok(
      serverRow.role !== "anon" && serverRow.role !== "authenticated",
      `The verification connection is ${serverRow.role}; use the postgres/admin connection string.`,
    );
    console.log(`Server: PostgreSQL ${serverRow.version}; role: ${serverRow.role}`);

    const postgis = await driver.query<PostgisRow>(
      `select e.extversion as version, n.nspname as schema
       from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
       where e.extname = 'postgis'`,
    );
    const postgisRow = postgis.rows[0];
    assert.ok(
      postgisRow,
      "PostGIS is not installed. Enable it with: create extension postgis with schema extensions;",
    );
    assert.equal(
      postgisRow.schema,
      "extensions",
      `PostGIS is installed in schema "${postgisRow.schema}", but NSM requires "extensions".`,
    );
    const qualified = await driver.query<{ version: string }>(
      "select extensions.postgis_version() as version",
    );
    console.log(`PostGIS: ${qualified.rows[0]?.version ?? postgisRow.version} in schema extensions`);

    const bundles = loadMigrationBundles();
    const migrations = await inspectMigrations(driver, bundles);
    if (migrations.pending.length > 0) {
      throw new Error(
        `Pending migrations: ${migrations.pending.join(", ")}. Run npm run db:migrate.`,
      );
    }
    if (migrations.changed.length > 0) {
      throw new Error(
        `Applied migrations changed after execution: ${migrations.changed.join(", ")}. Add a new migration instead of editing history.`,
      );
    }
    if (migrations.unknown.length > 0) {
      throw new Error(
        `The ledger contains unknown migration versions: ${migrations.unknown.join(", ")}.`,
      );
    }
    assert.equal(migrations.applied.length, bundles.length);
    console.log(`Migrations: ${migrations.applied.length}/${bundles.length} applied, checksums current`);

    const tables = await driver.query<TableRow>(
      `select tablename, rowsecurity
       from pg_tables
       where schemaname = 'public' and tablename = any($1::text[])`,
      [[...REQUIRED_TABLES]],
    );
    const missingTables = REQUIRED_TABLES.filter(
      (name) => !tables.rows.some((row) => row.tablename === name),
    );
    assert.deepEqual(missingTables, [], `Missing application tables: ${missingTables.join(", ")}`);
    const rlsDisabled = tables.rows.filter((row) => !row.rowsecurity).map((row) => row.tablename);
    assert.deepEqual(rlsDisabled, [], `Row-level security is not enabled on: ${rlsDisabled.join(", ")}`);
    console.log(`Tables: ${tables.rows.length}/${REQUIRED_TABLES.length} present; RLS enabled on all`);

    const roles = await driver.query<{ rolname: string }>(
      "select rolname from pg_roles where rolname = any($1::text[]) order by rolname",
      [["anon", "authenticated", "service_role"]],
    );
    assert.equal(roles.rows.length, 3, "The anon, authenticated and service_role roles are required.");

    const states = await driver.query<CountRow>("select count(*)::integer as count from states");
    assert.equal(states.rows[0]?.count, STATES.length, "State registry is incomplete. Run db:seed-registry.");
    console.log(`States: ${states.rows[0]?.count}/${STATES.length}`);

    const snapshots = await driver.query<SnapshotRow>(
      "select mode, version from dataset_snapshots where is_active order by mode",
    );
    const snapshotCounts = await driver.query<SnapshotCountsRow>(
      `select
         (select count(*)::integer from dataset_snapshots where mode = 'demo') as demo_snapshots,
         (select count(*)::integer from dataset_snapshots where mode = 'production') as production_snapshots,
         (select count(*)::integer from events where is_demo) as demo_events,
         (select count(*)::integer from events where not is_demo) as production_events,
         (select count(*)::integer from sources where is_demo) as demo_sources,
         (select count(*)::integer from sources where not is_demo) as production_sources,
         (select count(*)::integer from articles where is_demo) as demo_articles,
         (select count(*)::integer from articles where not is_demo) as production_articles`,
    );
    const counts = snapshotCounts.rows[0];
    assert.ok(counts, "Unable to count dataset rows.");

    let expectation: Exclude<Expectation, "auto">;
    if (requestedExpectation === "auto") {
      if (snapshots.rows.length === 0) {
        expectation = "registry";
      } else if (snapshots.rows.length === 1) {
        expectation = snapshots.rows[0]?.mode === "demo" ? "demo" : "production";
      } else {
        throw new Error("Both demo and production snapshots are active. Keep one active snapshot per mode.");
      }
    } else {
      expectation = requestedExpectation;
    }

    if (expectation === "demo") {
      const expected = buildDemoSnapshot();
      assert.deepEqual(
        snapshots.rows.map((row) => row.mode),
        ["demo"],
        "Expected exactly one active demo snapshot.",
      );
      assert.equal(counts.production_snapshots, 0, "A demo database must not contain production snapshots.");
      assert.equal(counts.demo_events, expected.events.length, "Demo event count does not match the checked-in snapshot.");
      assert.equal(counts.demo_sources, expected.sources.length, "Demo source count does not match the checked-in snapshot.");
      assert.ok(counts.demo_articles > 0, "Demo evidence rows are missing.");
      assert.equal(counts.production_events, 0, "Demo database contains production events.");
      assert.equal(counts.production_sources, 0, "Demo database contains production sources.");
      assert.equal(counts.production_articles, 0, "Demo database contains production articles.");
    } else if (expectation === "production") {
      assert.deepEqual(
        snapshots.rows.map((row) => row.mode),
        ["production"],
        "Expected exactly one active production snapshot.",
      );
      assert.equal(counts.demo_snapshots, 0, "Production database contains demo snapshots.");
      assert.equal(counts.demo_events, 0, "Production database contains demo events.");
      assert.equal(counts.demo_sources, 0, "Production database contains demo sources.");
      assert.equal(counts.demo_articles, 0, "Production database contains demo articles.");
    } else {
      assert.equal(snapshots.rows.length, 0, "Registry-only setup must not have an active dataset snapshot.");
      assert.equal(counts.demo_snapshots, 0, "Registry-only setup contains demo snapshots.");
      assert.equal(counts.production_snapshots, 0, "Registry-only setup contains production snapshots.");
      assert.equal(counts.demo_events, 0, "Registry-only setup contains demo events.");
      assert.equal(counts.production_events, 0, "Registry-only setup contains production events.");
      assert.equal(counts.demo_articles, 0, "Registry-only setup contains demo articles.");
      assert.equal(counts.production_articles, 0, "Registry-only setup contains production articles.");
    }

    console.log(
      `Snapshots: ${
        snapshots.rows.map((row) => `${row.mode}:${row.version} (active)`).join(", ") || "none"
      }`,
    );
    console.log(
      `Rows: ${counts.demo_events} demo / ${counts.production_events} production events; ` +
        `${counts.demo_sources} demo / ${counts.production_sources} production sources`,
    );

    const publicCounts = await driver.transaction(async (tx) => {
      await tx.exec("set local role anon");
      const published = await tx.query<CountRow>(
        "select count(*)::integer as count from published_events",
      );
      const publicStates = await tx.query<CountRow>(
        "select count(*)::integer as count from public_states",
      );
      const evidence = await tx.query<CountRow>(
        "select count(*)::integer as count from published_event_sources",
      );
      return {
        published: published.rows[0]?.count ?? -1,
        states: publicStates.rows[0]?.count ?? -1,
        evidence: evidence.rows[0]?.count ?? -1,
      };
    });
    assert.equal(publicCounts.states, STATES.length, "Anonymous public_states view is incomplete.");

    if (expectation === "demo" || expectation === "registry") {
      assert.equal(publicCounts.published, 0, "Anonymous users can see demo or unpublished events.");
      assert.equal(publicCounts.evidence, 0, "Anonymous users can see demo or unpublished evidence.");
    } else {
      const expectedPublished = await driver.query<CountRow>(
        "select count(*)::integer as count from events where published = true and is_demo = false",
      );
      assert.equal(
        publicCounts.published,
        expectedPublished.rows[0]?.count ?? -1,
        "Anonymous published_events view does not match published production events.",
      );
      const expectedEvidence = await driver.query<CountRow>(
        `select count(*)::integer as count
         from event_sources es
         join events e on e.id = es.event_id
         join articles a on a.id = es.article_id
         join sources s on s.id = a.source_id
         where e.published = true
           and e.is_demo = false
           and a.is_demo = false
           and s.is_demo = false`,
      );
      assert.equal(
        publicCounts.evidence,
        expectedEvidence.rows[0]?.count ?? -1,
        "Anonymous published_event_sources view does not match production evidence.",
      );
    }
    console.log(
      `Anonymous views: ${publicCounts.published} published events, ${publicCounts.states} states, ` +
        `${publicCounts.evidence} evidence rows`,
    );

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
    assert.equal(rawAccess.rows[0]?.count, 0, "anon/authenticated still have SELECT on raw application tables.");

    const ledgerAccess = await driver.query<{ denied: boolean }>(
      `select not has_table_privilege('anon', 'public._nsm_migrations', 'select')
          and not has_table_privilege('authenticated', 'public._nsm_migrations', 'select') as denied`,
    );
    assert.equal(ledgerAccess.rows[0]?.denied, true, "anon/authenticated can read the migration ledger.");

    const serviceAccess = await driver.query<{ allowed: boolean | null }>(
      `select bool_and(has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'select')) as allowed
       from pg_tables
       where schemaname = 'public' and tablename = any($1::text[])`,
      [[...REQUIRED_TABLES]],
    );
    assert.equal(serviceAccess.rows[0]?.allowed, true, "service_role is missing SELECT on application tables.");

    console.log(`Expectation: ${expectation} — all checks passed`);
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Database verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
