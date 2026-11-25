import { describe, expect, it, vi } from "vitest";
import { checkRobots, isPathAllowed, parseRobots } from "./robots";

const SOURCE = {
  baseUrl: "https://news.example",
  feedUrl: "https://news.example/feed/",
  allowedHosts: ["news.example"],
};

const text = (body: string, status = 200) => async () => new Response(body, { status });

describe("parseRobots / isPathAllowed", () => {
  it("applies the wildcard group, with the longest matching rule winning and Allow winning ties", () => {
    const policy = parseRobots(`User-agent: *\nDisallow: /feed\nAllow: /feed/public\nDisallow: /private/\n`);
    expect(isPathAllowed(policy, "/feed/")).toBe(false);
    expect(isPathAllowed(policy, "/feed/public/rss")).toBe(true);
    expect(isPathAllowed(policy, "/private/x")).toBe(false);
    expect(isPathAllowed(policy, "/news/story")).toBe(true);
    const tie = parseRobots(`User-agent: *\nAllow: /a\nDisallow: /a\n`);
    expect(isPathAllowed(tie, "/a")).toBe(true);
  });

  it("supports * wildcards and $ anchors, and ignores comments and unknown fields", () => {
    const policy = parseRobots(`# comment\nUser-agent: *\nDisallow: /*.json$ # inline\nSitemap: https://x/sitemap.xml\n`);
    expect(isPathAllowed(policy, "/data.json")).toBe(false);
    expect(isPathAllowed(policy, "/data.json?x=1")).toBe(true);
    expect(isPathAllowed(policy, "/feed/")).toBe(true);
  });

  it("treats an empty Disallow as allow-all and no matching group as no restriction", () => {
    expect(isPathAllowed(parseRobots("User-agent: *\nDisallow:\n"), "/anything")).toBe(true);
    const none = parseRobots("User-agent: SomeoneElse\nDisallow: /\n");
    expect(none.matchedGroup).toBe("none");
    expect(isPathAllowed(none, "/feed/")).toBe(true);
  });

  it("prefers a group addressed to our product over the wildcard group and reads Crawl-delay", () => {
    const policy = parseRobots(
      `User-agent: *\nDisallow: /\n\nUser-agent: NigeriaStateMonitor\nAllow: /feed/\nCrawl-delay: 15\n`,
    );
    expect(policy.matchedGroup).toBe("product");
    expect(policy.crawlDelaySeconds).toBe(15);
    expect(isPathAllowed(policy, "/feed/")).toBe(true);
  });

  it("groups consecutive User-agent lines and reads their shared rules", () => {
    const policy = parseRobots(`User-agent: Foo\nUser-agent: *\nDisallow: /feed/\nCrawl-delay: 10\n`);
    expect(isPathAllowed(policy, "/feed/")).toBe(false);
    expect(policy.crawlDelaySeconds).toBe(10);
  });
});

describe("checkRobots", () => {
  it("allows the feed and reports the crawl delay when robots.txt permits it", async () => {
    const verdict = await checkRobots(SOURCE, { fetchImpl: text("User-agent: *\nCrawl-delay: 10\nDisallow: /wp-admin/\n") });
    expect(verdict).toMatchObject({ allowed: true, crawlDelayMs: 10_000, unavailable: false });
  });

  it("refuses when the feed path is disallowed", async () => {
    const verdict = await checkRobots(SOURCE, { fetchImpl: text("User-agent: *\nDisallow: /feed\n") });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/disallows \/feed\//);
  });

  it("treats an unreadable-by-design robots.txt (any 4xx except 429, e.g. S3's 403) as no restrictions", async () => {
    for (const status of [401, 403, 404, 410]) {
      expect((await checkRobots(SOURCE, { fetchImpl: text("nope", status) })).allowed, `HTTP ${status}`).toBe(true);
    }
  });

  it("asks us to wait on 429 and on server errors", async () => {
    for (const status of [429, 500, 503]) {
      expect(await checkRobots(SOURCE, { fetchImpl: text("slow down", status) })).toMatchObject({ allowed: false, unavailable: true });
    }
  });

  it("refuses when robots.txt cannot be read (5xx, network error, oversize)", async () => {
    const server = await checkRobots(SOURCE, { fetchImpl: text("oops", 503) });
    expect(server).toMatchObject({ allowed: false, unavailable: true });
    const network = await checkRobots(SOURCE, {
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    expect(network).toMatchObject({ allowed: false, unavailable: true });
    const huge = await checkRobots(SOURCE, { fetchImpl: text("x".repeat(300_000)) });
    expect(huge).toMatchObject({ allowed: false, unavailable: true });
  });

  it("follows a redirect inside the allowed hosts but refuses one that leaves them", async () => {
    const inside = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://news.example/robots-v2.txt" } }))
      .mockResolvedValueOnce(new Response("User-agent: *\nDisallow:\n", { status: 200 }));
    expect((await checkRobots(SOURCE, { fetchImpl: inside })).allowed).toBe(true);
    const outside = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.example/robots.txt" } }));
    const verdict = await checkRobots(SOURCE, { fetchImpl: outside });
    expect(verdict).toMatchObject({ allowed: false, unavailable: true });
    expect(verdict.reason).toMatch(/outside the allowed hosts/);
  });
});
