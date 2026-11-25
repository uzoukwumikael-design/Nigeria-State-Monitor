// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMigrationBundles } from "../../../../scripts/db/load-migrations";
import type {
  EnrichmentMetadata,
  EnrichmentProposal,
} from "@/lib/ai/types";
import { PostgresEnrichmentStore } from "@/lib/data/postgres/ai";
import { PostgresIngestionStore } from "@/lib/data/postgres/ingestion";
import { applyMigrations } from "@/lib/data/postgres/migrations";
import { PgliteDriver } from "@/lib/data/postgres/pglite-driver";
import { PostgresReviewStore } from "@/lib/data/postgres/review";
import { seedRegistry } from "@/lib/data/postgres/seed";
import { collectFeed } from "@/lib/ingestion/collect";
import { parseRssFeed } from "@/lib/ingestion/rss";
import { PREMIUM_TIMES } from "@/lib/ingestion/sources";
import type { FeedCollection } from "@/lib/ingestion/types";

const NOW = new Date("2026-11-06T09:00:00.000Z");

vi.setConfig({ testTimeout: 90_000 });

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>AI Enrichment Test Feed</title>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student]]></title>
    <link>https://www.premiumtimesng.com/news/more-news/930001-a.html</link>
    <description><![CDATA[<p>Security sources said the student was later freed.</p>]]></description>
    <pubDate>Fri, 06 Nov 2026 06:00:00 +0000</pubDate>
    <category><![CDATA[Plateau State]]></category>
    <guid isPermaLink="false">930001</guid>
  </item>
  <item>
    <title><![CDATA[Inflation rises in Kano]]></title>
    <link>https://www.premiumtimesng.com/business/930002-b.html</link>
    <description><![CDATA[<p>The naira weakened as fuel prices increased.</p>]]></description>
    <pubDate>Fri, 06 Nov 2026 05:00:00 +0000</pubDate>
    <category><![CDATA[Kano]]></category>
    <category><![CDATA[Inflation]]></category>
    <guid isPermaLink="false">930002</guid>
  </item>
  <item>
    <title><![CDATA[Nigeria records new cholera cases]]></title>
    <link>https://www.premiumtimesng.com/health/930003-c.html</link>
    <description><![CDATA[<p>Health authorities reported new infections.</p>]]></description>
    <pubDate>Fri, 06 Nov 2026 04:00:00 +0000</pubDate>
    <category><![CDATA[Health]]></category>
    <guid isPermaLink="false">930003</guid>
  </item>
  <item>
    <title><![CDATA[Super Eagles win friendly]]></title>
    <link>https://www.premiumtimesng.com/sports/football/930004-d.html</link>
    <description><![CDATA[<p>Match report.</p>]]></description>
    <pubDate>Fri, 06 Nov 2026 03:00:00 +0000</pubDate>
    <category><![CDATA[Football]]></category>
    <guid isPermaLink="false">930004</guid>
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

function proposal(overrides: Partial<EnrichmentProposal> = {}): EnrichmentProposal {
  return {
    category: "security",
    stateId: "NG-PL",
    lga: null,
    confidence: 0.82,
    locationEvidence: ["Plateau varsity student"],
    summary: "A Plateau varsity student was reported abducted and later freed.",
    entities: ["Plateau State"],
    uncertainties: ["The excerpt does not name the student or the institution."],
    analysis: null,
    ...overrides,
  };
}

function metadata(overrides: Partial<EnrichmentMetadata> = {}): EnrichmentMetadata {
  return {
    provider: "fixture",
    model: "fixture-model",
    promptVersion: "nsm-enrichment-prompt-2026-11-06.1",
    schemaVersion: "nsm-enrichment-2026-11-06.1",
    processedAt: NOW.toISOString(),
    rawResponseHash: "a".repeat(64),
    ...overrides,
  };
}

interface CandidateRow {
  id: string;
  public_id: string;
  title: string;
  status: string;
  category: string | null;
  state_id: string | null;
  lga: string | null;
}

interface EnrichmentRow {
  id: string;
  provider: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  proposal: EnrichmentProposal;
  /** PostgreSQL numeric arrives as a string through pg/PGlite. */
  confidence: string;
  raw_response_hash: string;
  processed_at: string;
}

