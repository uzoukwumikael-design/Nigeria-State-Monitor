import { describe, expect, it } from "vitest";
import { parseRssFeed } from "@/lib/ingestion/rss";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title><![CDATA[First &amp; item]]></title>
      <link>https://www.premiumtimesng.com/news/first.html</link>
      <description><![CDATA[<p>Body &amp; detail.</p>]]></description>
      <pubDate>Thu, 05 Nov 2026 06:08:03 +0000</pubDate>
      <category>Top News</category>
      <category><![CDATA[Plateau State]]></category>
      <guid isPermaLink="false">first-guid</guid>
    </item>
    <item>
      <title>Second item</title>
      <link>https://www.premiumtimesng.com/news/second.html</link>
      <description>Plain description</description>
    </item>
  </channel>
</rss>`;

describe("strict RSS 2.0 parser", () => {
  it("parses items, CDATA, categories and guids", () => {
    const feed = parseRssFeed(FEED, 40);
    expect(feed.title).toBe("Example Feed");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      title: "First &amp; item",
      link: "https://www.premiumtimesng.com/news/first.html",
      description: "<p>Body &amp; detail.</p>",
      guid: "first-guid",
    });
    expect(feed.items[0]?.categories).toEqual(["Top News", "Plateau State"]);
    expect(feed.items[1]?.pubDate).toBeNull();
  });

  it("caps the number of items", () => {
    expect(parseRssFeed(FEED, 1).items).toHaveLength(1);
  });

  it("rejects DTD and entity declarations", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x "y">]><rss version="2.0"><channel><title>T</title><item><title>&x;</title></item></channel></rss>`;
    expect(() => parseRssFeed(xml, 10)).toThrow(/DTD or entity/);
  });

  it("rejects malformed XML, non-RSS documents and empty channels", () => {
    expect(() => parseRssFeed("<rss><channel>", 10)).toThrow(/well-formed/);
    expect(() => parseRssFeed("<feed><entry/></feed>", 10)).toThrow(/RSS 2.0/);
    expect(() =>
      parseRssFeed("<rss version=\"2.0\"><channel><title>T</title></channel></rss>", 10),
    ).toThrow(/no items/);
    expect(() => parseRssFeed("   ", 10)).toThrow(/empty/);
  });
});
