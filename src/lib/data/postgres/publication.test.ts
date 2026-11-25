// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { PostgresPublicationStore } from "@/lib/data/postgres/publication";
import { PostgresReviewStore } from "@/lib/data/postgres/review";
import { seedRegistry } from "@/lib/data/postgres/seed";
import { collectFeed } from "@/lib/ingestion/collect";
import { parseRssFeed } from "@/lib/ingestion/rss";
import { PREMIUM_TIMES } from "@/lib/ingestion/sources";
import type { FeedCollection } from "@/lib/ingestion/types";

const NOW = new Date("2026-11-07T09:00:00.000Z");

vi.setConfig({ testTimeout: 90_000 });

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Publication Test Feed</title>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student]]></title>
    <link>https://www.premiumtimesng.com/news/more-news/940001-a.html</link>
    <description><![CDATA[<p>Security sources said the student was later freed.</p>]]></description>
    <pubDate>Sat, 07 Nov 2026 06:00:00 +0000</pubDate>
    <category><![CDATA[Plateau State]]></category>
    <guid isPermaLink="false">940001</guid>
  </item>
  <item>
    <title><![CDATA[Inflation rises in Kano]]></title>
    <link>https://www.premiumtimesng.com/business/940002-b.html</link>
    <description><![CDATA[<p>The naira weakened as fuel prices increased.</p>]]></description>
    <pubDate>Sat, 07 Nov 2026 05:00:00 +0000</pubDate>
    <category><![CDATA[Kano]]></category>
    <category><![CDATA[Inflation]]></category>
    <guid isPermaLink="false">940002</guid>
  </item>