describe.sequential("AI enrichment store", () => {
  let driver: PgliteDriver;
  let store: PostgresEnrichmentStore;
  let review: PostgresReviewStore;
  let candidates: Map<string, CandidateRow>;

  beforeAll(async () => {
    driver = await PgliteDriver.create();
    await applyMigrations(driver, loadMigrationBundles());
    await driver.transaction((tx) => seedRegistry(tx));

    const ingestion = new PostgresIngestionStore(driver);
    const persisted = await ingestion.persistCollection({
      collection: buildCollection(),
      runId: "00000000-0000-4000-8000-000000000102",
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

    store = new PostgresEnrichmentStore(driver);
    review = new PostgresReviewStore(driver);
    const rows = await driver.query<CandidateRow>(
      `select c.id, c.public_id, a.original_title as title, c.status,
              c.category, c.state_id, c.lga
       from ingestion_candidates c
       join articles a on a.id = c.article_id`,
    );
    candidates = new Map(rows.rows.map((row) => [row.title, row]));
  }, 120_000);

  afterAll(async () => {
    await driver.close();
  }, 30_000);

  it("stores a validated proposal and deduplicates without touching evidence", async () => {
    const plateau = candidates.get("Gunmen abduct Plateau varsity student");
    expect(plateau).toBeDefined();
    expect(plateau).toMatchObject({ status: "pending", state_id: "NG-PL", lga: null });

    const first = await store.record({
      candidatePublicId: plateau!.public_id,
      proposal: proposal(),
      metadata: metadata(),
    });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    if (!first.ok) throw new Error(first.message);

    const second = await store.record({
      candidatePublicId: plateau!.public_id,
      proposal: proposal({ summary: "A duplicate proposal with different text." }),
      metadata: metadata(),
    });
    expect(second).toMatchObject({ ok: true, id: first.id, duplicate: true });

    const enrichments = await driver.query<EnrichmentRow>(
      `select id, provider, model, prompt_version, schema_version, proposal,
              confidence, raw_response_hash, processed_at
       from ai_enrichments`,
    );
    expect(enrichments.rows).toHaveLength(1);
    expect(enrichments.rows[0]).toMatchObject({
      id: first.id,
      provider: "fixture",
      model: "fixture-model",
      prompt_version: "nsm-enrichment-prompt-2026-11-06.1",
      schema_version: "nsm-enrichment-2026-11-06.1",
      raw_response_hash: "a".repeat(64),
    });
    expect(enrichments.rows[0]?.proposal).toMatchObject({
      category: "security",
      stateId: "NG-PL",
      lga: null,
      confidence: 0.82,
    });
    expect(Number(enrichments.rows[0]?.confidence)).toBe(0.82);

    // The proposal is evidence-side only: the candidate keeps its capture-time
    // fields and no event or publication exists.
    const unchanged = await driver.query<CandidateRow>(
      `select id, public_id, status, category, state_id, lga
       from ingestion_candidates where id = $1`,
      [plateau!.id],
    );
    expect(unchanged.rows[0]).toMatchObject({
      status: "pending",
      category: plateau!.category,
      state_id: "NG-PL",
      lga: null,
    });

    const counts = await driver.query<{ events: number; published: number }>(
      `select
         (select count(*)::integer from events) as events,
         (select count(*)::integer from published_events) as published`,
    );
    expect(counts.rows[0]).toEqual({ events: 0, published: 0 });
  });

  it("returns not_found and refuses a rejected candidate", async () => {
    const missing = await store.record({
      candidatePublicId: "cand-does-not-exist",
      proposal: proposal(),
      metadata: metadata(),
    });
    expect(missing).toMatchObject({ ok: false, code: "not_found" });

    const kano = candidates.get("Inflation rises in Kano");
    expect(kano).toBeDefined();
    const rejected = await review.decide({
      candidatePublicId: kano!.public_id,
      action: "reject",
      reviewerId: "reviewer-ai",
      notes: "The excerpt does not establish a reportable incident.",
    });
    if (!rejected.ok) throw new Error(rejected.message);

    const refused = await store.record({
      candidatePublicId: kano!.public_id,
      proposal: proposal({
        category: "economy",
        stateId: "NG-KA",
        lga: null,
        locationEvidence: ["Kano"],
      }),
      metadata: metadata({ provider: "fixture-two" }),
    });
    expect(refused).toMatchObject({ ok: false, code: "rejected_candidate" });

    const rows = await driver.query<{ count: number }>(
      "select count(*)::integer as count from ai_enrichments",
    );
    expect(rows.rows[0]?.count).toBe(1);

    const counts = await driver.query<{ events: number; published: number }>(
      `select
         (select count(*)::integer from events) as events,
         (select count(*)::integer from published_events) as published`,
    );
    expect(counts.rows[0]).toEqual({ events: 0, published: 0 });
  });

  it("keeps enrichments server-only and append-only", async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select count(*) from ai_enrichments");
      }),
    ).rejects.toThrow();

    await expect(
      driver.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select count(*) from ai_enrichments");
      }),
    ).rejects.toThrow();

    const service = await driver.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      const result = await tx.query<{ count: number }>(
        "select count(*)::integer as count from ai_enrichments",
      );
      return result.rows[0]?.count;
    });
    expect(service).toBe(1);

    const privileges = await driver.query<{
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
    expect(privileges.rows[0]).toEqual({
      anon_denied: true,
      authenticated_denied: true,
      service_select: true,
      service_insert: true,
      service_update: false,
      service_delete: false,
    });

    await expect(
      driver.query("update ai_enrichments set model = 'tampered'"),
    ).rejects.toThrow(/append-only/);
  });
});
