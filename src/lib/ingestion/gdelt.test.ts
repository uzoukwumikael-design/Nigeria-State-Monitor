import { describe, expect, it, vi } from "vitest";
import { GdeltError, fetchGdelt, gdeltCountryRule, gdeltDateToRfc822, gdeltToFeed } from "./gdelt";
import { canonicalizeArticleUrl, isPublicHostname } from "./url";
import { GDELT_NIGERIA, ingestionSource, registeredPublisherHosts } from "./sources";

const article = (url: string, title: string, overrides: Record<string, unknown> = {}) => ({
  url,
  title,
  seendate: "20261112T093000Z",
  domain: new URL(url).hostname,
  language: "English",
  sourcecountry: "Nigeria",
  ...overrides,
});
const none = new Set<string>();

describe("gdeltDateToRfc822", () => {
  it("converts GDELT's compact UTC timestamps", () => {
    expect(gdeltDateToRfc822("20261112T093000Z")).toBe("Thu, 12 Nov 2026 09:30:00 GMT");
  });
});

describe("gdeltToFeed", () => {
  it("maps articles to feed items with the outlet domain as the category and no invented excerpt", () => {
    const feed = gdeltToFeed({ articles: [article("https://example.ng/news/flood-in-owerri", "Flood displaces residents in Owerri")] }, none, 10);
    expect(feed.items).toEqual([
      {
        title: "Flood displaces residents in Owerri",
        link: "https://example.ng/news/flood-in-owerri",
        description: "",
        pubDate: "Thu, 12 Nov 2026 09:30:00 GMT",
        categories: ["example.ng"],
        guid: "https://example.ng/news/flood-in-owerri",
      },
    ]);
  });

  it("drops articles from outlets read directly, so one article is never counted twice", () => {
    const direct = new Set(["punchng.com", "www.vanguardngr.com"]);
    const feed = gdeltToFeed(
      {
        articles: [
          article("https://punchng.com/a-story-we-already-read/", "A story we already read directly"),
          article("https://www.punchng.com/another/", "Same outlet with www prefix here"),
          article("https://vanguardngr.com/bare-host/", "Bare host of a www registered publisher"),
          article("https://smallsite.ng/new-story", "A story only GDELT knows about"),
        ],
      },
      direct,
      10,
    );
    expect(feed.items.map((item) => new URL(item.link).hostname)).toEqual(["smallsite.ng"]);
  });

  it("drops non-https, non-public and too-short items and respects the item limit", () => {
    const feed = gdeltToFeed(
      {
        articles: [
          article("http://insecure.ng/story-one", "An insecure link should be dropped"),
          article("https://192.168.0.5/internal", "An internal address should be dropped"),
          article("https://localhost/x", "Localhost should be dropped here"),
          article("https://ok.ng/short", "Short"),
          article("https://ok.ng/one", "First valid story headline"),
          article("https://ok2.ng/two", "Second valid story headline"),
          article("https://ok3.ng/three", "Third valid story headline"),
        ],
      },
      none,
      2,
    );
    expect(feed.items.map((item) => item.link)).toEqual(["https://ok.ng/one", "https://ok2.ng/two"]);
  });

  it("treats an empty result as no items and rejects an unexpected shape", () => {
    expect(gdeltToFeed({}, none, 10).items).toEqual([]);
    expect(() => gdeltToFeed({ articles: [{ url: "https://x.ng/a", title: "t", seendate: "yesterday" }] }, none, 10)).toThrow(GdeltError);
    expect(() => gdeltToFeed("nope", none, 10)).toThrow(GdeltError);
  });
});

