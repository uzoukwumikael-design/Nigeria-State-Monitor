import { describe, expect, it } from "vitest";
import { buildExtraSources } from "./sources";
import { findFeedLinks, nameFromHost, normaliseSiteUrl, slugFromHost } from "./discover";

describe("findFeedLinks", () => {
  const html = `<html><head>
    <link rel="alternate" type="application/rss+xml" title="Feed" href="/feed/" />
    <link rel='alternate' type='application/rss+xml' href='https://www.example.ng/comments/feed/'>
    <link rel="alternate" type="application/atom+xml" href="/atom.xml">
    <link rel="stylesheet" href="/style.css">
    <link rel="alternate" type="application/rss+xml" href="https://evil.example/feed/">
    <link rel="alternate" type="application/rss+xml" href="http://example.ng/insecure/feed/">
    <link rel="alternate" type="application/rss+xml" href="/feed/">
  </head></html>`;

  it("returns absolute, same-site, HTTPS RSS links only, without duplicates", () => {
    expect(findFeedLinks(html, "https://example.ng/")).toEqual([
      "https://example.ng/feed/",
      "https://www.example.ng/comments/feed/",
    ]);
  });

  it("finds nothing in a page without feed links", () => {
    expect(findFeedLinks("<html><head><title>x</title></head></html>", "https://example.ng/")).toEqual([]);
  });
});

describe("slug, name and site normalisation", () => {
  it("derives a readable slug and avoids clashes", () => {
    expect(slugFromHost("www.dailypost.ng")).toBe("dailypost");
    expect(slugFromHost("dailypost.ng", new Set(["dailypost"]))).toBe("dailypost-2");
    expect(slugFromHost("ab.ng")).toBe("abx");
    expect(nameFromHost("www.dailypost.ng")).toBe("Dailypost");
  });

  it("accepts bare domains and full URLs, and rejects unsafe ones", () => {
    expect(normaliseSiteUrl("dailypost.ng").toString()).toBe("https://dailypost.ng/");
    expect(normaliseSiteUrl("https://www.dailypost.ng/news/story").toString()).toBe("https://www.dailypost.ng/");
    expect(() => normaliseSiteUrl("http://dailypost.ng")).toThrow(/https/);
    expect(() => normaliseSiteUrl("https://user:pw@dailypost.ng")).toThrow(/credentials/);
    expect(() => normaliseSiteUrl("localhost")).toThrow(/public website/);
    expect(() => normaliseSiteUrl("192.168.1.5")).toThrow(/public website/);
  });
});

describe("buildExtraSources (src/config/extra-sources.json)", () => {
  const taken = new Set(["punch"]);

  it("builds restricted, robots-checked sources with an honest default evidence label", () => {
    const { sources, evidence } = buildExtraSources(
      [{ slug: "the-nation", name: "The Nation", feedUrl: "https://thenationonlineng.net/feed/", tier: "major_publisher" }],
      taken,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ slug: "the-nation", licenceStatus: "restricted", active: true, accessMethod: "rss" });
    expect(sources[0]?.allowedHosts).toContain("thenationonlineng.net");
    expect(evidence["the-nation"]?.level).toBe("directory");
  });

  it("keeps evidence supplied by the sources:add command", () => {
    const { evidence } = buildExtraSources(
      [{ slug: "dailypost-2", name: "Example Daily", feedUrl: "https://x.ng/feed/", evidence: { level: "verified", note: "Parsed 20 items on 2026-11-11." } }],
      taken,
    );
    expect(evidence["dailypost-2"]).toEqual({ level: "verified", note: "Parsed 20 items on 2026-11-11." });
  });

  it("fails loudly on bad entries so a typo breaks the build, not ingestion", () => {
    expect(() => buildExtraSources([{ slug: "punch", name: "Dup", feedUrl: "https://x.ng/feed/" }], taken)).toThrow(/already used/);
    expect(() => buildExtraSources([{ slug: "a", name: "Short", feedUrl: "https://x.ng/feed/" }], taken)).toThrow();
    expect(() => buildExtraSources([{ slug: "good-slug", name: "Plain http", feedUrl: "http://x.ng/feed/" }], taken)).toThrow();
    expect(() =>
      buildExtraSources(
        [
          { slug: "twice", name: "One", feedUrl: "https://a.ng/feed/" },
          { slug: "twice", name: "Two", feedUrl: "https://b.ng/feed/" },
        ],
        taken,
      ),
    ).toThrow(/already used/);
    expect(() => buildExtraSources("not an array", taken)).toThrow();
  });

  it("accepts an empty file", () => {
    expect(buildExtraSources([], taken)).toEqual({ sources: [], evidence: {} });
  });
});
