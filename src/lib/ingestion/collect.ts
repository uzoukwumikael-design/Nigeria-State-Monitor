import { createHash } from "node:crypto";
import type {
  FeedCollection,
  IngestionSource,
  NormalizedIngestionItem,
  ParsedRssFeed,
  RejectedFeedItem,
} from "@/lib/ingestion/types";
import { classifyCategory, classifyGeography, proposeCandidate } from "@/lib/ingestion/classify";
import { cleanTitle, excerptFromHtml, truncateText } from "@/lib/ingestion/text";
import {
  canonicalizeArticleUrl,
  isPromotedItem,
  isPromotedUrl,
  outOfScopeSection,
} from "@/lib/ingestion/url";

export interface FeedFetchMetadata {
  fetchedAt: string;
  httpStatus: number;
  contentType: string;
  feedHash: string;
}

export interface CollectOptions {
  /** Maximum items to examine; never more than the source's maxItems. */
  limit?: number;
  /** Reference time for age and future-date checks. Defaults to fetchedAt. */
  now?: Date;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parsePublishedAt(raw: string | null): { date: Date | null; invalid: boolean } {
  if (!raw || !raw.trim()) return { date: null, invalid: false };
  const ms = Date.parse(raw.trim());
  if (!Number.isFinite(ms)) return { date: null, invalid: true };
  const date = new Date(ms);
  if (date.getUTCFullYear() < 2000) return { date: null, invalid: true };
  return { date, invalid: false };
}

function rejection(
  externalId: string | null,
  title: string,
  url: string | null,
  reason: string,
  detail?: string,
): RejectedFeedItem {
  const entry: RejectedFeedItem = {
    externalId,
    title: truncateText(title, 200),
    url: url ? truncateText(url, 500) : null,
    reason,
  };
  if (detail) entry.detail = truncateText(detail, 200);
  return entry;
}

/**
 * Normalises a parsed feed into article evidence and review candidates.
 * Items that fail a structural, licensing or scope check are returned as
 * explicit rejections instead of silently disappearing. No item can become an
 * event; the best possible outcome is a `pending` review candidate.
 */
export function collectFeed(
  feed: ParsedRssFeed,
  source: IngestionSource,
  meta: FeedFetchMetadata,
  options: CollectOptions = {},
): FeedCollection {
  const fetchedAt = new Date(meta.fetchedAt);
  const now = options.now ?? (Number.isFinite(fetchedAt.getTime()) ? fetchedAt : new Date());
  const limit = Math.min(
    source.maxItems,
    Math.max(0, Math.floor(options.limit ?? source.maxItems)),
  );
  const maxAgeMs = source.maxAgeDays * 24 * 60 * 60 * 1000;
  const maxFutureMs = 48 * 60 * 60 * 1000;

  const items: NormalizedIngestionItem[] = [];
  const rejected: RejectedFeedItem[] = [];
  const seenUrls = new Map<string, string>();
  const seenExternalIds = new Set<string>();

  for (const parsed of feed.items.slice(0, limit)) {
    const rawTitle = cleanTitle(parsed.title);
    const externalId = parsed.guid ? truncateText(parsed.guid.trim(), 300) : null;

    if (!rawTitle) {
      rejected.push(rejection(externalId, "", parsed.link || null, "missing_title"));
      continue;
    }

    const canonical = canonicalizeArticleUrl(parsed.link, source.baseUrl, source.allowedHosts, source.linkPolicy === "any_public_https");
    if (!canonical.url) {
      rejected.push(
        rejection(externalId, rawTitle, parsed.link || null, canonical.reason ?? "invalid_url"),
      );
      continue;
    }
    const canonicalUrl = canonical.url;

    if (isPromotedUrl(canonicalUrl)) {
      rejected.push(rejection(externalId, rawTitle, canonicalUrl, "promoted_item"));
      continue;
    }

    const section = outOfScopeSection(canonicalUrl);
    if (section) {
      rejected.push(
        rejection(externalId, rawTitle, canonicalUrl, "out_of_scope_section", section),
      );
      continue;
    }

    if (isPromotedItem(parsed.categories)) {
      rejected.push(rejection(externalId, rawTitle, canonicalUrl, "promoted_item", "feed_tag"));
      continue;
    }

    const published = parsePublishedAt(parsed.pubDate);
    if (published.invalid) {
      rejected.push(
        rejection(externalId, rawTitle, canonicalUrl, "invalid_publication_date", parsed.pubDate ?? ""),
      );
      continue;
    }
    if (published.date) {
      const delta = published.date.getTime() - now.getTime();
      if (delta > maxFutureMs) {
        rejected.push(
          rejection(
            externalId,
            rawTitle,
            canonicalUrl,
            "future_publication_date",
            published.date.toISOString(),
          ),
        );
        continue;
      }
      if (now.getTime() - published.date.getTime() > maxAgeMs) {
        rejected.push(
          rejection(
            externalId,
            rawTitle,
            canonicalUrl,
            "older_than_window",
            published.date.toISOString(),
          ),
        );
        continue;
      }
    }

    if (seenUrls.has(canonicalUrl)) {
      rejected.push(
        rejection(
          externalId,
          rawTitle,
          canonicalUrl,
          "duplicate_in_feed",
          seenUrls.get(canonicalUrl),
        ),
      );
      continue;
    }
    if (externalId && seenExternalIds.has(externalId)) {
      rejected.push(
        rejection(externalId, rawTitle, canonicalUrl, "duplicate_in_feed", "external_id"),
      );
      continue;
    }
    seenUrls.set(canonicalUrl, rawTitle);
    if (externalId) seenExternalIds.add(externalId);

    const excerpt = excerptFromHtml(parsed.description, source.excerptLimit);
    const categories = parsed.categories
      .map((category) => cleanTitle(category))
      .filter((category) => category.length > 0)
      .slice(0, 30);

    const categoryPrior = classifyCategory(rawTitle, categories, excerpt);
    const geographyPrior = classifyGeography(rawTitle, categories, excerpt);

    if (!geographyPrior.stateId && !geographyPrior.nigeriaMentioned) {
      rejected.push(
        rejection(externalId, rawTitle, canonicalUrl, "no_nigeria_signal", "no state or country mention"),
      );
      continue;
    }

    const proposal = proposeCandidate(categoryPrior, geographyPrior);
    if (!published.date) {
      proposal.status = "needs_review";
      proposal.reasons.push("review:published-date-missing");
    }
    const rawHash = sha256(
      JSON.stringify({
        source: source.slug,
        externalId,
        title: parsed.title,
        link: parsed.link,
        description: parsed.description,
        pubDate: parsed.pubDate,
        categories: parsed.categories,
      }),
    );
    const contentHash = sha256(`article\n${source.linkPolicy === "any_public_https" ? source.independenceGroup : source.slug}\n${canonicalUrl}`);

    items.push({
      externalId,
      title: rawTitle,
      originalUrl: canonicalUrl,
      canonicalUrl,
      excerpt,
      publishedAt: published.date ? published.date.toISOString() : null,
      retrievedAt: meta.fetchedAt,
      categories,
      language: "en",
      rawHash,
      contentHash,
      categoryPrior,
      geographyPrior,
      proposal,
    });
  }

  return {
    source,
    fetchedAt: meta.fetchedAt,
    httpStatus: meta.httpStatus,
    contentType: meta.contentType,
    feedHash: meta.feedHash,
    feedTitle: truncateText(cleanTitle(feed.title), 200),
    items,
    rejected,
  };
}
