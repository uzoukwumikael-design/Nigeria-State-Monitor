import { describe, expect, it } from "vitest";
import { collectFeed } from "@/lib/ingestion/collect";
import { parseRssFeed } from "@/lib/ingestion/rss";
import { PREMIUM_TIMES } from "@/lib/ingestion/sources";
import type { FeedFetchMetadata } from "@/lib/ingestion/collect";

const NOW = new Date("2026-11-05T09:00:00.000Z");

const META: FeedFetchMetadata = {
  fetchedAt: NOW.toISOString(),
  httpStatus: 200,
  contentType: "application/rss+xml",
  feedHash: "a".repeat(64),
};

function item(parts: {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  categories?: string[];
  guid: string;
}): string {
  const description = parts.description ?? "<p>Test description with no classified detail.</p>";
  const pubDate = parts.pubDate === undefined
    ? "<pubDate>Thu, 05 Nov 2026 06:00:00 +0000</pubDate>"
    : parts.pubDate
      ? `<pubDate>${parts.pubDate}</pubDate>`
      : "";
  const categories = (parts.categories ?? [])
    .map((category) => `<category><![CDATA[${category}]]></category>`)
    .join("");
  return `<item>
    <title><![CDATA[${parts.title}]]></title>
    <link><![CDATA[${parts.link}]]></link>
    <description><![CDATA[${description}]]></description>
    ${pubDate}${categories}
    <guid isPermaLink="false">${parts.guid}</guid>
  </item>`;
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  ${item({
    title: "Gunmen abduct Plateau varsity student",
    link: "https://www.premiumtimesng.com/news/more-news/900001-a.html",
    description: "<p>Security sources said the student was freed after a ransom demand.</p>",
    categories: ["More News", "Plateau State"],
    guid: "900001",
  })}
  ${item({
    title: "Super Eagles win friendly",
    link: "https://www.premiumtimesng.com/sports/football/900002-b.html",
    categories: ["Football"],
    guid: "900002",
  })}
  ${item({
    title: "Gunmen abduct Plateau varsity student",
    link: "https://www.premiumtimesng.com/news/more-news/900001-a.html?utm_source=feed&fbclid=x",
    categories: ["More News", "Plateau State"],
    guid: "900003",
  })}
  ${item({
    title: "DeSantis breaks with Trump",
    link: "https://www.premiumtimesng.com/news/top-news/900004-c.html",
    categories: ["World"],
    guid: "900004",
  })}
  ${item({
    title: "A promoted message",
    link: "https://www.premiumtimesng.com/promoted/900005-d.html",
    guid: "900005",
  })}
  ${item({
    title: "Kano market traders count losses",
    link: "https://www.premiumtimesng.com/business/900006-e.html",
    pubDate: "not-a-date",
    categories: ["Kano"],
    guid: "900006",
  })}
  ${item({
    title: "Gunmen attack Plateau community",
    link: "https://www.premiumtimesng.com/news/900007-f.html",
    pubDate: "Tue, 01 Sep 2026 06:00:00 +0000",
    categories: ["Plateau State"],
    guid: "900007",
  })}
  ${item({
    title: "Inflation rises in Kano",
    link: "https://www.premiumtimesng.com/business/900008-g.html",
    pubDate: "",
    categories: ["Kano", "Inflation"],
    guid: "900008",
  })}
  ${item({
    title: "Sponsored message",
    link: "https://www.premiumtimesng.com/news/900009-h.html",
    categories: ["Promoted Stories"],
    guid: "900009",
  })}
</channel></rss>`;

function collect(limit?: number) {
  return collectFeed(parseRssFeed(XML, 40), PREMIUM_TIMES, META, { now: NOW, limit });
}

describe("feed collection and normalisation", () => {
  it("keeps valid evidence and records explicit rejection reasons", () => {
    const collection = collect();
    expect(collection.feedTitle).toBe("Test Feed");
    expect(collection.items).toHaveLength(2);
    expect(collection.rejected.map((entry) => entry.reason).sort()).toEqual(
      [
        "duplicate_in_feed",
        "invalid_publication_date",
        "no_nigeria_signal",
        "older_than_window",
        "out_of_scope_section",
        "promoted_item",
        "promoted_item",
      ].sort(),
    );

    const first = collection.items[0];
    expect(first?.title).toBe("Gunmen abduct Plateau varsity student");
    expect(first?.canonicalUrl).toBe(
      "https://www.premiumtimesng.com/news/more-news/900001-a.html",
    );
    expect(first?.excerpt.length).toBeLessThanOrEqual(PREMIUM_TIMES.excerptLimit);
    expect(first?.proposal).toMatchObject({ category: "security", stateId: "NG-PL", status: "pending" });
    expect(first?.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first?.rawHash).not.toBe(first?.contentHash);
  });

  it("never produces an accepted candidate or full article body", () => {
    const collection = collect();
    for (const entry of collection.items) {
      expect(["pending", "needs_review"]).toContain(entry.proposal.status);
    }
    expect(collection.items.every((entry) => entry.excerpt.length > 0)).toBe(true);
    expect(collection.items.every((entry) => entry.excerpt.length <= 320)).toBe(true);
    expect(collection.items.every((entry) => !("description" in entry))).toBe(true);
  });

  it("marks an item with no publication date as needing review", () => {
    const collection = collect();
    const undated = collection.items.find((entry) => entry.title === "Inflation rises in Kano");
    expect(undated?.publishedAt).toBeNull();
    expect(undated?.proposal.status).toBe("needs_review");
    expect(undated?.proposal.reasons).toContain("review:published-date-missing");
  });

  it("honours the per-run item limit", () => {
    const collection = collect(1);
    expect(collection.items).toHaveLength(1);
    expect(collection.rejected).toHaveLength(0);
  });
});