</channel></rss>`;

function buildCollection(): FeedCollection {
  return collectFeed(
    parseRssFeed(XML, 40),
    PREMIUM_TIMES,
    {
      fetchedAt: NOW.toISOString(),
      httpStatus: 200,
      contentType: "application/rss+xml",
      feedHash: "d".repeat(64),
    },
    { now: NOW },
  );
}

interface CandidateRow {
  public_id: string;
  title: string;
  status: string;
  category: string | null;
  state_id: string | null;
}

describe.sequential("candidate publication", () => {
  let driver: PgliteDriver;
  let publication: PostgresPublicationStore;
  let plateau: CandidateRow;
  let kano: CandidateRow;

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, loadMigrationBundles());
    await driver.transaction((tx) => seedRegistry(tx));

    const ingestion = new PostgresIngestionStore(driver);
    const persisted = await ingestion.persistCollection({
      collection: buildCollection(),
      runId: "00000000-0000-4000-8000-000000000301",
      startedAt: NOW,
      finishedAt: new Date(NOW.getTime() + 500),
    });
    expect(persisted).toMatchObject({
      fetched: 2,
      accepted: 2,
      candidatesInserted: 2,
    });

    const rows = await driver.query<CandidateRow>(
      `select c.public_id, a.original_title as title, c.status, c.category, c.state_id
       from ingestion_candidates c
       join articles a on a.id = c.article_id`,
    );
    plateau = rows.rows.find((row) => row.title === "Gunmen abduct Plateau varsity student")!;
    kano = rows.rows.find((row) => row.title === "Inflation rises in Kano")!;
    expect(plateau).toMatchObject({ status: "pending", category: "security", state_id: "NG-PL" });
    expect(kano).toMatchObject({ status: "pending", category: "economy", state_id: "NG-KN" });

    const review = new PostgresReviewStore(driver);
    const accepted = await review.decide({
      candidatePublicId: plateau.public_id,
      action: "accept",
      reviewerId: "duty.editor",
      notes: "Headline and excerpt agree with the proposed category and state.",
    });
    if (!accepted.ok) throw new Error(accepted.message);

    publication = new PostgresPublicationStore(driver);
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  }, 30_000);

  it("lists only accepted candidates with no event outcome", async () => {
    const publishable = await publication.listPublishable();
    expect(publishable).toHaveLength(1);
    expect(publishable[0]).toMatchObject({
      publicId: plateau.public_id,
      status: "accepted",
      category: "security",
      stateId: "NG-PL",
      stateName: "Plateau",
      sourceSlug: "premium-times",
      sourceName: "Premium Times",
      reviewedBy: "duty.editor",
    });
    expect(publishable[0]?.title).toBe("Gunmen abduct Plateau varsity student");
    expect(publishable[0]?.excerpt).toContain("later freed");
  });

  it("refuses pending candidates and invalid reviewer input", async () => {
    const pending = await publication.publish({
      candidatePublicId: kano.public_id,
      reviewerId: "duty.editor",
      severity: 3,
      severityRationale: "Reported inflation with a market impact.",
    });
    expect(pending).toMatchObject({ ok: false, code: "not_accepted" });

    const invalidSeverity = await publication.publish({
      candidatePublicId: plateau.public_id,
      reviewerId: "duty.editor",
      severity: 7,
      severityRationale: "Reported abduction with a confirmed police response.",
    });
    expect(invalidSeverity).toMatchObject({ ok: false, code: "invalid_severity" });

    const invalidRationale = await publication.publish({
      candidatePublicId: plateau.public_id,
      reviewerId: "duty.editor",
      severity: 3,
      severityRationale: "short",
    });
    expect(invalidRationale).toMatchObject({ ok: false, code: "invalid_rationale" });

    const counts = await driver.query<{ events: number; snapshots: number }>(
      `select
         (select count(*)::integer from events) as events,
         (select count(*)::integer from dataset_snapshots where mode = 'production') as snapshots`,
    );
    expect(counts.rows[0]).toEqual({ events: 0, snapshots: 0 });
  });

  it("publishes one production event with evidence, audit and snapshot", async () => {
    const result = await publication.publish({
      candidatePublicId: plateau.public_id,
      reviewerId: "Duty.Editor",
      severity: 4,
      severityRationale: "Armed abduction with a reported security response and public impact.",
    });
    if (!result.ok) throw new Error(result.message);

    expect(result.event).toMatchObject({
      title: "Gunmen abduct Plateau varsity student",
      category: "security",
      stateId: "NG-PL",
      severity: 4,
      verificationStatus: "unassessed",
    });
    expect(result.event.eventPublicId).toMatch(/^evt-/);
    expect(result.event.eventSlug).toMatch(/^event-/);
    expect(result.linkId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.snapshotVersion).toMatch(/^production-/);

    const event = await driver.query<{
      title: string;
      summary: string;
      severity: number;
      severity_rationale: string;
      state_id: string;
      lga: string | null;
      geo_precision: string;
      confidence: unknown;
      verification_status: string;
      analysis_kind: string;
      published: boolean;
      is_demo: boolean;
      uncertainties: unknown;
      category: string;
    }>(
      `select title, summary, severity, severity_rationale, state_id, lga,
              geo_precision, confidence, verification_status, analysis_kind,
              published, is_demo, uncertainties, category
       from events where public_id = $1`,
      [result.event.eventPublicId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]).toMatchObject({
      title: "Gunmen abduct Plateau varsity student",
      // By default no publisher text is stored in the event: the summary is the headline (see publication/excerpt.ts).
      summary: "Gunmen abduct Plateau varsity student",
      severity: 4,
      severity_rationale: "Armed abduction with a reported security response and public impact.",
      state_id: "NG-PL",
      lga: null,
      geo_precision: "state",
      verification_status: "unassessed",
      analysis_kind: "none",
      published: true,
      is_demo: false,
      category: "security",
    });
    expect(Number(event.rows[0]?.confidence)).toBe(0);
    expect(JSON.stringify(event.rows[0]?.uncertainties)).toContain("state-level centroid");
    expect(JSON.stringify(event.rows[0]?.uncertainties)).toContain("not been assessed");

    const sources = await driver.query<{
      relationship: string;
      independence_group: string;
      original_title: string;
    }>(
      `select es.relationship, es.independence_group, a.original_title
       from event_sources es join articles a on a.id = es.article_id
       where es.event_id = (select id from events where public_id = $1)`,
      [result.event.eventPublicId],
    );
    expect(sources.rows).toEqual([
      {
        relationship: "primary",
        independence_group: "premium-times",
        original_title: "Gunmen abduct Plateau varsity student",
      },
    ]);

    const link = await driver.query<{
      link_type: string;
      reviewer_id: string;
      severity: number;
      severity_rationale: string;
    }>(
      `select link_type, reviewer_id, severity, severity_rationale
       from candidate_event_links
       where candidate_id = (select id from ingestion_candidates where public_id = $1)`,
      [plateau.public_id],
    );
    expect(link.rows).toEqual([
      {
        link_type: "published",
        reviewer_id: "duty.editor",
        severity: 4,
        severity_rationale: "Armed abduction with a reported security response and public impact.",
      },
    ]);

    const updates = await driver.query<{ update_type: string; actor: string }>(
      `select update_type, actor from event_updates
       where event_id = (select id from events where public_id = $1)`,
      [result.event.eventPublicId],
    );
    expect(updates.rows).toEqual([{ update_type: "new_report", actor: "reviewer" }]);

    const audit = await driver.query<{
      action: string;
      reviewer_id: string;
      severity: string;
      candidate_public_id: string;
      actor_type: string;
    }>(
      `select action, after->>'reviewer_id' as reviewer_id,
              after->>'severity' as severity,
              after->>'candidate_public_id' as candidate_public_id,
              actor_type
       from audit_logs where action = 'event_publish'`,
    );
    expect(audit.rows).toEqual([
      {
        action: "event_publish",
        reviewer_id: "duty.editor",
        severity: "4",
        candidate_public_id: plateau.public_id,
        actor_type: "user",
      },
    ]);

    const snapshots = await driver.query<{
      mode: string;
      is_active: boolean;
      version: string;
      coverage_basis: string;
    }>(
      `select mode, is_active, version, coverage_basis from dataset_snapshots
       where mode = 'production'`,
    );
    expect(snapshots.rows).toEqual([
      {
        mode: "production",
        is_active: true,
        version: result.snapshotVersion,
        coverage_basis: "live_ingestion",
      },
    ]);

    const remaining = await publication.listPublishable();
    expect(remaining).toHaveLength(0);

    const repeated = await publication.publish({
      candidatePublicId: plateau.public_id,
      reviewerId: "duty.editor",
      severity: 4,
      severityRationale: "Armed abduction with a reported security response and public impact.",
    });
    expect(repeated).toMatchObject({ ok: false, code: "already_linked" });
  });

  it("exposes only the published production event through the public view", async () => {
    const anonymous = await driver.transaction(async (tx) => {
      await tx.exec("set local role anon");
      return tx.query<{ public_id: string; article_count: number; independent_source_count: number }>(
        "select public_id, article_count, independent_source_count from published_events",
      );
    });
    expect(anonymous.rows).toHaveLength(1);
    expect(anonymous.rows[0]).toMatchObject({
      public_id: expect.stringMatching(/^evt-/),
      article_count: 1,
      independent_source_count: 1,
    });

    await expect(
      driver.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select count(*) from events");
      }),
    ).rejects.toThrow();

    const publicSources = await driver.transaction(async (tx) => {
      await tx.exec("set local role anon");
      return tx.query<{ original_title: string }>("select original_title from published_event_sources");
    });
    expect(publicSources.rows).toEqual([{ original_title: "Gunmen abduct Plateau varsity student" }]);
  });
});
