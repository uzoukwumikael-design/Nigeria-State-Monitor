// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { PostgresReviewStore } from "@/lib/data/postgres/review";
import { seedRegistry } from "@/lib/data/postgres/seed";
import { collectFeed } from "@/lib/ingestion/collect";
import { parseRssFeed } from "@/lib/ingestion/rss";
import { PREMIUM_TIMES } from "@/lib/ingestion/sources";
import type { FeedCollection } from "@/lib/ingestion/types";

const NOW = new Date("2026-11-05T09:00:00.000Z");

vi.setConfig({ testTimeout: 90_000 });

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Review Test Feed</title>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student]]></title>
    <link>https://www.premiumtimesng.com/news/more-news/920001-a.html</link>
    <description><![CDATA[<p>Security sources said the student was later freed.</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 06:00:00 +0000</pubDate>
    <category><![CDATA[Plateau State]]></category>
    <guid isPermaLink="false">920001</guid>
  </item>
  <item>
    <title><![CDATA[Inflation rises in Kano]]></title>
    <link>https://www.premiumtimesng.com/business/920002-b.html</link>
    <description><![CDATA[<p>The naira weakened as fuel prices increased.</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 05:00:00 +0000</pubDate>
    <category><![CDATA[Kano]]></category>
    <category><![CDATA[Inflation]]></category>
    <guid isPermaLink="false">920002</guid>
  </item>
  <item>
    <title><![CDATA[Nigeria records new cholera cases]]></title>
    <link>https://www.premiumtimesng.com/health/920003-c.html</link>
    <description><![CDATA[<p>Health authorities reported new infections.</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 04:00:00 +0000</pubDate>
    <category><![CDATA[Health]]></category>
    <guid isPermaLink="false">920003</guid>
  </item>
  <item>
    <title><![CDATA[Super Eagles win friendly]]></title>
    <link>https://www.premiumtimesng.com/sports/football/920004-d.html</link>
    <description><![CDATA[<p>Match report.</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 03:00:00 +0000</pubDate>
    <category><![CDATA[Football]]></category>
    <guid isPermaLink="false">920004</guid>
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
      feedHash: "c".repeat(64),
    },
    { now: NOW },
  );
}

interface CandidateRow {
  public_id: string;
  title: string;
  status: string;
  state_id: string | null;
  category: string | null;
}

describe.sequential("reviewer decisions", () => {
  let driver: PgliteDriver;
  let review: PostgresReviewStore;
  let candidates: Map<string, CandidateRow>;

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, loadMigrationBundles());
    await driver.transaction((tx) => seedRegistry(tx));

    const ingestion = new PostgresIngestionStore(driver);
    const persisted = await ingestion.persistCollection({
      collection: buildCollection(),
      runId: "00000000-0000-4000-8000-000000000101",
      startedAt: NOW,
      finishedAt: new Date(NOW.getTime() + 500),
    });
    expect(persisted).toMatchObject({
      fetched: 4,
      accepted: 3,
      rejected: 1,
      candidatesInserted: 3,
      pending: 2,
      needsReview: 1,
      autoRejected: 0,
    });

    review = new PostgresReviewStore(driver);
    const rows = await driver.query<CandidateRow>(
      `select c.public_id, a.original_title as title, c.status, c.state_id, c.category
       from ingestion_candidates c
       join articles a on a.id = c.article_id`,
    );
    candidates = new Map(rows.rows.map((row) => [row.title, row]));
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  }, 30_000);

  it("lists the open queue with evidence metadata and no events", async () => {
    const queue = await review.listReviewQueue();
    expect(queue).toHaveLength(3);
    expect(queue[0]?.status).toBe("needs_review");
    expect(queue.map((candidate) => candidate.article.title)).toContain(
      "Gunmen abduct Plateau varsity student",
    );
    expect(queue.every((candidate) => candidate.article.url.startsWith("https://"))).toBe(true);
    expect(queue.every((candidate) => candidate.article.excerpt.length > 0)).toBe(true);
    expect(queue.every((candidate) => candidate.categoryConfidence >= 0)).toBe(true);

    const pending = await review.listReviewQueue({ status: "pending" });
    expect(pending).toHaveLength(2);
    const limited = await review.listReviewQueue({ status: "open", limit: 1 });
    expect(limited).toHaveLength(1);

    const events = await driver.query<{ events: number; published: number }>(
      `select
         (select count(*)::integer from events) as events,
         (select count(*)::integer from published_events) as published`,
    );
    expect(events.rows[0]).toEqual({ events: 0, published: 0 });
  });

  it("accepts and rejects candidates without creating an event", async () => {
    const plateau = candidates.get("Gunmen abduct Plateau varsity student");
    const kano = candidates.get("Inflation rises in Kano");
    const cholera = candidates.get("Nigeria records new cholera cases");
    expect(plateau?.state_id).toBe("NG-PL");
    expect(cholera?.state_id).toBeNull();

    const accepted = await review.decide({
      candidatePublicId: plateau!.public_id,
      action: "accept",
      reviewerId: "Reviewer-01",
      notes: "Headline and excerpt agree with the proposed state.",
    });
    if (!accepted.ok) throw new Error(accepted.message);
    expect(accepted.candidate.status).toBe("accepted");
    expect(accepted.candidate.reviewedBy).toBe("reviewer-01");
    expect(accepted.candidate.reviewedAt).not.toBeNull();
    expect(accepted.reviewId).toMatch(/^[0-9a-f-]{36}$/);

    const rejected = await review.decide({
      candidatePublicId: kano!.public_id,
      action: "reject",
      reviewerId: "reviewer-02",
      notes: "Duplicate of an earlier inflation report.",
    });
    if (!rejected.ok) throw new Error(rejected.message);
    expect(rejected.candidate.status).toBe("rejected");

    const missingState = await review.decide({
      candidatePublicId: cholera!.public_id,
      action: "accept",
      reviewerId: "reviewer-01",
    });
    expect(missingState).toMatchObject({ ok: false, code: "missing_state" });

    const corrected = await review.decide({
      candidatePublicId: cholera!.public_id,
      action: "accept",
      reviewerId: "reviewer-01",
      stateId: "NG-LA",
      category: "health",
    });
    if (!corrected.ok) throw new Error(corrected.message);
    expect(corrected.candidate).toMatchObject({
      status: "accepted",
      category: "health",
      stateId: "NG-LA",
      lga: null,
    });

    // The evidence article keeps its original deterministic proposal; the
    // reviewer correction lives on the candidate and in the audit trail.
    const article = await driver.query<{ state_id: string | null }>(
      "select state_id from articles where original_title = 'Nigeria records new cholera cases'",
    );
    expect(article.rows[0]?.state_id).toBeNull();

    const decided = await driver.query<{ status: string; rejection_reason: string | null }>(
      "select status, rejection_reason from ingestion_candidates where public_id = $1",
      [kano!.public_id],
    );
    expect(decided.rows[0]).toEqual({ status: "rejected", rejection_reason: "reviewer_rejected" });

    const repeated = await review.decide({
      candidatePublicId: plateau!.public_id,
      action: "reject",
      reviewerId: "reviewer-02",
      notes: "Changed my mind.",
    });
    expect(repeated).toMatchObject({ ok: false, code: "already_decided" });

    const audit = await driver.query<{
      action: string;
      previous_status: string;
      new_status: string;
      reviewer_id: string;
      previous_state_id: string | null;
      state_id: string | null;
      notes: string | null;
    }>(
      `select action, previous_status, new_status, reviewer_id,
              previous_state_id, state_id, notes
       from candidate_reviews order by created_at, action`,
    );
    expect(audit.rows).toHaveLength(3);
    expect(audit.rows.filter((row) => row.action === "accept")).toHaveLength(2);
    expect(audit.rows.filter((row) => row.action === "reject")).toHaveLength(1);
    const correction = audit.rows.find((row) => row.previous_state_id === null && row.state_id === "NG-LA");
    expect(correction).toBeDefined();
    expect(correction?.new_status).toBe("accepted");

    const events = await driver.query<{ events: number; published: number }>(
      `select
         (select count(*)::integer from events) as events,
         (select count(*)::integer from published_events) as published`,
    );
    expect(events.rows[0]).toEqual({ events: 0, published: 0 });

    const acceptedList = await review.listReviewQueue({ status: "accepted" });
    expect(acceptedList).toHaveLength(2);
    const rejectedList = await review.listReviewQueue({ status: "rejected" });
    expect(rejectedList).toHaveLength(1);
  });

  it("keeps the audit trail server-only and append-only", async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select count(*) from candidate_reviews");
      }),
    ).rejects.toThrow();

    const service = await driver.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      const result = await tx.query<{ count: number }>(
        "select count(*)::integer as count from candidate_reviews",
      );
      return result.rows[0]?.count;
    });
    expect(service).toBe(3);

    const privileges = await driver.query<{
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
    expect(privileges.rows[0]).toEqual({
      anon_denied: true,
      authenticated_denied: true,
      service_select: true,
      service_insert: true,
      service_update: false,
      service_delete: false,
    });

    await expect(
      driver.query("update candidate_reviews set notes = 'tampered'"),
    ).rejects.toThrow(/append-only/);
  });
});
