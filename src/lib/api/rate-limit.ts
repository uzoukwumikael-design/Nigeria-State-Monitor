import type { NextRequest } from "next/server";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface Bucket {
  count: number;
  resetAt: number;
}

const UPSTASH_TIMEOUT_MS = 800;
const memoryBuckets = new Map<string, Bucket>();
let warnedUpstashFailure = false;

/** Per-instance fixed-window limiter. Used when Upstash is not configured or unreachable. */
export function memoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    memoryBuckets.set(key, { count: 1, resetAt });
    // Opportunistic cleanup so a long-lived process cannot grow without bound.
    if (memoryBuckets.size > 5_000) {
      for (const [bucketKey, value] of memoryBuckets) {
        if (value.resetAt <= now) memoryBuckets.delete(bucketKey);
      }
    }
    return { allowed: true, limit, remaining: limit - 1, resetAt, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function resetMemoryRateLimit(): void {
  memoryBuckets.clear();
  warnedUpstashFailure = false;
}

export interface UpstashConfig {
  url: string;
  token: string;
}

/** Returns null unless both variables are set and the URL is HTTPS (or loopback http for tests). */
export function upstashConfig(env: Env = process.env): UpstashConfig | null {
  const rawUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!rawUrl || !token) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) return null;
  if (url.username || url.password) return null;
  return { url: url.toString().replace(/\/+$/, ""), token };
}

async function upstashRateLimit(
  config: UpstashConfig,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  fetchImpl: FetchLike,
): Promise<RateLimitResult> {
  const windowIndex = Math.floor(now / windowMs);
  const resetAt = (windowIndex + 1) * windowMs;
  const redisKey = `nsm:rl:${key}:${windowIndex}`;
  const ttlSeconds = Math.max(2, Math.ceil(windowMs / 1000) * 2);

  const response = await fetchImpl(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, ttlSeconds],
    ]),
    signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Upstash responded ${response.status}`);
  const payload: unknown = await response.json();
  const first = Array.isArray(payload) ? (payload[0] as { result?: unknown } | undefined) : undefined;
  const count = typeof first?.result === "number" ? first.result : Number.NaN;
  if (!Number.isInteger(count) || count < 1) throw new Error("Upstash returned an invalid counter");

  const allowed = count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

export function clientKey(request: NextRequest, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}

export interface CheckOptions {
  env?: Env;
  fetchImpl?: FetchLike;
  now?: number;
}

/**
 * Shared limiter. Uses Upstash Redis (so limits hold across serverless
 * instances) when configured; any Upstash failure falls back to the local
 * limiter rather than blocking or silently disabling limits.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: CheckOptions = {},
): Promise<RateLimitResult> {
  const now = options.now ?? Date.now();
  const config = upstashConfig(options.env ?? process.env);
  if (config) {
    try {
      return await upstashRateLimit(
        config,
        key,
        limit,
        windowMs,
        now,
        options.fetchImpl ?? ((input, init) => fetch(input, init)),
      );
    } catch (error) {
      if (!warnedUpstashFailure) {
        warnedUpstashFailure = true;
        console.error("rate_limit_upstash_unavailable", error instanceof Error ? error.message : error);
      }
    }
  }
  return memoryRateLimit(key, limit, windowMs, now);
}
