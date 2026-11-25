// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { authorizeCronRequest, configuredCronSecret, MIN_CRON_SECRET_LENGTH } from "@/lib/scheduler/auth";
import { runScheduledIngestion } from "@/lib/scheduler/run";
import { validateLeaseInput } from "@/lib/scheduler/types";
import type { FetchLike } from "@/lib/ingestion/fetch";
import { PREMIUM_TIMES } from "@/lib/ingestion/sources";
import type {
  IngestionStore,
  PersistCollectionInput,
  PersistCollectionResult,
  RecordFailureInput,
} from "@/lib/ingestion/types";

const NOW = new Date("2026-11-07T08:00:00.000Z");

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Scheduler Test Feed</title>
  <item>
    <title><![CDATA[Gunmen abduct Plateau varsity student]]></title>
    <link>https://www.premiumtimesng.com/news/930001-a.html</link>
    <description><![CDATA[<p>Security sources said the student was later freed.</p>]]></description>
    <pubDate>Sat, 07 Nov 2026 06:00:00 +0000</pubDate>
    <guid isPermaLink="false">930001</guid>
  </item>
</channel></rss>`;

function persistResult(): PersistCollectionResult {
  return {
    sourceId: "00000000-0000-4000-8000-000000000001",
    fetched: 1,
    accepted: 1,
    rejected: 0,
    articlesInserted: 1,
    articlesDuplicate: 0,
    candidatesInserted: 1,
    candidatesExisting: 0,
    pending: 1,
    needsReview: 0,
    autoRejected: 0,
    status: "success",
  };
}

function fakeStore(): {
  store: IngestionStore;
  persist: ReturnType<typeof vi.fn<(input: PersistCollectionInput) => Promise<PersistCollectionResult>>>;
  failure: ReturnType<typeof vi.fn<(input: RecordFailureInput) => Promise<void>>>;
} {
  const persist = vi.fn(async (_input: PersistCollectionInput) => persistResult());
  const failure = vi.fn(async (_input: RecordFailureInput) => undefined);
  return {
    store: {
      persistCollection: persist,
      recordFailure: failure,
    },
    persist,
    failure,
  };
}

/** The pipeline reads robots.txt before the feed; serve a permissive one so these tests stay about the lease. */
const robotsAware = (feed: () => Response): FetchLike => async (input) =>
  String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow:\n", { status: 200 }) : feed();

function feedResponse(): Response {
  return new Response(XML, {
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=UTF-8" },
  });
}

describe("scheduler lock validation", () => {
  it("accepts stable lowercase lock keys and a bounded TTL", () => {
    expect(validateLeaseInput("ingest:premium-times", 60)).toEqual({ ok: true });
    expect(validateLeaseInput("a.b_c-1:2", 30)).toEqual({ ok: true });
    expect(validateLeaseInput("x".repeat(128), 3_600)).toEqual({ ok: true });
  });

  it("rejects unsafe keys and out-of-range TTLs", () => {
    expect(validateLeaseInput("UPPER", 60).ok).toBe(false);
    expect(validateLeaseInput("has space", 60).ok).toBe(false);
    expect(validateLeaseInput("a", 60).ok).toBe(false);
    expect(validateLeaseInput("ok-key", 29).ok).toBe(false);
    expect(validateLeaseInput("ok-key", 3_601).ok).toBe(false);
    expect(validateLeaseInput("ok-key", 60.5).ok).toBe(false);
  });
});

describe("cron authorization", () => {
  const secret = "s".repeat(MIN_CRON_SECRET_LENGTH);

  it("fails closed when the cron secret is missing or weak", () => {
    expect(configuredCronSecret({})).toMatchObject({ ok: false });
    expect(configuredCronSecret({ CRON_SECRET: "short" })).toMatchObject({ ok: false });
    expect(configuredCronSecret({ CRON_SECRET: "with space in it!!" })).toMatchObject({
      ok: false,
    });
    expect(configuredCronSecret({ CRON_SECRET: secret })).toEqual({ ok: true, secret });
  });

  it("requires an exact bearer token", () => {
    const env = { CRON_SECRET: secret };
    expect(authorizeCronRequest(new Headers(), env)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(
      authorizeCronRequest(new Headers({ authorization: `Bearer ${secret}x` }), env),
    ).toEqual({ ok: false, reason: "unauthorized" });
    expect(
      authorizeCronRequest(new Headers({ authorization: `Basic ${secret}` }), env),
    ).toEqual({ ok: false, reason: "unauthorized" });
    expect(
      authorizeCronRequest(new Headers({ authorization: `bearer ${secret}` }), env),
    ).toEqual({ ok: true });
  });

  it("reports not_configured separately from unauthorized", () => {
    expect(
      authorizeCronRequest(new Headers({ authorization: `Bearer ${secret}` }), {}),
    ).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("scheduled ingestion lease", () => {
  it("does no fetch or write when another process holds the lease", async () => {
    const { store, persist } = fakeStore();
    const acquire = vi.fn(async () => false);
    const release = vi.fn(async () => undefined);
    const fetchImpl = vi.fn<FetchLike>(robotsAware(() => feedResponse()));

    const outcome = await runScheduledIngestion({
      source: PREMIUM_TIMES,
      store,
      lease: { acquire, release },
      lockKey: "ingest:premium-times",
      lockTtlSeconds: 60,
      fetchImpl,
      now: NOW,
    });

    expect(outcome).toEqual({
      status: "locked",
      source: "premium-times",
      lockKey: "ingest:premium-times",
      result: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("runs ingestion behind an acquired lease and always releases it", async () => {
    const { store, persist } = fakeStore();
    const acquire = vi.fn(
      async (_lockKey: string, _token: string, _ttlSeconds: number) => true,
    );
    const release = vi.fn(async () => undefined);
    const fetchImpl = vi.fn<FetchLike>(robotsAware(() => feedResponse()));

    const outcome = await runScheduledIngestion({
      source: PREMIUM_TIMES,
      store,
      lease: { acquire, release },
      lockKey: "ingest:premium-times",
      lockTtlSeconds: 60,
      fetchImpl,
      now: NOW,
      runId: "00000000-0000-4000-8000-000000000201",
    });

    expect(outcome.status).toBe("ran");
    expect(outcome.result?.error).toBeNull();
    expect(outcome.result?.summary).toMatchObject({
      source: "premium-times",
      fetched: 1,
      accepted: 1,
      pending: 1,
      status: "success",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // robots.txt, then the feed
    expect(persist).toHaveBeenCalledTimes(1);

    const token = acquire.mock.calls[0]?.[1];
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(release).toHaveBeenCalledWith("ingest:premium-times", token);
  });

  it("releases the lease after a failed fetch and records the failure", async () => {
    const { store, persistence, failure } = (() => {
      const built = fakeStore();
      return { store: built.store, persistence: built.persist, failure: built.failure };
    })();
    const acquire = vi.fn(async () => true);
    const release = vi.fn(async () => undefined);
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("network unavailable");
    });

    const outcome = await runScheduledIngestion({
      source: PREMIUM_TIMES,
      store,
      lease: { acquire, release },
      lockKey: "ingest:premium-times",
      lockTtlSeconds: 60,
      fetchImpl,
      now: NOW,
    });

    expect(outcome.status).toBe("ran");
    expect(outcome.result?.error).toContain("network unavailable");
    expect(outcome.result?.summary.status).toBe("failed");
    expect(persistence).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("refuses inactive sources and invalid lease arguments before acquiring", async () => {
    const { store } = fakeStore();
    const acquire = vi.fn(async () => true);
    const release = vi.fn(async () => undefined);
    const fetchImpl = vi.fn<FetchLike>(robotsAware(() => feedResponse()));

    await expect(
      runScheduledIngestion({
        source: { ...PREMIUM_TIMES, active: false },
        store,
        lease: { acquire, release },
        lockKey: "ingest:premium-times",
        lockTtlSeconds: 60,
        fetchImpl,
        now: NOW,
      }),
    ).rejects.toThrow(/not active/);

    await expect(
      runScheduledIngestion({
        source: PREMIUM_TIMES,
        store,
        lease: { acquire, release },
        lockKey: "INVALID KEY",
        lockTtlSeconds: 60,
        fetchImpl,
        now: NOW,
      }),
    ).rejects.toThrow(/lock key/i);

    expect(acquire).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
