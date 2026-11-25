// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { seedDemoData, seedRegistry } from "@/lib/data/postgres/seed";
import { PostgresVerificationStore } from "@/lib/data/postgres/verification";
import { buildDemoSnapshot } from "@/lib/demo/build";

vi.setConfig({ testTimeout: 90_000 });

interface Counts {
  events: number;
  updates: number;
  audits: number;
  published: number;
}

async function counts(driver: PgliteDriver): Promise<Counts> {
  const result = await driver.query<Counts>(
    `select
       (select count(*)::integer from events) as events,
       (select count(*)::integer from event_updates) as updates,
       (select count(*)::integer from audit_logs) as audits,
       (select count(*)::integer from published_events) as published`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("Count query returned no row.");
  return row;
}

interface EventState {
  verification_status: string;
  published: boolean;
  confidence: string;
  updated_at: string;
}

async function eventState(
  driver: PgliteDriver,
  publicId: string,
): Promise<EventState> {
  const result = await driver.query<EventState>(
    `select verification_status, published, confidence::text as confidence,
            updated_at::text as updated_at
     from events where public_id = $1`,
    [publicId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Missing event ${publicId}.`);
  return row;
}

describe.sequential("verification transitions", () => {
  let driver: PgliteDriver;
  let store: PostgresVerificationStore;

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, loadMigrationBundles());
    await driver.transaction(async (tx) => {
      await seedRegistry(tx);
      await seedDemoData(tx, buildDemoSnapshot());
    });
    store = new PostgresVerificationStore(driver);
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  }, 30_000);

  it("applies a reviewer-approved transition without creating or publishing an event", async () => {
    const beforeCounts = await counts(driver);
    const before = await eventState(driver, "evt-demo-009");
    expect(before.verification_status).toBe("unassessed");

    const result = await store.transition({
      eventPublicId: "evt-demo-009",
      target: "single_source",
      reviewerId: "Reviewer-01",
      rationale: "One independent demo source group supports this record.",
    });
    if (!result.ok) throw new Error(result.message);

    expect(result.transition).toMatchObject({
      eventPublicId: "evt-demo-009",
      previousStatus: "unassessed",
      status: "single_source",
      reviewerId: "reviewer-01",
    });
    expect(result.updateId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.auditId).toMatch(/^\d+$/);

    const after = await eventState(driver, "evt-demo-009");
    expect(after.verification_status).toBe("single_source");
    expect(after.published).toBe(before.published);
    expect(after.confidence).toBe(before.confidence);

    const afterCounts = await counts(driver);
    expect(afterCounts.events).toBe(beforeCounts.events);
    expect(afterCounts.updates).toBe(beforeCounts.updates + 1);
    expect(afterCounts.audits).toBe(beforeCounts.audits + 1);
    expect(afterCounts.published).toBe(0);

    const update = await driver.query<{
      update_type: string;
      description: string;
      actor: string;
      source_id: string | null;
      article_id: string | null;
    }>(
      `select update_type, description, actor, source_id, article_id
       from event_updates where id = $1`,
      [result.updateId],
    );
    expect(update.rows[0]).toEqual({
      update_type: "verification_change",
      description:
        "Verification status changed from unassessed to single_source: 1 independent source group.",
      actor: "reviewer",
      source_id: null,
      article_id: null,
    });

    const audit = await driver.query<{
      actor_id: string | null;
      actor_type: string;
      action: string;
      entity_type: string;
      entity_id: string;
      before_status: string;
      after_status: string;
      reviewer_id: string;
      rationale: string;
      update_public_id: string;
    }>(
      `select
         actor_id, actor_type, action, entity_type, entity_id,
         before->>'verification_status' as before_status,
         after->>'verification_status' as after_status,
         after->>'reviewer_id' as reviewer_id,
         after->>'rationale' as rationale,
         after->>'event_update_public_id' as update_public_id
       from audit_logs
       where id = $1`,
      [result.auditId],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_id: null,
      actor_type: "user",
      action: "verification_transition",
      entity_type: "event",
      entity_id: "evt-demo-009",
      before_status: "unassessed",
      after_status: "single_source",
      reviewer_id: "reviewer-01",
      rationale: "One independent demo source group supports this record.",
    });
    expect(audit.rows[0]?.update_public_id).toMatch(/^nsm-verification-/);
  });

  it("refuses a repeated transition and insufficient evidence without writing rows", async () => {
    const before = await counts(driver);

    const repeated = await store.transition({
      eventPublicId: "evt-demo-009",
      target: "single_source",
      reviewerId: "reviewer-01",
      rationale: "Trying the same transition again.",
    });
    expect(repeated).toMatchObject({ ok: false, code: "no_change" });

    const insufficient = await store.transition({
      eventPublicId: "evt-demo-009",
      target: "multiple_sources",
      reviewerId: "reviewer-01",
      rationale: "There is only one independent source group.",
    });
    expect(insufficient).toMatchObject({ ok: false, code: "insufficient_evidence" });

    const after = await counts(driver);
    expect(after).toEqual(before);
  });

  it("rejects invalid reviewers and rationales before any database write", async () => {
    const before = await counts(driver);

    expect(
      await store.transition({
        eventPublicId: "evt-demo-009",
        target: "multiple_sources",
        reviewerId: "x",
        rationale: "A sufficiently long rationale.",
      }),
    ).toMatchObject({ ok: false, code: "invalid_reviewer" });

    expect(
      await store.transition({
        eventPublicId: "evt-demo-009",
        target: "multiple_sources",
        reviewerId: "reviewer-01",
        rationale: "short",
      }),
    ).toMatchObject({ ok: false, code: "invalid_rationale" });

    expect(
      await store.transition({
        eventPublicId: "missing-event",
        target: "single_source",
        reviewerId: "reviewer-01",
        rationale: "No event should be created for an unknown ID.",
      }),
    ).toMatchObject({ ok: false, code: "not_found" });

    expect(await counts(driver)).toEqual(before);
  });

  it("corroborates only with explicit approval and two independent groups", async () => {
    const result = await store.transition({
      eventPublicId: "evt-demo-001",
      target: "corroborated",
      reviewerId: "reviewer-02",
      rationale: "Two independent demo groups agree on the material details.",
      approveCorroboration: true,
    });
    if (!result.ok) throw new Error(result.message);

    expect(result.transition).toMatchObject({
      previousStatus: "multiple_sources",
      status: "corroborated",
      reviewerId: "reviewer-02",
    });
    const state = await eventState(driver, "evt-demo-001");
    expect(state.verification_status).toBe("corroborated");
  });

  it("keeps retraction terminal and requires retraction evidence", async () => {
    const withoutEvidence = await store.transition({
      eventPublicId: "evt-demo-001",
      target: "retracted",
      reviewerId: "reviewer-03",
      rationale: "The reports are disputed but no retraction is recorded.",
    });
    expect(withoutEvidence).toMatchObject({ ok: false, code: "insufficient_evidence" });

    // Test fixture setup: expose the retraction-bearing demo event to the
    // transition path. This does not publish anything.
    await driver.query(
      "update events set verification_status = 'multiple_sources' where public_id = 'evt-demo-024'",
    );

    const retracted = await store.transition({
      eventPublicId: "evt-demo-024",
      target: "retracted",
      reviewerId: "reviewer-03",
      rationale: "The originating demo source retracted its report.",
    });
    if (!retracted.ok) throw new Error(retracted.message);
    expect(retracted.transition.status).toBe("retracted");

    const terminal = await store.transition({
      eventPublicId: "evt-demo-024",
      target: "disputed",
      reviewerId: "reviewer-03",
      rationale: "Retraction should prevent any later status change.",
    });
    expect(terminal).toMatchObject({ ok: false, code: "terminal_retracted" });
  });

  it("keeps verification evidence server-only", async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select count(*) from event_updates");
      }),
    ).rejects.toThrow();

    await expect(
      driver.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select count(*) from audit_logs");
      }),
    ).rejects.toThrow();

    const privileges = await driver.query<{
      anon_updates_denied: boolean;
      authenticated_audit_denied: boolean;
      service_updates_select: boolean;
      service_updates_insert: boolean;
      service_audit_insert: boolean;
    }>(
      `select
         not has_table_privilege('anon', 'public.event_updates', 'select') as anon_updates_denied,
         not has_table_privilege('authenticated', 'public.audit_logs', 'select') as authenticated_audit_denied,
         has_table_privilege('service_role', 'public.event_updates', 'select') as service_updates_select,
         has_table_privilege('service_role', 'public.event_updates', 'insert') as service_updates_insert,
         has_table_privilege('service_role', 'public.audit_logs', 'insert') as service_audit_insert`,
    );
    expect(privileges.rows[0]).toEqual({
      anon_updates_denied: true,
      authenticated_audit_denied: true,
      service_updates_select: true,
      service_updates_insert: true,
      service_audit_insert: true,
    });
  });
});
