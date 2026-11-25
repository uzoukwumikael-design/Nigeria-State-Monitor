// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import { PostgresClusterStore } from "@/lib/data/postgres/clusters";
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
  <title>Cluster Test Feed</title>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student]]></title>
    <link>https://www.premiumtimesng.com/news/more-news/950001-a.html</link>
    <description><![CDATA[<p>Security sources said the student was later freed.</p>]]></description>
    <pubDate>Sat, 07 Nov 2026 06:00:00 +0000</pubDate>
    <category><![CDATA[Plateau State]]></category>
    <guid isPermaLink="false">950001</guid>
  </item>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student, police confirm]]></title>
    <link>https://www.premiumtimesng.com/news/more-news/950002-b.html</link>
    <description><![CDATA[<p>Police confirmed the abduction and said a search is underway.</p>]]></description>
    <pubDate>Sat, 07 Nov 2026 06:20:00 +0000</pubDate>
    <category><![CDATA[Plateau State]]></category>
    <guid isPermaLink="false">950002</guid>
  </item>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student again]]></title>
    <link>https://www.premiumtimesng.com/news/more-news/950003-c.html</link>
    <description><![CDATA[<p>A second abduction was reported near the same campus.</p>]]></description>
    <pubDate>Sat, 07 Nov 2026 06:40:00 +0000</pubDate>
    <category><![CDATA[Plateau State]]></category>
    <guid isPermaLink="false">950003</guid>
  </item>
  <item>
    <title><![CDATA[Inflation rises in Kano]]></title>
    <link>https://www.premiumtimesng.com/business/950004-d.html</link>
    <description><![CDATA[<p>The naira weakened as fuel prices increased.</p>]]></description>
    <pubDate>Sat, 07 Nov 2026 05:00:00 +0000</pubDate>
    <category><![CDATA[Kano]]></category>
    <category><![CDATA[Inflation]]></category>
    <guid isPermaLink="false">950004</guid>
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
      feedHash: "e".repeat(64),
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

