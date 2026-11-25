import { createHash } from "node:crypto";
import type { IngestionSource } from "@/lib/ingestion/types";
import { assertHttpsFeedUrl } from "@/lib/ingestion/url";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FetchedFeed {
  xml: string;
  httpStatus: number;
  contentType: string;
  fetchedAt: string;
  feedHash: string;
  finalUrl: string;
}

export interface FetchFeedOptions {
  fetchImpl?: FetchLike;
  contact?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set(["application/rss+xml", "application/xml", "text/xml"]);

export function feedUserAgent(contact: string | undefined): string {
  const cleaned = contact?.replace(/[\r\n<>]/g, " ").trim();
  if (cleaned) {
    return `NigeriaStateMonitor/0.1 (RSS metadata ingestion; contact: ${cleaned})`;
  }
  return "NigeriaStateMonitor/0.1 (RSS metadata ingestion; contact not configured)";
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new Error(`Feed response is ${size} bytes, above the ${maxBytes} byte limit.`);
    }
  }

  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Feed response is above the ${maxBytes} byte limit.`);
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Feed response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Fetches one feed with a truthful User-Agent, HTTPS-only URLs, allow-listed
 * hosts revalidated on every redirect, a hard timeout, a byte ceiling and a
 * strict RSS content-type check. The response body is never persisted; only a
 * SHA-256 of the bytes is recorded.
 */
export async function fetchFeed(
  source: IngestionSource,
  options: FetchFeedOptions = {},
): Promise<FetchedFeed> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const contact = options.contact ?? process.env.NSM_INGESTION_CONTACT;

  let current = assertHttpsFeedUrl(source.feedUrl, source.allowedHosts);
  let response: Response | null = null;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: {
        accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "user-agent": feedUserAgent(contact),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Feed responded with HTTP ${response.status} but no Location header.`);
      }
      if (hop === maxRedirects) {
        throw new Error(`Feed exceeded the ${maxRedirects} redirect limit.`);
      }
      await response.body?.cancel();
      current = assertHttpsFeedUrl(
        new URL(location, current).toString(),
        source.allowedHosts,
      );
      continue;
    }
    break;
  }

  if (!response) {
    throw new Error("Feed request produced no response.");
  }
  if (response.status !== 200) {
    throw new Error(`Feed responded with HTTP ${response.status}.`);
  }

  const contentTypeHeader = response.headers.get("content-type") ?? "";
  const contentType = contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Feed returned unsupported content type "${contentType || "missing"}"; expected RSS/XML.`,
    );
  }

  const bytes = await readLimitedBody(response, maxBytes);
  if (bytes.byteLength === 0) {
    throw new Error("Feed response is empty.");
  }

  const feedHash = createHash("sha256").update(bytes).digest("hex");
  const xml = new TextDecoder("utf-8").decode(bytes);

  return {
    xml,
    httpStatus: response.status,
    contentType,
    fetchedAt: new Date().toISOString(),
    feedHash,
    finalUrl: current.toString(),
  };
}
