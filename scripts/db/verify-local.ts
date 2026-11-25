import assert from "node:assert/strict";
import { loadMigrationBundles } from "./load-migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import {
  applyMigrations,
  inspectMigrations,
  rollbackMigrations,
} from "@/lib/data/postgres/migrations";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import { seedDemoData, seedRegistry } from "@/lib/data/postgres/seed";
import { buildDemoSnapshot } from "@/lib/demo/build";

async function main(): Promise<void> {
  const driver = await PgliteDriver.create();
  try {
    const bundles = loadMigrationBundles();
    await applyMigrations(driver, bundles);
    const appliedStatus = await inspectMigrations(driver, bundles);
    assert.equal(appliedStatus.pending.length, 0);
    assert.equal(appliedStatus.changed.length, 0);

    const seeded = await driver.transaction(async (tx) => {
      const registry = await seedRegistry(tx);
      const demo = await seedDemoData(tx, buildDemoSnapshot());
      return { ...demo, states: registry.states };
    });
    assert.equal(seeded.states, 37);
    assert.equal(seeded.sources, 8);
    assert.equal(seeded.events, 74);

    const repository = new PostgresRepository(driver, "demo");
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.mode, "demo");
    assert.equal(snapshot.states.length, 37);
    assert.equal(snapshot.events.length, 74);
    assert.equal(snapshot.sources.length, 8);
    assert.ok(snapshot.events.every((event) => event.isDemo));
    assert.ok(snapshot.sources.every((source) => source.isDemo));
    assert.ok(snapshot.events.every((event) => event.sources.length > 0));
    assert.ok(snapshot.events.some((event) => event.relatedEventIds.length > 0));
    const event = await repository.getEventById("evt-demo-001");
    assert.ok(event);
    assert.equal(event.id, "evt-demo-001");

    const rls = await driver.transaction(async (tx) => {
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
        published: published.rows[0]?.count ?? -1,
        states: states.rows[0]?.count ?? -1,
        evidence: evidence.rows[0]?.count ?? -1,
      };
    });
    assert.deepEqual(rls, { published: 0, states: 37, evidence: 0 });

    const privilege = await driver.query<{ denied: boolean }>(
      "select not has_table_privilege('anon', 'public.events', 'select') as denied",
    );
    assert.equal(privilege.rows[0]?.denied, true);

    const verificationTables = await driver.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables
       where schemaname = 'public'
         and tablename in ('event_updates', 'audit_logs')
       order by tablename`,
    );
    assert.equal(verificationTables.rows.length, 2, "Verification timeline/audit tables are missing.");
    assert.ok(
      verificationTables.rows.every((row) => row.rowsecurity),
      "Verification timeline/audit tables must have RLS enabled.",
    );

    const verificationPrivileges = await driver.query<{
      anon_updates_denied: boolean;
      authenticated_updates_denied: boolean;
      service_updates_select: boolean;
      service_updates_insert: boolean;
      anon_audit_denied: boolean;
      authenticated_audit_denied: boolean;
      service_audit_select: boolean;
      service_audit_insert: boolean;
    }>(
      `select
         not has_table_privilege('anon', 'public.event_updates', 'select') as anon_updates_denied,
         not has_table_privilege('authenticated', 'public.event_updates', 'select') as authenticated_updates_denied,
         has_table_privilege('service_role', 'public.event_updates', 'select') as service_updates_select,
         has_table_privilege('service_role', 'public.event_updates', 'insert') as service_updates_insert,
         not has_table_privilege('anon', 'public.audit_logs', 'select') as anon_audit_denied,
         not has_table_privilege('authenticated', 'public.audit_logs', 'select') as authenticated_audit_denied,
         has_table_privilege('service_role', 'public.audit_logs', 'select') as service_audit_select,
         has_table_privilege('service_role', 'public.audit_logs', 'insert') as service_audit_insert`,
    );
    assert.deepEqual(verificationPrivileges.rows[0], {
      anon_updates_denied: true,
      authenticated_updates_denied: true,
      service_updates_select: true,
      service_updates_insert: true,
      anon_audit_denied: true,
      authenticated_audit_denied: true,
      service_audit_select: true,
      service_audit_insert: true,
    });

    const reviewQueue = await driver.query<{ rowsecurity: boolean }>(
      `select rowsecurity from pg_tables
       where schemaname = 'public' and tablename = 'ingestion_candidates'`,
    );
    assert.equal(reviewQueue.rows.length, 1, "ingestion_candidates table is missing.");
    assert.equal(reviewQueue.rows[0]?.rowsecurity, true, "ingestion_candidates has RLS disabled.");

    const reviewQueuePrivileges = await driver.query<{
      anon_denied: boolean;
      authenticated_denied: boolean;
      service_allowed: boolean;
    }>(
      `select
         not has_table_privilege('anon', 'public.ingestion_candidates', 'select') as anon_denied,
         not has_table_privilege('authenticated', 'public.ingestion_candidates', 'select') as authenticated_denied,
         has_table_privilege('service_role', 'public.ingestion_candidates', 'select') as service_allowed`,
    );
    assert.deepEqual(reviewQueuePrivileges.rows[0], {
      anon_denied: true,
      authenticated_denied: true,
      service_allowed: true,
    });

    const reviewAudit = await driver.query<{ rowsecurity: boolean }>(
      `select rowsecurity from pg_tables
       where schemaname = 'public' and tablename = 'candidate_reviews'`,
    );
    assert.equal(reviewAudit.rows.length, 1, "candidate_reviews table is missing.");
    assert.equal(reviewAudit.rows[0]?.rowsecurity, true, "candidate_reviews has RLS disabled.");

    const reviewAuditPrivileges = await driver.query<{
      anon_denied: boolean;
      authenticated_denied: boolean;
      service_select: boolean;
      service_insert: boolean;
      service_update: boolean;
      service_delete: boolean;
    }>(
      `select
         not has_table_privilege('anon', 'public.candidate_reviews', 'select') as anon_denied,
         not has_table_privilege('authenticated', 'public.candidate_reviews', 'select') as authenticated_denied,
         has_table_privilege('service_role', 'public.candidate_reviews', 'select') as service_select,
         has_table_privilege('service_role', 'public.candidate_reviews', 'insert') as service_insert,
         has_table_privilege('service_role', 'public.candidate_reviews', 'update') as service_update,
         has_table_privilege('service_role', 'public.candidate_reviews', 'delete') as service_delete`,
    );
    assert.deepEqual(reviewAuditPrivileges.rows[0], {
      anon_denied: true,
      authenticated_denied: true,
      service_select: true,
      service_insert: true,
      service_update: false,
      service_delete: false,
    });

    const reviewAuditTrigger = await driver.query<{ count: number }>(
      `select count(*)::integer as count from pg_trigger
       where tgrelid = 'candidate_reviews'::regclass and not tgisinternal`,
    );
    assert.equal(reviewAuditTrigger.rows[0]?.count, 1, "candidate_reviews append-only trigger is missing.");

    const enrichments = await driver.query<{ rowsecurity: boolean }>(
      `select rowsecurity from pg_tables
       where schemaname = 'public' and tablename = 'ai_enrichments'`,
    );
    assert.equal(enrichments.rows.length, 1, "ai_enrichments table is missing.");
    assert.equal(enrichments.rows[0]?.rowsecurity, true, "ai_enrichments has RLS disabled.");

    const enrichmentPrivileges = await driver.query<{
      anon_denied: boolean;
      authenticated_denied: boolean;
      service_select: boolean;
      service_insert: boolean;
      service_update: boolean;
      service_delete: boolean;
    }>(
      `select
         not has_table_privilege('anon', 'public.ai_enrichments', 'select') as anon_denied,
         not has_table_privilege('authenticated', 'public.ai_enrichments', 'select') as authenticated_denied,
         has_table_privilege('service_role', 'public.ai_enrichments', 'select') as service_select,
         has_table_privilege('service_role', 'public.ai_enrichments', 'insert') as service_insert,
         has_table_privilege('service_role', 'public.ai_enrichments', 'update') as service_update,
         has_table_privilege('service_role', 'public.ai_enrichments', 'delete') as service_delete`,
    );
    assert.deepEqual(enrichmentPrivileges.rows[0], {
      anon_denied: true,
      authenticated_denied: true,
      service_select: true,
      service_insert: true,
      service_update: false,
      service_delete: false,
    });

    const enrichmentTrigger = await driver.query<{ count: number }>(
      `select count(*)::integer as count from pg_trigger
       where tgrelid = 'ai_enrichments'::regclass and not tgisinternal`,
    );
    assert.equal(enrichmentTrigger.rows[0]?.count, 1, "ai_enrichments append-only trigger is missing.");

    const publicationTables = await driver.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables
       where schemaname = 'public'
         and tablename in ('candidate_event_links', 'scheduler_locks', 'event_clusters')
       order by tablename`,
    );
    assert.equal(publicationTables.rows.length, 3, "Publication/scheduler tables are missing.");
    assert.ok(
      publicationTables.rows.every((row) => row.rowsecurity),
      "Publication/scheduler tables must have RLS enabled.",
    );

    const publicationPrivileges = await driver.query<{
      anon_links_denied: boolean;
      authenticated_links_denied: boolean;
      service_links_select: boolean;
      service_links_insert: boolean;
      service_links_update: boolean;
      service_links_delete: boolean;
      anon_locks_denied: boolean;
      authenticated_locks_denied: boolean;
      service_locks_select: boolean;
      service_locks_insert: boolean;
      service_locks_update: boolean;
      service_locks_delete: boolean;
      service_clusters_select: boolean;
      service_clusters_update: boolean;
      service_clusters_delete: boolean;
    }>(
      `select
         not has_table_privilege('anon', 'public.candidate_event_links', 'select') as anon_links_denied,
         not has_table_privilege('authenticated', 'public.candidate_event_links', 'select') as authenticated_links_denied,
         has_table_privilege('service_role', 'public.candidate_event_links', 'select') as service_links_select,
         has_table_privilege('service_role', 'public.candidate_event_links', 'insert') as service_links_insert,
         has_table_privilege('service_role', 'public.candidate_event_links', 'update') as service_links_update,
         has_table_privilege('service_role', 'public.candidate_event_links', 'delete') as service_links_delete,
         not has_table_privilege('anon', 'public.scheduler_locks', 'select') as anon_locks_denied,
         not has_table_privilege('authenticated', 'public.scheduler_locks', 'select') as authenticated_locks_denied,
         has_table_privilege('service_role', 'public.scheduler_locks', 'select') as service_locks_select,
         has_table_privilege('service_role', 'public.scheduler_locks', 'insert') as service_locks_insert,
         has_table_privilege('service_role', 'public.scheduler_locks', 'update') as service_locks_update,
         has_table_privilege('service_role', 'public.scheduler_locks', 'delete') as service_locks_delete,
         has_table_privilege('service_role', 'public.event_clusters', 'select') as service_clusters_select,
         has_table_privilege('service_role', 'public.event_clusters', 'update') as service_clusters_update,
         has_table_privilege('service_role', 'public.event_clusters', 'delete') as service_clusters_delete`,
    );
    assert.deepEqual(publicationPrivileges.rows[0], {
      anon_links_denied: true,
      authenticated_links_denied: true,
      service_links_select: true,
      service_links_insert: true,
      service_links_update: false,
      service_links_delete: false,
      anon_locks_denied: true,
      authenticated_locks_denied: true,
      service_locks_select: true,
      service_locks_insert: true,
      service_locks_update: true,
      service_locks_delete: true,
      service_clusters_select: true,
      service_clusters_update: true,
      service_clusters_delete: false,
    });

    const appendOnlyTriggers = await driver.query<{ table_name: string; count: number }>(
      `select c.relname as table_name, count(*)::integer as count
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal
         and c.relname in ('candidate_event_links', 'event_updates', 'audit_logs')
       group by c.relname
       order by c.relname`,
    );
    assert.deepEqual(
      appendOnlyTriggers.rows,
      [
        { table_name: "audit_logs", count: 1 },
        { table_name: "candidate_event_links", count: 1 },
        { table_name: "event_updates", count: 1 },
      ],
      "Append-only triggers are missing.",
    );

    const clusterColumns = await driver.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'event_clusters'
         and column_name in ('reviewed_at', 'reasons', 'score_components', 'rule_version')
       order by column_name`,
    );
    assert.deepEqual(
      clusterColumns.rows.map((row) => row.column_name),
      ["reasons", "reviewed_at", "rule_version", "score_components"],
      "Cluster review columns are missing.",
    );

    const updateAppendOnly = await driver.query<{ updates_denied: boolean; deletes_denied: boolean }>(
      `select
         not has_table_privilege('service_role', 'public.event_updates', 'update') as updates_denied,
         not has_table_privilege('service_role', 'public.event_updates', 'delete') as deletes_denied`,
    );
    assert.deepEqual(updateAppendOnly.rows[0], { updates_denied: true, deletes_denied: true });

    let productionRefused = false;
    try {
      await new PostgresRepository(driver, "production").getSnapshot();
    } catch {
      productionRefused = true;
    }
    assert.equal(productionRefused, true);

    const postgis = await driver.query<{ version: string }>(
      "select extensions.postgis_version() as version",
    );
    const version = postgis.rows[0]?.version ?? "unavailable";

    await rollbackMigrations(driver, bundles, { all: true });
    const rolledBackStatus = await inspectMigrations(driver, bundles);
    assert.equal(rolledBackStatus.pending.length, bundles.length);
    assert.equal(rolledBackStatus.applied.length, 0);
    const remaining = await driver.query<{ count: number }>(
      `select count(*)::integer as count from pg_tables
       where schemaname = 'public' and tablename <> '_nsm_migrations'`,
    );
    assert.equal(remaining.rows[0]?.count, 0);

    console.log("PASS — local PostGIS migration, seed, repository and RLS verification");
    console.log(`PostGIS ${version}`);
    console.log("37 states, 8 demo sources, 74 demo events");
    console.log("Ingestion review queue: RLS enabled; anon/authenticated denied");
    console.log("Reviewer audit: RLS enabled; append-only; anon/authenticated denied");
    console.log("AI enrichment proposals: RLS enabled; append-only; anon/authenticated denied");
    console.log("Verification timeline and audit: RLS enabled; anon/authenticated denied");
    console.log("Publication links and scheduler lease: RLS enabled; append-only; anon/authenticated denied");
    console.log("Anonymous published view: 0 demo events exposed; raw event table denied");
    console.log("All migrations rolled back; application tables removed");
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Local database verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
