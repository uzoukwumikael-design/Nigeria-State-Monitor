import { describe, expect, it } from "vitest";
import {
  assertHttpsFeedUrl,
  canonicalizeArticleUrl,
  isPromotedItem,
  isPromotedUrl,
  outOfScopeSection,
} from "@/lib/ingestion/url";

const HOSTS = ["www.premiumtimesng.com", "premiumtimesng.com"];

describe("ingestion URL validation", () => {
  it("canonicalises HTTPS allow-listed URLs and removes tracking", () => {
    const result = canonicalizeArticleUrl(
      "https://www.premiumtimesng.com/news/top-news/story.html?utm_source=x&b=2&a=1&fbclid=y#comments",
      "https://www.premiumtimesng.com",
      HOSTS,
    );
    expect(result.url).toBe("https://www.premiumtimesng.com/news/top-news/story.html?a=1&b=2");
  });

  it("rejects non-HTTPS, credential-bearing, non-default-port and foreign hosts", () => {
    expect(
      canonicalizeArticleUrl("http://www.premiumtimesng.com/a", "https://www.premiumtimesng.com", HOSTS)
        .reason,
    ).toBe("non_https_url");
    expect(
      canonicalizeArticleUrl(
        "https://user:pass@www.premiumtimesng.com/a",
        "https://www.premiumtimesng.com",
        HOSTS,
      ).reason,
    ).toBe("url_contains_credentials");
    expect(
      canonicalizeArticleUrl("https://www.premiumtimesng.com:8443/a", "https://www.premiumtimesng.com", HOSTS)
        .reason,
    ).toBe("non_default_port");
    expect(
      canonicalizeArticleUrl("https://evil.test/a", "https://www.premiumtimesng.com", HOSTS).reason,
    ).toBe("host_not_allowed");
  });

  it("flags promoted URLs and feed tags", () => {
    expect(isPromotedUrl("https://www.premiumtimesng.com/promoted/story")).toBe(true);
    expect(isPromotedUrl("https://www.premiumtimesng.com/news/story")).toBe(false);
    expect(isPromotedItem(["Top News", "Promoted Stories"])).toBe(true);
    expect(isPromotedItem(["Top News"])).toBe(false);
  });

  it("identifies out-of-scope sections from the path only", () => {
    expect(outOfScopeSection("https://www.premiumtimesng.com/sports/football/a.html")).toBe("sports");
    expect(outOfScopeSection("https://www.premiumtimesng.com/foreign/world/a.html")).toBe("foreign");
    expect(outOfScopeSection("https://www.premiumtimesng.com/news/top-news/a.html")).toBeNull();
  });

  it("requires HTTPS and an allow-listed feed host", () => {
    expect(assertHttpsFeedUrl("https://www.premiumtimesng.com/feed/", HOSTS).hostname).toBe(
      "www.premiumtimesng.com",
    );
    expect(() => assertHttpsFeedUrl("http://www.premiumtimesng.com/feed/", HOSTS)).toThrow(/HTTPS/);
    expect(() => assertHttpsFeedUrl("https://evil.test/feed/", HOSTS)).toThrow(/allow-list/);
    expect(() =>
      assertHttpsFeedUrl("https://user:pass@www.premiumtimesng.com/feed/", HOSTS),
    ).toThrow(/credentials/);
  });
});
