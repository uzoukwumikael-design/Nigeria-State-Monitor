import { randomUUID } from "node:crypto";
import { collectFeed } from "@/lib/ingestion/collect";
import { fetchGdelt, gdeltCountryRule } from "@/lib/ingestion/gdelt";
import { registeredPublisherHosts } from "@/lib/ingestion/sources";
import { feedUserAgent, fetchFeed, type FetchLike } from "@/lib/ingestion/fetch";
import { checkRobots, type RobotsVerdict } from "@/lib/ingestion/robots";
import { parseRssFeed } from "@/lib/ingestion/rss";
import type {
  FeedCollection,
  IngestionRunSummary,
  IngestionSource,
  IngestionStore,
} from "@/lib/ingestion/types";

export interface RunIngestionOptions {
  source: IngestionSource;
  limit?: number;
  dryRun?: boolean;
  store?: IngestionStore;
  fetchImpl?: FetchLike;
  contact?: string;
  now?: Date;
  runId?: string;
  /** Check the publisher's robots.txt before fetching the feed. On by default; only tests turn it off. */
  enforceRobots?: boolean;
}

export interface IngestionRunResult {
  summary: IngestionRunSummary;
  /** robots.txt decision for this run, or null when the check was skipped. */
  robots: RobotsVerdict | null;
  collection: FeedCollection | null;
  error: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptySummary(
  source: IngestionSource,
  runId: string,
  startedAt: Date,
  finishedAt: Date,
  status: IngestionRunSummary["status"],
): IngestionRunSummary {
  return {
    source: source.slug,
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    fetched: 0,
    accepted: 0,
    rejected: 0,
    articlesInserted: 0,
    articlesDuplicate: 0,
    candidatesInserted: 0,
    candidatesExisting: 0,
    pending: 0,
    needsReview: 0,
    autoRejected: 0,
    status,
  };
}

/**
 * Runs one source end-to-end: fetch, strict parse, deterministic scope and
 * prior checks, then optional persistence to the review queue. A failure is
 * recorded in source health when a store is available; it never produces a
 * partial article or event.
 */
export async function runIngestion(options: RunIngestionOptions): Promise<IngestionRunResult> {
  const startedAt = options.now ?? new Date();
  const runId = options.runId ?? randomUUID();
  const source = options.source;

  let collection: FeedCollection;
  let robots: RobotsVerdict | null = null;
  try {
    // Aggregator APIs are not crawled sites: robots.txt applies to the RSS feeds.
    if (source.accessMethod === "rss" && options.enforceRobots !== false) {
      robots = await checkRobots(source, {
        fetchImpl: options.fetchImpl,
        userAgent: feedUserAgent(options.contact ?? process.env.NSM_INGESTION_CONTACT),
      });
      if (!robots.allowed) throw new Error(`Skipped ${source.slug}: ${robots.reason}`);
    }
    if (source.accessMethod === "gdelt") {
      const gdelt = await fetchGdelt(source, {
        fetchImpl: options.fetchImpl,
        contact: options.contact,
        excludeHosts: registeredPublisherHosts(),
        countryRule: gdeltCountryRule(source.feedUrl),
      });
      collection = collectFeed(
        gdelt.feed,
        source,
        { fetchedAt: gdelt.fetchedAt, httpStatus: gdelt.httpStatus, contentType: gdelt.contentType, feedHash: gdelt.feedHash },
        { limit: options.limit, now: options.now },
      );
    } else {
      const fetched = await fetchFeed(source, {
        fetchImpl: options.fetchImpl,
        contact: options.contact,
      });
      const parsed = parseRssFeed(fetched.xml, source.maxItems);
      collection = collectFeed(
        parsed,
        source,
        {
          fetchedAt: fetched.fetchedAt,
          httpStatus: fetched.httpStatus,
          contentType: fetched.contentType,
          feedHash: fetched.feedHash,
        },
        { limit: options.limit, now: options.now },
      );
    }
  } catch (error) {
    const finishedAt = new Date();
    const message = messageOf(error);
    if (options.store) {
      try {
        await options.store.recordFailure({
          source,
          runId,
          startedAt,
          finishedAt,
          error: message,
        });
      } catch {
        // Failure logging must not hide the original ingestion failure.
      }
    }
    return {
      robots,
      summary: emptySummary(source, runId, startedAt, finishedAt, "failed"),
      collection: null,
      error: message,
    };
  }

  const fetchedCount = collection.items.length + collection.rejected.length;

  if (options.dryRun || !options.store) {
    const finishedAt = new Date();
    const pending = collection.items.filter((item) => item.proposal.status === "pending").length;
    const needsReview = collection.items.filter(
      (item) => item.proposal.status === "needs_review",
    ).length;
    return {
      robots,
      summary: {
        ...emptySummary(
          source,
          runId,
          startedAt,
          finishedAt,
          collection.items.length > 0 ? "success" : "partial",
        ),
        fetched: fetchedCount,
        accepted: collection.items.length,
        rejected: collection.rejected.length,
        pending,
        needsReview,
      },
      collection,
      error: null,
    };
  }

  try {
    const finishedAt = new Date();
    const persisted = await options.store.persistCollection({
      collection,
      runId,
      startedAt,
      finishedAt,
    });
    return {
      robots,
      summary: {
        source: source.slug,
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        fetched: persisted.fetched,
        accepted: persisted.accepted,
        rejected: persisted.rejected,
        articlesInserted: persisted.articlesInserted,
        articlesDuplicate: persisted.articlesDuplicate,
        candidatesInserted: persisted.candidatesInserted,
        candidatesExisting: persisted.candidatesExisting,
        pending: persisted.pending,
        needsReview: persisted.needsReview,
        autoRejected: persisted.autoRejected,
        status: persisted.status,
      },
      collection,
      error: null,
    };
  } catch (error) {
    const finishedAt = new Date();
    const message = messageOf(error);
    try {
      await options.store.recordFailure({
        source,
        runId,
        startedAt,
        finishedAt,
        error: `Persistence failed: ${message}`,
      });
    } catch {
      // Keep the original persistence error.
    }
    return {
      robots,
      summary: emptySummary(source, runId, startedAt, finishedAt, "failed"),
      collection,
      error: message,
    };
  }
}