describe.sequential("cluster assessment and review", () => {
  let driver: PgliteDriver;
  let clusters: PostgresClusterStore;
  let plateau: CandidateRow;
  let samePublisherReject: CandidateRow;
  let samePublisherAccept: CandidateRow;
  let eventPublicId: string;

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, loadMigrationBundles());
    await driver.transaction((tx) => seedRegistry(tx));

    const ingestion = new PostgresIngestionStore(driver);
    await ingestion.persistCollection({
      collection: buildCollection(),
      runId: "00000000-0000-4000-8000-000000000401",
      startedAt: NOW,
      finishedAt: new Date(NOW.getTime() + 500),
    });

    const rows = await driver.query<CandidateRow>(
      `select c.public_id, a.original_title as title, c.status, c.category, c.state_id
       from ingestion_candidates c join articles a on a.id = c.article_id`,
    );
    plateau = rows.rows.find((row) => row.title === "Gunmen abduct Plateau varsity student")!;
    samePublisherReject = rows.rows.find(
      (row) => row.title === "Gunmen abduct Plateau varsity student, police confirm",
    )!;
    samePublisherAccept = rows.rows.find(
      (row) => row.title === "Gunmen abduct Plateau varsity student again",
    )!;
    for (const candidate of [plateau, samePublisherReject, samePublisherAccept]) {
      expect(candidate).toMatchObject({ category: "security", state_id: "NG-PL" });
    }

    const review = new PostgresReviewStore(driver);
    for (const candidate of [plateau, samePublisherReject, samePublisherAccept]) {
      const accepted = await review.decide({
        candidatePublicId: candidate.public_id,
        action: "accept",
        reviewerId: "duty.editor",
        notes: "Headline, excerpt and Plateau category agree with the proposed state.",
      });
      if (!accepted.ok) throw new Error(accepted.message);
    }

    const publication = new PostgresPublicationStore(driver);
    const published = await publication.publish({
      candidatePublicId: plateau.public_id,
      reviewerId: "duty.editor",
      severity: 3,
      severityRationale: "Reported abduction with a police response and local impact.",
    });
    if (!published.ok) throw new Error(published.message);
    eventPublicId = published.event.eventPublicId;

    clusters = new PostgresClusterStore(driver);
  }, 150_000);

  afterAll(async () => {
    await driver.close();
  }, 30_000);

  it("queues same-publisher near-duplicates for review, never auto-attach", async () => {
    const scan = await clusters.scan(50);
    expect(scan).toMatchObject({
      scannedCandidates: 2,
      comparedEvents: 2,
      queuedForReview: 2,
      autoAttached: 0,
      skipped: 0,
    });

    const queue = await clusters.listQueue("pending");
    expect(queue).toHaveLength(2);
    for (const item of queue) {
      expect(item.event.publicId).toBe(eventPublicId);
      expect(item.similarity).not.toBeNull();
      expect(item.similarity ?? 0).toBeGreaterThanOrEqual(0.7);
      expect(item.reasons.join(" ")).toContain("Same publisher is not independent corroboration.");
      expect(item.ruleVersion).toMatch(/^nsm-cluster-/);
    }
    expect(queue.map((item) => item.candidate.title).sort()).toEqual(
      [
        "Gunmen abduct Plateau varsity student again",
        "Gunmen abduct Plateau varsity student, police confirm",
      ].sort(),
    );

    const events = await driver.query<{ events: number }>(
      "select count(*)::integer as events from events",
    );
    expect(events.rows[0]?.events).toBe(1);
  });

  it("rejects a cluster without attaching evidence and does not duplicate the queue entry", async () => {
    const pending = await clusters.listQueue("pending");
    const target = pending.find(
      (item) => item.candidate.title === "Gunmen abduct Plateau varsity student, police confirm",
    )!;

    const rejected = await clusters.review({
      clusterId: target.id,
      action: "reject",
      reviewerId: "Duty.Editor",
      notes: "The second report repeats the same publisher account and adds no independent evidence.",
    });
    if (!rejected.ok) throw new Error(rejected.message);
    expect(rejected).toMatchObject({
      ok: true,
      action: "reject",
      eventPublicId,
    });

    const queue = await clusters.listQueue("rejected");
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: target.id,
      decision: "rejected",
      reviewedBy: "duty.editor",
    });

    const evidence = await driver.query<{ count: number }>(
      `select count(*)::integer as count from event_sources
       where event_id = (select id from events where public_id = $1)`,
      [eventPublicId],
    );
    expect(evidence.rows[0]?.count).toBe(1);

    const repeated = await clusters.scan(50);
    expect(repeated.queuedForReview).toBe(0);
    expect(repeated.autoAttached).toBe(0);
    expect(repeated.skipped).toBeGreaterThanOrEqual(1);

    const stillOne = await clusters.listQueue("rejected");
    expect(stillOne).toHaveLength(1);

    const audit = await driver.query<{ action: string; reviewer_id: string }>(
      `select action, after->>'reviewer_id' as reviewer_id
       from audit_logs where action = 'cluster_reject'`,
    );
    expect(audit.rows).toEqual([{ action: "cluster_reject", reviewer_id: "duty.editor" }]);
  });

  it("accepts a cluster, attaches supporting evidence and leaves verification unchanged", async () => {
    const pending = await clusters.listQueue("pending");
    const target = pending.find(
      (item) => item.candidate.title === "Gunmen abduct Plateau varsity student again",
    )!;

    const accepted = await clusters.review({
      clusterId: target.id,
      action: "accept",
      reviewerId: "duty.editor",
      notes: "Same event reported by the same publisher; attach as supporting evidence only.",
    });
    if (!accepted.ok) throw new Error(accepted.message);
    expect(accepted).toMatchObject({ ok: true, action: "accept", eventPublicId });

    const queue = await clusters.listQueue("accepted");
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: target.id, decision: "accepted", reviewedBy: "duty.editor" });

    const evidence = await driver.query<{ relationship: string; original_title: string }>(
      `select es.relationship, a.original_title
       from event_sources es join articles a on a.id = es.article_id
       where es.event_id = (select id from events where public_id = $1)
       order by es.relationship, a.original_title`,
      [eventPublicId],
    );
    expect(evidence.rows).toEqual([
      {
        relationship: "primary",
        original_title: "Gunmen abduct Plateau varsity student",
      },
      {
        relationship: "supporting",
        original_title: "Gunmen abduct Plateau varsity student again",
      },
    ]);

    const source = await driver.query<{
      relationship: string;
      independence_group: string;
    }>(
      `select relationship, independence_group from event_sources
       where article_id = (select id from articles where original_title = $1)`,
      ["Gunmen abduct Plateau varsity student again"],
    );
    expect(source.rows).toEqual([
      { relationship: "supporting", independence_group: "premium-times" },
    ]);

    const link = await driver.query<{
      link_type: string;
      reviewer_id: string;
      cluster_id: string | null;
    }>(
      `select link_type, reviewer_id, cluster_id from candidate_event_links
       where cluster_id = $1`,
      [target.id],
    );
    expect(link.rows).toEqual([
      { link_type: "supporting", reviewer_id: "duty.editor", cluster_id: target.id },
    ]);

    const updates = await driver.query<{ count: number }>(
      `select count(*)::integer as count from event_updates
       where event_id = (select id from events where public_id = $1)`,
      [eventPublicId],
    );
    expect(updates.rows[0]?.count).toBe(2);

    const event = await driver.query<{ verification_status: string }>(
      "select verification_status from events where public_id = $1",
      [eventPublicId],
    );
    expect(event.rows[0]?.verification_status).toBe("unassessed");

    const audit = await driver.query<{ action: string; reviewer_id: string }>(
      `select action, after->>'reviewer_id' as reviewer_id
       from audit_logs where action = 'cluster_accept'`,
    );
    expect(audit.rows).toEqual([{ action: "cluster_accept", reviewer_id: "duty.editor" }]);
  });

  it("auto-attaches only independent evidence after all hard gates pass", async () => {
    const source = await driver.query<{ id: string }>(
      `insert into sources (
         slug, name, source_type, tier, base_url, feed_url, access_method,
         independence_group, licence_status, attribution, reliability_note, active, is_demo
       ) values (
         'daily-trust', 'Daily Trust', 'news', 'major_publisher',
         'https://dailytrust.example', 'https://dailytrust.example/feed/', 'rss',
         'daily-trust', 'restricted', 'Daily Trust test fixture', 'Test fixture', true, false
       ) returning id`,
    );
    const sourceId = source.rows[0]!.id;
    const article = await driver.query<{ id: string }>(
      `insert into articles (
         public_id, source_id, original_title, original_url, canonical_url, excerpt,
         content_hash, published_at, retrieved_at, language, state_id, lga, is_demo
       ) values (
         'art-daily-0001', $1, 'Gunmen abduct Plateau varsity student',
         'https://dailytrust.example/news/1', 'https://dailytrust.example/news/1',
         'Police confirmed the abduction and said a search is underway.',
         $2, $3, $3, 'en', 'NG-PL', null, false
       ) returning id`,
      [sourceId, "f".repeat(64), NOW.toISOString()],
    );
    const articleId = article.rows[0]!.id;
    await driver.query(
      `insert into ingestion_candidates (
         public_id, run_id, source_id, article_id, category, state_id, lga,
         category_confidence, geo_confidence, status, reasons, rule_version,
         reviewed_at, reviewed_by
       ) values (
         'cand-daily-0001', '00000000-0000-4000-8000-000000000402'::uuid, $1, $2,
         'security', 'NG-PL', null, 0.9, 0.9, 'accepted', '[]'::jsonb, 'test-cluster-1',
         $3, 'reviewer-01'
       )`,
      [sourceId, articleId, NOW.toISOString()],
    );

    const scan = await clusters.scan(50);
    expect(scan).toMatchObject({
      scannedCandidates: 2,
      comparedEvents: 2,
      queuedForReview: 0,
      autoAttached: 1,
      skipped: 1,
    });

    const evidence = await driver.query<{
      relationship: string;
      independence_group: string;
      original_title: string;
    }>(
      `select es.relationship, es.independence_group, a.original_title
       from event_sources es join articles a on a.id = es.article_id
       where es.event_id = (select id from events where public_id = $1)
       order by es.relationship, a.original_title`,
      [eventPublicId],
    );
    expect(evidence.rows).toEqual([
      {
        relationship: "primary",
        independence_group: "premium-times",
        original_title: "Gunmen abduct Plateau varsity student",
      },
      {
        relationship: "supporting",
        independence_group: "daily-trust",
        original_title: "Gunmen abduct Plateau varsity student",
      },
      {
        relationship: "supporting",
        independence_group: "premium-times",
        original_title: "Gunmen abduct Plateau varsity student again",
      },
    ]);

    const autoCluster = await driver.query<{
      decision: string;
      reviewed_by: string;
      similarity: unknown;
      rule_version: string;
    }>(
      `select decision, reviewed_by, similarity, rule_version from event_clusters
       where article_id = $1`,
      [articleId],
    );
    expect(autoCluster.rows).toHaveLength(1);
    expect(autoCluster.rows[0]).toMatchObject({
      decision: "accepted",
      reviewed_by: "system.auto-cluster",
    });
    expect(Number(autoCluster.rows[0]?.similarity)).toBeGreaterThanOrEqual(0.86);
    expect(autoCluster.rows[0]?.rule_version).toMatch(/^nsm-cluster-/);

    const link = await driver.query<{ link_type: string; reviewer_id: string }>(
      `select link_type, reviewer_id from candidate_event_links where article_id = $1`,
      [articleId],
    );
    expect(link.rows).toEqual([{ link_type: "supporting", reviewer_id: "system.auto-cluster" }]);

    const events = await driver.query<{ events: number; verification_status: string }>(
      "select count(*)::integer as events, min(verification_status) as verification_status from events",
    );
    expect(events.rows[0]).toEqual({ events: 1, verification_status: "unassessed" });

    const audit = await driver.query<{ action: string; actor_type: string }>(
      `select action, actor_type from audit_logs where action = 'cluster_auto_attach'`,
    );
    expect(audit.rows).toEqual([{ action: "cluster_auto_attach", actor_type: "system" }]);

    const all = await clusters.listQueue("all", 100);
    expect(all).toHaveLength(3);
    expect(all.filter((item) => item.decision === "rejected")).toHaveLength(1);
    expect(all.filter((item) => item.decision === "accepted")).toHaveLength(2);
  });
});
