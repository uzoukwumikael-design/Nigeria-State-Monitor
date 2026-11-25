import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, memoryRateLimit, resetMemoryRateLimit, upstashConfig } from "./rate-limit";

const ENV = {
  UPSTASH_REDIS_REST_URL: "https://example-upstash.invalid",
  UPSTASH_REDIS_REST_TOKEN: "test-token",
};

function upstashFetch(counts: number[]) {
  let call = 0;
  return vi.fn(async () => {
    const count = counts[Math.min(call, counts.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify([{ result: count }, { result: 1 }]), { status: 200 });
  });
}

beforeEach(() => {
  resetMemoryRateLimit();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("memoryRateLimit", () => {
  it("allows up to the limit then blocks with a retry delay, and resets after the window", () => {
    const now = 1_000_000;
    expect(memoryRateLimit("k", 2, 60_000, now).allowed).toBe(true);
    expect(memoryRateLimit("k", 2, 60_000, now + 1).allowed).toBe(true);
    const blocked = memoryRateLimit("k", 2, 60_000, now + 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(memoryRateLimit("k", 2, 60_000, now + 60_001).allowed).toBe(true);
  });

  it("keeps separate buckets per key", () => {
    expect(memoryRateLimit("a", 1, 60_000, 0).allowed).toBe(true);
    expect(memoryRateLimit("b", 1, 60_000, 0).allowed).toBe(true);
    expect(memoryRateLimit("a", 1, 60_000, 1).allowed).toBe(false);
  });
});

describe("upstashConfig", () => {
  it("needs both variables and a safe URL", () => {
    expect(upstashConfig({})).toBeNull();
    expect(upstashConfig({ UPSTASH_REDIS_REST_URL: "https://x.invalid" })).toBeNull();
    expect(upstashConfig({ ...ENV, UPSTASH_REDIS_REST_URL: "http://remote.example" })).toBeNull();
    expect(upstashConfig({ ...ENV, UPSTASH_REDIS_REST_URL: "https://u:p@x.invalid" })).toBeNull();
    expect(upstashConfig({ ...ENV, UPSTASH_REDIS_REST_URL: "nonsense" })).toBeNull();
    expect(upstashConfig(ENV)?.url).toBe("https://example-upstash.invalid");
  });
});

describe("checkRateLimit", () => {
  it("uses the in-memory limiter when Upstash is not configured", async () => {
    const result = await checkRateLimit("scope:1.1.1.1", 1, 60_000, { env: {}, now: 0 });
    expect(result.allowed).toBe(true);
    expect((await checkRateLimit("scope:1.1.1.1", 1, 60_000, { env: {}, now: 1 })).allowed).toBe(false);
  });

  it("counts through Upstash when configured, sending the bearer token and a window-scoped key", async () => {
    const fetchImpl = upstashFetch([1, 2, 3]);
    const options = { env: ENV, fetchImpl, now: 120_000 };
    expect((await checkRateLimit("search:9.9.9.9", 2, 60_000, options)).allowed).toBe(true);
    expect((await checkRateLimit("search:9.9.9.9", 2, 60_000, options)).allowed).toBe(true);
    const blocked = await checkRateLimit("search:9.9.9.9", 2, 60_000, options);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example-upstash.invalid/pipeline");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    const body = JSON.parse(init.body as string) as unknown[][];
    expect(body[0]).toEqual(["INCR", "nsm:rl:search:9.9.9.9:2"]);
    expect(body[1]?.[0]).toBe("EXPIRE");
  });

  it("falls back to the local limiter, not to 'allow everything', when Upstash fails", async () => {
    const down = vi.fn(async () => new Response("nope", { status: 500 }));
    const options = { env: ENV, fetchImpl: down, now: 0 };
    expect((await checkRateLimit("k", 1, 60_000, options)).allowed).toBe(true);
    expect((await checkRateLimit("k", 1, 60_000, options)).allowed).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(1); // warns once, not per request
  });

  it("falls back when Upstash returns a nonsense counter or throws", async () => {
    const garbage = vi.fn(async () => new Response(JSON.stringify([{ result: "x" }]), { status: 200 }));
    expect((await checkRateLimit("g", 1, 60_000, { env: ENV, fetchImpl: garbage, now: 0 })).allowed).toBe(true);
    const throwing = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect((await checkRateLimit("t", 1, 60_000, { env: ENV, fetchImpl: throwing, now: 0 })).allowed).toBe(true);
    expect((await checkRateLimit("t", 1, 60_000, { env: ENV, fetchImpl: throwing, now: 1 })).allowed).toBe(false);
  });
});
