// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { seedRegistry } from "@/lib/data/postgres/seed";
import { collectFeed } from "@/lib/ingestion/collect";
import { parseRssFeed } from "@/lib/ingestion/rss";
import { PREMIUM_TIMES } from "@/lib/ingestion/sources";
import type { FeedCollection } from "@/lib/ingestion/types";

const NOW = new Date("2026-11-05T09:00:00.000Z");

vi.setConfig({ testTimeout: 60_000 });

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student]]></title>
    <link>https://www.premiumtimesng.com/news/more-news/910001-a.html</link>
    <description><![CDATA[<p>Security sources said the student was later freed.</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 06:00:00 +0000</pubDate>
    <category><![CDATA[Plateau State]]></category>
    <guid isPermaLink="false">910001</guid>
  </item>
  <item>
    <title><![CDATA[Inflation rises in Kano]]></title>
    <link>https://www.premiumtimesng.com/business/910002-b.html</link>
    <description><![CDATA[<p>The naira weakened as fuel prices increased.</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 05:00:00 +0000</pubDate>
    <category><![CDATA[Kano]]></category>
    <category><![CDATA[Inflation]]></category>
    <guid isPermaLink="false">910002</guid>
  </item>
  <item>
    <title><![CDATA[Super Eagles win friendly]]></title>
    <link>https://www.premiumtimesng.com/sports/football/910003-c.html</link>
    <description><![CDATA[<p>Match report.</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 04:00:00 +0000</pubDate>
    <category><![CDATA[Football]]></category>
    <guid isPermaLink="false">910003</guid>
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
      feedHash: "b".repeat(64),
    },
    { now: NOW },
  );
}

describe.sequential("Postgres ingestion review queue", () => {
  let driver: PgliteDriver;
  let store: PostgresIngestionStore;
  let collection: FeedCollection;

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, loadMigrationBundles());
    await driver.transaction((tx) => seedRegistry(tx));
    store = new PostgresIngestionStore(driver);
    collection = buildCollection();
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  }, 30_000);

  it("persists articles and candidates without creating events", async () => {
    const result = await store.persistCollection({
      collection,
      runId: "00000000-0000-4000-8000-000000000001",
      startedAt: NOW,
      finishedAt: new Date(NOW.getTime() + 500),
    });

    expect(result).toMatchObject({
      fetched: 3,
      accepted: 2,
      rejected: 1,
      articlesInserted: 2,
      articlesDuplicate: 0,
      candidatesInserted: 2,
      candidatesExisting: 0,
      pending: 2,
      needsReview: 0,
      autoRejected: 0,
      status: "success",
    });

    const source = await driver.query<{ id: string; active: boolean; is_demo: boolean }>(
      "select id, active, is_demo from sources where slug = 'premium-times'",
    );
    expect(source.rows).toHaveLength(1);
    expect(source.rows[0]?.active).toBe(true);
    expect(source.rows[0]?.is_demo).toBe(false);

    const counts = await driver.query<{
      raw_items: number;
      articles: number;
      candidates: number;
      events: number;
      logs: number;
    }>(
      `select
         (select count(*)::integer from raw_items) as raw_items,
         (select count(*)::integer from articles) as articles,
         (select count(*)::integer from ingestion_candidates) as candidates,
         (select count(*)::integer from events) as events,
         (select count(*)::integer from ingestion_logs) as logs`,
    );
    expect(counts.rows[0]).toEqual({
      raw_items: 2,
      articles: 2,
      candidates: 2,
      events: 0,
      logs: 1,
    });

    const candidates = await driver.query<{
      status: string;
      category: string;
      state_id: string;
      reasons: string[];
      rule_version: string;
      reviewed_at: string | null;
    }>(
      `select status, category, state_id, reasons, rule_version, reviewed_at
       from ingestion_candidates order by state_id`,
    );
    expect(candidates.rows.map((row) => row.state_id).sort()).toEqual(["NG-KN", "NG-PL"]);
    expect(candidates.rows.every((row) => row.status === "pending")).toBe(true);
    expect(candidates.rows.every((row) => row.reviewed_at === null)).toBe(true);
    expect(candidates.rows.every((row) => Array.isArray(row.reasons))).toBe(true);
    expect(candidates.rows[0]?.rule_version).toMatch(/^nsm-priors-/);

    const articles = await driver.query<{ excerpt: string; canonical_url: string }>(
      "select excerpt, canonical_url from articles order by canonical_url",
    );
    expect(articles.rows.every((row) => row.excerpt.length <= PREMIUM_TIMES.excerptLimit)).toBe(
      true,
    );
    expect(articles.rows.every((row) => row.canonical_url.startsWith("https://"))).toBe(true);
  });

  it("is idempotent on a repeated feed", async () => {
    const repeat = await store.persistCollection({
      collection,
      runId: "00000000-0000-4000-8000-000000000002",
      startedAt: NOW,
      finishedAt: new Date(NOW.getTime() + 300),
    });

    expect(repeat).toMatchObject({
      fetched: 3,
      accepted: 2,
      rejected: 1,
      articlesInserted: 0,
      articlesDuplicate: 2,
      candidatesInserted: 0,
      candidatesExisting: 2,
      pending: 0,
      needsReview: 0,
      status: "success",
    });

    const counts = await driver.query<{
      raw_items: number;
      articles: number;
      candidates: number;
    }>(
      `select
         (select count(*)::integer from raw_items) as raw_items,
         (select count(*)::integer from articles) as articles,
         (select count(*)::integer from ingestion_candidates) as candidates`,
    );
    expect(counts.rows[0]).toEqual({ raw_items: 2, articles: 2, candidates: 2 });
  });

  it("records failures and recovers source health on the next success", async () => {
    await store.recordFailure({
      source: PREMIUM_TIMES,
      runId: "00000000-0000-4000-8000-000000000003",
      startedAt: NOW,
      finishedAt: new Date(NOW.getTime() + 100),
      error: "Feed responded with HTTP 503.",
    });

    const down = await driver.query<{
      status: string;
      error_count: number;
      consecutive_failures: number;
      last_error: string;
      last_successful_sync: string | null;
    }>(
      `select status, error_count, consecutive_failures, last_error, last_successful_sync
       from source_health`,
    );
    expect(down.rows[0]).toMatchObject({
      status: "down",
      error_count: 1,
      consecutive_failures: 1,
      last_error: "Feed responded with HTTP 503.",
    });
    expect(down.rows[0]?.last_successful_sync).not.toBeNull();

    const failureLog = await driver.query<{ status: string; error_message: string }>(
      `select status, error_message from ingestion_logs
       where run_id = '00000000-0000-4000-8000-000000000003'`,
    );
    expect(failureLog.rows[0]).toMatchObject({
      status: "failed",
      error_message: "Feed responded with HTTP 503.",
    });

    await store.persistCollection({
      collection,
      runId: "00000000-0000-4000-8000-000000000004",
      startedAt: NOW,
      finishedAt: new Date(NOW.getTime() + 200),
    });

    const recovered = await driver.query<{
      status: string;
      error_count: number;
      consecutive_failures: number;
      last_error: string | null;
    }>(
      "select status, error_count, consecutive_failures, last_error from source_health",
    );
    expect(recovered.rows[0]).toEqual({
      status: "healthy",
      error_count: 1,
      consecutive_failures: 0,
      last_error: null,
    });
  });

  it("denies anonymous reads of the review queue", async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select count(*) from ingestion_candidates");
      }),
    ).rejects.toThrow();

    const service = await driver.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      const result = await tx.query<{ count: number }>(
        "select count(*)::integer as count from ingestion_candidates",
      );
      return result.rows[0]?.count;
    });
    expect(service).toBe(2);
  });
});
