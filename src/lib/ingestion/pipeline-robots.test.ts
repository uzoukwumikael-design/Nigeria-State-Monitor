import { describe, expect, it, vi } from "vitest";
import { runIngestion } from "./pipeline";
import { PREMIUM_TIMES } from "./sources";

const NOW = new Date("2026-11-09T12:00:00.000Z");

describe("runIngestion robots enforcement", () => {
  it("does not request the feed when robots.txt disallows it, and records a failed run", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) =>
      String(input).endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow: /feed\n", { status: 200 })
        : new Response("<rss/>", { status: 200 }),
    );
    const result = await runIngestion({ source: PREMIUM_TIMES, dryRun: true, fetchImpl, now: NOW });
    expect(result.summary.status).toBe("failed");
    expect(result.error).toMatch(/Skipped premium-times: robots\.txt disallows \/feed\//);
    expect(result.robots?.allowed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // robots.txt only
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://www.premiumtimesng.com/robots.txt");
  });

  it("skips the feed when robots.txt cannot be read", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL) => new Response("down", { status: 503 }));
    const result = await runIngestion({ source: PREMIUM_TIMES, dryRun: true, fetchImpl, now: NOW });
    expect(result.summary.status).toBe("failed");
    expect(result.robots).toMatchObject({ allowed: false, unavailable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("can be bypassed only explicitly (tests), in which case robots.txt is never requested", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL) => new Response("<rss/>", { status: 200, headers: { "content-type": "application/rss+xml" } }));
    const result = await runIngestion({ source: PREMIUM_TIMES, dryRun: true, fetchImpl, now: NOW, enforceRobots: false });
    expect(result.robots).toBeNull();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://www.premiumtimesng.com/feed/");
  });
});
