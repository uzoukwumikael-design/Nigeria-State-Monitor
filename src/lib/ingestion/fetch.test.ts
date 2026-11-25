import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fetchFeed, type FetchLike } from "@/lib/ingestion/fetch";
import { PREMIUM_TIMES } from "@/lib/ingestion/sources";

const XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>A</title><link>https://www.premiumtimesng.com/news/a.html</link></item></channel></rss>`;

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

describe("strict feed fetch", () => {
  it("fetches an RSS feed with a truthful user agent and hashes the exact bytes", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      response(XML, {
        status: 200,
        headers: { "content-type": "application/rss+xml; charset=UTF-8" },
      }),
    );

    const result = await fetchFeed(PREMIUM_TIMES, {
      fetchImpl,
      contact: "ops@nsm.test",
    });

    expect(result.httpStatus).toBe(200);
    expect(result.contentType).toBe("application/rss+xml");
    expect(result.xml).toBe(XML);
    expect(result.feedHash).toBe(createHash("sha256").update(XML).digest("hex"));
    expect(result.finalUrl).toBe(PREMIUM_TIMES.feedUrl);

    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get("user-agent")).toContain("NigeriaStateMonitor/0.1");
    expect(headers.get("user-agent")).toContain("ops@nsm.test");
    expect(call?.[1]?.redirect).toBe("manual");
    expect(call?.[1]?.credentials).toBe("omit");
  });

  it("revalidates redirects against the host allow-list", async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      seen.push(String(input));
      if (seen.length === 1) {
        return response(null, {
          status: 302,
          headers: { location: "https://premiumtimesng.com/feed/" },
        });
      }
      return response(XML, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    };

    const result = await fetchFeed(PREMIUM_TIMES, { fetchImpl });
    expect(result.finalUrl).toBe("https://premiumtimesng.com/feed/");
    expect(seen).toHaveLength(2);
  });

  it("rejects a redirect to a non-allow-listed host", async () => {
    const fetchImpl: FetchLike = async () =>
      response(null, { status: 302, headers: { location: "https://evil.test/feed/" } });

    await expect(fetchFeed(PREMIUM_TIMES, { fetchImpl })).rejects.toThrow(/allow-list/);
  });

  it("rejects non-200 responses, HTML content and oversized bodies", async () => {
    await expect(
      fetchFeed(PREMIUM_TIMES, {
        fetchImpl: async () => response("missing", { status: 404 }),
      }),
    ).rejects.toThrow(/HTTP 404/);

    await expect(
      fetchFeed(PREMIUM_TIMES, {
        fetchImpl: async () =>
          response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      }),
    ).rejects.toThrow(/unsupported content type/);

    await expect(
      fetchFeed(PREMIUM_TIMES, {
        maxBytes: 50,
        fetchImpl: async () =>
          response(XML, {
            status: 200,
            headers: {
              "content-type": "application/rss+xml",
              "content-length": String(XML.length),
            },
          }),
      }),
    ).rejects.toThrow(/byte limit/);
  });

  it("refuses a non-HTTPS feed URL before any request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(
      fetchFeed(
        { ...PREMIUM_TIMES, feedUrl: "http://www.premiumtimesng.com/feed/" },
        { fetchImpl },
      ),
    ).rejects.toThrow(/HTTPS/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
