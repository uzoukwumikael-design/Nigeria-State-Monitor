import { createHash } from "node:crypto";
import { z } from "zod";
import { feedUserAgent, type FetchLike } from "@/lib/ingestion/fetch";
import { isPublicHostname } from "@/lib/ingestion/url";
import type { ParsedRssFeed, ParsedRssItem } from "@/lib/ingestion/types";
import type { IngestionSource } from "@/lib/ingestion/types";

/** GDELT asks for at most one request every 5 seconds; leave a margin. */
export const GDELT_SPACING_MS = 5_500;
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

const articleSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  seendate: z.string().regex(/^\d{8}T\d{6}Z$/),
  domain: z.string().optional(),
  language: z.string().optional(),
  sourcecountry: z.string().optional(),
});
const responseSchema = z.object({ articles: z.array(articleSchema).default([]) });

export class GdeltError extends Error {}

/** GDELT writes times as 20261112T093000Z. */
export function gdeltDateToRfc822(value: string): string {
  const [, y, mo, d, h, mi, s] = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/) ?? [];
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toUTCString();
}

/**
 * Turns a GDELT DOC API response into the same shape an RSS feed parses to, so the rest of the pipeline is
 * unchanged. Only headline, link, time and outlet domain exist (no excerpt). Articles from `excludeHosts`
 * are dropped: those outlets are read directly, and counting the same article twice would fake corroboration.
 */
export type GdeltCountryRule = "nigeria_only" | "exclude_nigeria" | "any";

/**
 * Safety net for the country operator: each article carries its own source country, so a wrong country code in a
 * query (the codes are easy to confuse: Nigeria is NI, Niger is NG) cannot silently import another country's news.
 */
function countryAllowed(rule: GdeltCountryRule, sourcecountry: string | undefined): boolean {
  if (rule === "any" || !sourcecountry) return true;
  const isNigeria = sourcecountry.trim().toLowerCase() === "nigeria";
  return rule === "nigeria_only" ? isNigeria : !isNigeria;
}

/** Reads the country rule off the query: "-sourcecountry:NI" excludes Nigeria, "sourcecountry:NI" keeps only it. */
export function gdeltCountryRule(feedUrl: string): GdeltCountryRule {
  const query = new URL(feedUrl).searchParams.get("query") ?? "";
  if (/(^|\s)-sourcecountry:NI(\s|$)/i.test(query)) return "exclude_nigeria";
  if (/(^|\s)sourcecountry:NI(\s|$)/i.test(query)) return "nigeria_only";
  return "any";
}

export function gdeltToFeed(
  payload: unknown,
  excludeHosts: ReadonlySet<string>,
  maxItems: number,
  countryRule: GdeltCountryRule = "any",
): ParsedRssFeed {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new GdeltError("GDELT response did not have the expected shape.");
  const items: ParsedRssItem[] = [];
  for (const article of parsed.data.articles) {
    let host: string;
    try {
      const url = new URL(article.url);
      if (url.protocol !== "https:") continue;
      host = url.hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!countryAllowed(countryRule, article.sourcecountry)) continue;
    const bare = host.replace(/^www\./, "");
    if (!isPublicHostname(host) || excludeHosts.has(host) || excludeHosts.has(bare) || excludeHosts.has(`www.${bare}`)) continue;
    const title = article.title.replace(/\s+/g, " ").trim();
    if (title.length < 10) continue;
    items.push({
      title,
      link: article.url,
      description: "",
      pubDate: gdeltToDate(article.seendate),
      categories: [article.domain ?? bare],
      guid: article.url,
    });
    if (items.length >= maxItems) break;
  }
  return { title: "GDELT DOC API", items };
}

function gdeltToDate(value: string): string {
  return gdeltDateToRfc822(value);
}

export interface GdeltFetchResult {
  feed: ParsedRssFeed;
  fetchedAt: string;
  httpStatus: number;
  contentType: string;
  feedHash: string;
}

export async function fetchGdelt(
  source: Pick<IngestionSource, "feedUrl" | "allowedHosts" | "maxItems">,
  options: { fetchImpl?: FetchLike; contact?: string; excludeHosts: ReadonlySet<string>; countryRule?: GdeltCountryRule },
): Promise<GdeltFetchResult> {
  const url = new URL(source.feedUrl);
  if (url.protocol !== "https:" || !source.allowedHosts.includes(url.hostname)) {
    throw new GdeltError("GDELT feed URL is not on an allowed host.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": feedUserAgent(options.contact) },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GdeltError(`Could not reach GDELT: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (response.status === 429) throw new GdeltError("GDELT is rate limiting this server (one request every 5 seconds is allowed); the next run will retry.");
  if (!response.ok) throw new GdeltError(`GDELT responded HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new GdeltError("GDELT response is too large.");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    // GDELT answers with plain text for rate limits or bad queries (HTTP 200), not JSON.
    throw new GdeltError(`GDELT did not return JSON: ${text.slice(0, 80).replace(/\s+/g, " ")}`);
  }
  return {
    feed: gdeltToFeed(payload, options.excludeHosts, source.maxItems, options.countryRule ?? "any"),
    fetchedAt: new Date().toISOString(),
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "application/json",
    feedHash: createHash("sha256").update(text).digest("hex"),
  };
}