describe("fetchGdelt", () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

  it("requests the allow-listed API without following redirects and returns a hashed result", async () => {
    const fetchImpl = ok({ articles: [article("https://ok.ng/one", "First valid story headline")] });
    const result = await fetchGdelt(GDELT_NIGERIA, { fetchImpl, excludeHosts: none });
    expect(result.feed.items).toHaveLength(1);
    expect(result.feedHash).toMatch(/^[0-9a-f]{64}$/);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.hostname).toBe("api.gdeltproject.org");
    expect(url.searchParams.get("query")).toContain("sourcecountry:NI");
    expect(init.redirect).toBe("error");
  });

  it("explains GDELT's plain-text rate-limit answer instead of crashing, and reports HTTP and network errors", async () => {
    const limited = vi.fn(async () => new Response("Please limit requests to one every 5 seconds.", { status: 200 }));
    await expect(fetchGdelt(GDELT_NIGERIA, { fetchImpl: limited, excludeHosts: none })).rejects.toThrow(/did not return JSON: Please limit/);
    await expect(fetchGdelt(GDELT_NIGERIA, { fetchImpl: vi.fn(async () => new Response("x", { status: 503 })), excludeHosts: none })).rejects.toThrow(/HTTP 503/);
    await expect(
      fetchGdelt(GDELT_NIGERIA, {
        fetchImpl: vi.fn(async () => {
          throw new Error("ENOTFOUND");
        }),
        excludeHosts: none,
      }),
    ).rejects.toThrow(/Could not reach GDELT/);
  });

  it("refuses a feed URL that is off the allowed host", async () => {
    const fetchImpl = ok({});
    await expect(fetchGdelt({ ...GDELT_NIGERIA, feedUrl: "https://evil.example/api" }, { fetchImpl, excludeHosts: none })).rejects.toThrow(/allowed host/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("link policy and exclusion list", () => {
  it("accepts any public HTTPS host only when the source opts in, never IPs or internal names", () => {
    expect(canonicalizeArticleUrl("https://anything.ng/a", "https://api.gdeltproject.org", ["api.gdeltproject.org"]).url).toBeNull();
    expect(canonicalizeArticleUrl("https://anything.ng/a?utm_source=x", "https://api.gdeltproject.org", ["api.gdeltproject.org"], true).url).toBe("https://anything.ng/a");
    for (const bad of ["https://10.0.0.1/a", "https://localhost/a", "https://printer.local/a", "https://intranet/a", "http://anything.ng/a"]) {
      expect(canonicalizeArticleUrl(bad, "https://api.gdeltproject.org", ["api.gdeltproject.org"], true).url).toBeNull();
    }
    expect(isPublicHostname("daily.example.com.ng")).toBe(true);
    expect(isPublicHostname("-bad.ng")).toBe(false);
  });

  it("builds the exclusion list from RSS publishers only, never from GDELT itself", () => {
    const hosts = registeredPublisherHosts();
    expect(hosts.has("punchng.com")).toBe(true);
    expect(hosts.has("api.gdeltproject.org")).toBe(false);
  });
});

describe("country safety net", () => {
  const mixed = {
    articles: [
      article("https://home.ng/a-local-story", "A local story from a Nigerian outlet", { sourcecountry: "Nigeria" }),
      article("https://abroad.example.com/b", "A story from a foreign outlet about Nigeria", { sourcecountry: "United Kingdom" }),
      article("https://niger.example.ne/c", "A story from the wrong country entirely here", { sourcecountry: "Niger" }),
    ],
  };

  it("keeps only Nigerian outlets for the domestic queries, so a wrong country code cannot import another country's news", () => {
    expect(gdeltToFeed(mixed, none, 10, "nigeria_only").items.map((item) => new URL(item.link).hostname)).toEqual(["home.ng"]);
  });

  it("keeps only foreign outlets for the international query, so it never repeats the domestic ones", () => {
    expect(gdeltToFeed(mixed, none, 10, "exclude_nigeria").items.map((item) => new URL(item.link).hostname)).toEqual(["abroad.example.com", "niger.example.ne"]);
  });

  it("reads the rule from each registered query", () => {
    expect(gdeltCountryRule(ingestionSource("gdelt-nigeria")!.feedUrl)).toBe("nigeria_only");
    expect(gdeltCountryRule(ingestionSource("gdelt-south-west")!.feedUrl)).toBe("nigeria_only");
    expect(gdeltCountryRule(ingestionSource("gdelt-international")!.feedUrl)).toBe("exclude_nigeria");
    expect(gdeltCountryRule("https://api.gdeltproject.org/api/v2/doc/doc?query=Nigeria")).toBe("any");
  });

  it("explains a rate limit plainly", async () => {
    const limited = vi.fn(async () => new Response("Please limit requests to one every 5 seconds.", { status: 429 }));
    await expect(fetchGdelt(GDELT_NIGERIA, { fetchImpl: limited, excludeHosts: none })).rejects.toThrow(/rate limiting this server/);
  });
});
